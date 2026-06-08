import { generateProductData, extractLabelSignals, identifyBottleForSearch } from "./ai.js";
import { generateStudioImage } from "./image.js";
import {
  findProduct,
  updateProductListing,
  searchVendors,
  matchVendor
} from "./shopify.js";
import { searchWhiskeyInfo, searchTastingNotes } from "./search.js";
import { buildTastingPriors } from "./tasting-priors.js";

/**
 * UPDATE pipeline:
 * Resolve an EXISTING Shopify product → recognize the bottle photo → research →
 * regenerate the listing (title/description/metafields/vendor) → write it back.
 *
 * This NEVER creates a product and NEVER changes price/cost/inventory. It mirrors
 * the recognition + research + metafield conventions of pipeline.js (the create
 * flow) so listings stay consistent between create and update.
 *
 * @param {object} args
 * @param {object} args.productRef        { idOrGid?, handle?, sku?, barcode?, title? }
 * @param {object} args.image            Discord-style attachment { url }
 * @param {string} [args.notes]
 * @param {number} [args.abv]
 * @param {number} [args.proof]
 * @param {string} [args.barcode]        barcode from the user (research hint only)
 * @param {string} [args.referenceLink]
 * @param {boolean} [args.regenerateImage=false]  if true, generate a studio image and attach it
 * @param {function} [args.send]         async status callback (defaults to console logger)
 * @returns {Promise<object>} { ok, productId, adminUrl, productTitle, needsAbv, needsVendor, unmatchedVendor, matchedBy, ... }
 */
export async function runUpdatePipeline({
  productRef,
  image,
  notes,
  abv,
  proof,
  barcode,
  referenceLink,
  regenerateImage = false,
  send
} = {}) {
  console.log("UPDATE PIPELINE START");

  const sendImpl = typeof send === "function" ? send : consoleSend;
  const sendSafe = async (message) => {
    try {
      await sendImpl(message);
    } catch (e) {
      console.warn("UPDATE: send failed:", e?.message || String(e));
    }
  };

  try {
    // -------------------------
    // STEP 0: RESOLVE EXISTING PRODUCT (avoid duplicates)
    // -------------------------
    const ref = productRef || {};
    const hasRef = ref.idOrGid || ref.handle || ref.sku || ref.barcode || ref.title;
    if (!hasRef) {
      await sendSafe("❌ No product reference provided. Pass one of: idOrGid, handle, sku, barcode, title.");
      return { ok: false, error: "missing_product_ref" };
    }

    await sendSafe("🔎 Resolving existing product…");
    const found = await findProduct(ref);

    if (!found) {
      await sendSafe("❌ No matching product found. I will NOT create a new one. Double-check the id/handle/sku/barcode/title.");
      return { ok: false, error: "product_not_found", matchedBy: describeRef(ref) };
    }
    if (Array.isArray(found)) {
      const list = found
        .slice(0, 10)
        .map(p => `- ${p.title} (handle: ${p.handle}, id: ${shortId(p.id)})`)
        .join("\n");
      await sendSafe(`⚠️ Multiple products matched — refusing to guess. Re-run with a more specific reference (id/handle/sku/barcode):\n${list}`);
      return { ok: false, error: "ambiguous_match", matches: found, matchedBy: describeRef(ref) };
    }

    const existing = found;
    const matchedBy = describeRef(ref);
    console.log("UPDATE: Resolved product", existing.id, existing.title, "via", matchedBy);
    await sendSafe(`✅ Found product: **${existing.title}** (matched by ${matchedBy}).`);

    // Echo input for debugging (mirrors create pipeline).
    const inputLines = [
      "🧾 Input",
      image?.url ? `- Image: ${image.url}` : "- Image: (missing)",
      typeof abv === "number" && Number.isFinite(abv) ? `- ABV: ${abv}` : "",
      typeof proof === "number" && Number.isFinite(proof) ? `- Proof: ${proof}` : "",
      barcode ? `- Barcode: ${barcode}` : "",
      referenceLink ? `- Reference link: ${referenceLink}` : "",
      `- Regenerate image: ${regenerateImage ? "yes" : "no"}`,
      notes ? `- Notes: ${String(notes).trim().slice(0, 500)}` : ""
    ].filter(Boolean);
    await sendSafe(inputLines.join("\n"));

    if (!image?.url) {
      await sendSafe("❌ No bottle image provided — cannot run recognition.");
      return { ok: false, error: "missing_image", productId: existing.id };
    }

    // -------------------------
    // STEP 1: IMAGE (optionally regenerate a studio shot)
    // -------------------------
    // For recognition we always use the provided photo. We only generate a studio
    // image when regenerateImage is requested (and then attach it to the product).
    let studioImageUrl = "";
    if (regenerateImage) {
      await sendSafe("📸 Generating studio image…");
      try {
        studioImageUrl = await generateStudioImage(image.url);
      } catch (e) {
        console.warn("UPDATE: studio image generation failed:", e?.message || String(e));
      }
    }
    // The image we feed the vision models: prefer the studio shot if we made one
    // (cleaner background can help recognition), else the raw photo.
    const recognitionImageUrl = studioImageUrl || image.url;

    // -------------------------
    // STEP 2: AI (VISION) + RESEARCH + SIGNALS  (same as create flow)
    // -------------------------
    await sendSafe("🧠 Reading the label & writing the listing…");

    let abvFromInput = "";
    if (typeof abv === "number" && Number.isFinite(abv)) {
      abvFromInput = `${abv}%`;
    } else if (typeof proof === "number" && Number.isFinite(proof)) {
      const computed = proof / 2;
      abvFromInput = `${Number.isFinite(computed) ? String(computed).replace(/\.0$/, "") : ""}%`;
    }

    const notesWithUserAbv = [
      notes || "",
      typeof proof === "number" && Number.isFinite(proof) ? `Proof: ${proof}` : "",
      abvFromInput ? `ABV: ${abvFromInput}` : "",
      barcode ? `Barcode/UPC: ${barcode}` : "",
      referenceLink ? `Reference: ${referenceLink}` : ""
    ].filter(Boolean).join("\n");

    // Extract high-signal facts first (ABV/proof, store pick, single barrel)
    let signals = null;
    try {
      signals = await extractLabelSignals({ notes: notesWithUserAbv, imageUrl: recognitionImageUrl });
      console.log("UPDATE SIGNALS:", JSON.stringify(signals));
    } catch (sigErr) {
      console.warn("UPDATE SIGNALS: failed:", sigErr?.message || String(sigErr));
    }

    // Web research (tasting notes + specs)
    let webResearch = null;
    let tastingPriors = null;
    let tastingMode = "inferred";
    try {
      const ident = await identifyBottleForSearch({ notes: notesWithUserAbv, imageUrl: recognitionImageUrl }).catch(() => null);
      const fallbackQuery = [
        ident?.query,
        signals?.evidence?.slice(0, 2).join(" "),
        notes
      ]
        .map(s => String(s || "").trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);

      if (fallbackQuery) {
        const [specs, tasting] = await Promise.all([
          searchWhiskeyInfo(fallbackQuery).catch(() => null),
          searchTastingNotes(fallbackQuery).catch(() => null)
        ]);

        const specsStatus = specs?.status || (specs ? "ok" : "error");
        const tastingStatus = tasting?.status || (tasting ? "ok" : "error");
        const errorMessage = specs?.errorMessage || tasting?.errorMessage || "";
        const errorHint = specs?.errorHint || tasting?.errorHint || "";
        const statusCode = Number(specs?.statusCode || tasting?.statusCode || 0);
        const errorStatus = String(specs?.errorStatus || tasting?.errorStatus || "");

        let status = "ok";
        if (specsStatus === "disabled" && tastingStatus === "disabled") status = "disabled";
        else if (specsStatus === "error" || tastingStatus === "error") status = "error";

        webResearch = {
          query: fallbackQuery,
          status,
          statusCode,
          errorStatus,
          errorMessage,
          errorHint,
          summary: specs?.summary || "",
          results: specs?.results || [],
          tastingNotesSummary: tasting?.tastingNotesSummary || "",
          tastingResults: tasting?.results || []
        };

        if (status === "error" && errorMessage) {
          await sendSafe(`⚠️ Web research failed${statusCode ? ` (${statusCode}${errorStatus ? ` ${errorStatus}` : ""})` : ""}: ${errorMessage}${errorHint ? `\nHint: ${errorHint}` : ""}\nI'll infer tasting notes from label/producer patterns.`);
        } else if (status === "disabled") {
          await sendSafe("ℹ️ Web research is disabled (missing GOOGLE_API_KEY/GOOGLE_CX). I'll infer tasting notes from label/producer patterns.");
        } else if (status === "ok" && !webResearch.tastingNotesSummary) {
          await sendSafe("ℹ️ Web research ran, but I didn't find tasting-note snippets for this bottle. I'll infer tasting notes from label/producer patterns.");
        }

        tastingMode = webResearch.status === "ok" && Boolean(webResearch.tastingNotesSummary) ? "web_grounded" : "inferred";

        tastingPriors = buildTastingPriors({
          query: fallbackQuery,
          vendor: ident?.vendor || "",
          title: ident?.product_name || "",
          notes: notesWithUserAbv,
          abv: signals?.abv || abvFromInput || "",
          proof: signals?.proof || (typeof proof === "number" ? String(proof) : "")
        });
      }
    } catch (webErr) {
      console.warn("UPDATE SEARCH: failed:", webErr?.message || String(webErr));
    }

    const notesWithSignals = [
      notesWithUserAbv || "",
      signals ? `\n\nLABEL SIGNALS (detected): ${JSON.stringify({ store_pick: signals.store_pick, single_barrel: signals.single_barrel, abv: signals.abv, proof: signals.proof, evidence: signals.evidence })}` : ""
    ].join("");

    const aiData = await generateProductData({
      notes: notesWithSignals,
      imageUrl: recognitionImageUrl,
      webResearch,
      tastingPriors,
      tastingMode
    });

    // Merge signals into aiData if higher confidence (same rules as create flow)
    if (signals) {
      if (signals.store_pick) aiData.store_pick = true;
      if (signals.single_barrel) aiData.single_barrel = true;
      if (signals.abv && !String(aiData.abv || "").trim()) aiData.abv = signals.abv;
      if (signals.needs_abv) aiData.needs_abv = true;
    }

    // Prefer user input for ABV/proof when provided
    if (abvFromInput) {
      aiData.abv = abvFromInput;
      aiData.needs_abv = false;
    }

    console.log("UPDATE STEP 2 COMPLETE: AI DATA:", aiData);

    let needsAbv = Boolean(aiData.needs_abv) || !String(aiData.abv || "").trim();
    if (needsAbv) {
      aiData.abv = "";
    }

    // -------------------------
    // VENDOR VALIDATION (same as create flow)
    // -------------------------
    let needsVendor = false;
    let unmatchedVendor = "";
    let vendorCorrected = false;
    let vendorOriginal = "";
    try {
      if (aiData.vendor) {
        const candidates = await searchVendors(aiData.vendor);
        const match = matchVendor(aiData.vendor, candidates);
        if (match?.matchType === "exact") {
          aiData.vendor = match.vendor;
        } else if (match?.matchType === "close") {
          vendorOriginal = aiData.vendor;
          aiData.vendor = match.vendor;
          vendorCorrected = true;
        } else {
          needsVendor = true;
          unmatchedVendor = aiData.vendor;
        }
      } else {
        needsVendor = true;
        unmatchedVendor = "(empty)";
      }
    } catch (vendorErr) {
      console.warn("UPDATE VENDOR: search failed, keeping AI vendor as-is:", vendorErr?.message || String(vendorErr));
    }

    // -------------------------
    // BUILD METAFIELDS (same conventions as pipeline.js)
    // -------------------------
    const metafields = [
      mf("nose", Array.isArray(aiData.nose) ? aiData.nose.join(", ") : aiData.nose),
      mf("palate", Array.isArray(aiData.palate) ? aiData.palate.join(", ") : aiData.palate),
      mf("finish", Array.isArray(aiData.finish) ? aiData.finish.join(", ") : aiData.finish),
      mf("sub_type", aiData.sub_type),
      mfList("location_", aiData.country),
      mf("state", aiData.region),
      mfList("cask_wood", aiData.cask_wood),
      mfList("finish_type", aiData.finish_type),
      mf("age_statement", aiData.age_statement),
      // Only set ABV metafield when confidently known (same rule as create).
      ...(String(aiData.abv || "").trim() ? [mf("alcohol_by_volume", aiData.abv)] : []),
      mf("awards", aiData.awards),

      mb("finished", aiData.finished),
      mb("gift_pack", aiData.gift_pack),
      mb("store_pick", aiData.store_pick),
      mb("cask_strength", aiData.cask_strength),
      mb("single_barrel", aiData.single_barrel),
      mb("limited_boolean", aiData.limited_time_offer)
    ];

    // -------------------------
    // PRESERVATION: never overwrite a non-empty existing value with an empty new one.
    // We prefer NEW parsed values for the listing fields, but if the new parse is
    // empty/low-confidence we keep what the placeholder product already had.
    // -------------------------
    const fields = {
      title: preferNew(aiData.title, existing.title),
      description: preferNew(aiData.description, existing.descriptionHtml),
      vendor: needsVendor && unmatchedVendor === "(empty)"
        ? preferNew("", existing.vendor) // AI gave no vendor → keep existing
        : preferNew(aiData.vendor, existing.vendor),
      product_type: preferNew(aiData.product_type, existing.productType),
      metafields: filterMetafields(metafields, existing.metafields)
    };

    // Optional: attach a freshly generated studio image.
    if (regenerateImage && studioImageUrl) {
      fields.imageUrl = studioImageUrl;
    }

    // -------------------------
    // WRITE BACK
    // -------------------------
    await sendSafe("🛒 Updating Shopify product…");
    const updated = await updateProductListing(existing.id, fields);

    const productId = updated?.id || existing.id;
    const productTitle = String(updated?.title || fields.title || existing.title || "").trim();
    const adminUrl = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/products/${shortId(productId)}`;

    await sendSafe("✅ Product updated.");
    if (needsAbv) {
      await sendSafe("⚠️ ABV/proof wasn't found on the label with confidence, so I left **Alcohol by Volume** unchanged. Re-run with the **abv**/**proof** options to set it.");
    }
    if (vendorCorrected) {
      await sendSafe(`ℹ️ Vendor auto-corrected: AI said **"${vendorOriginal}"** → closest existing Shopify vendor **"${aiData.vendor}"**. Please verify.`);
    }
    if (needsVendor) {
      await sendSafe(`⚠️ The vendor **"${unmatchedVendor}"** was NOT found in existing Shopify vendors; left the product's vendor unchanged. Please verify.`);
    }

    console.log("UPDATE PIPELINE SUCCESS:", adminUrl);

    return {
      ok: true,
      productId,
      adminUrl,
      productTitle,
      needsAbv,
      needsVendor,
      unmatchedVendor,
      vendorCorrected,
      vendorOriginal,
      matchedBy
    };
  } catch (err) {
    console.error("UPDATE PIPELINE ERROR:", err);
    await sendSafe(`❌ Update failed: ${err?.message || String(err)}`);
    return { ok: false, error: err?.message || String(err) };
  }
}

// ============================================================================
// METAFIELD HELPERS — kept IDENTICAL to pipeline.js for listing consistency.
// ============================================================================

/**
 * TEXT metafield helper (single value)
 */
function mf(key, value) {
  return {
    namespace: "custom",
    key,
    value: String(value ?? ""),
    type: "single_line_text_field"
  };
}

/**
 * LIST metafield helper (for list.single_line_text_field types)
 * Accepts a string or array, returns JSON array string
 */
function mfList(key, value) {
  let arrayValue;
  if (Array.isArray(value)) {
    arrayValue = value.map(v => String(v ?? ""));
  } else if (typeof value === "string" && value.trim()) {
    // If it's a comma-separated string, split it
    arrayValue = value.split(",").map(v => v.trim()).filter(Boolean);
  } else {
    arrayValue = [];
  }

  return {
    namespace: "custom",
    key,
    value: JSON.stringify(arrayValue),
    type: "list.single_line_text_field"
  };
}

/**
 * BOOLEAN metafield helper
 * Value must be a string "true" or "false" for Shopify GraphQL
 */
function mb(key, value) {
  return {
    namespace: "custom",
    key,
    value: String(Boolean(value)),
    type: "boolean"
  };
}

// ============================================================================
// PRESERVATION HELPERS
// ============================================================================

/**
 * Prefer a non-empty NEW value; otherwise fall back to the existing value.
 * Never returns the empty/whitespace new value when an existing value exists.
 */
function preferNew(newVal, existingVal) {
  const n = newVal === undefined || newVal === null ? "" : String(newVal).trim();
  if (n) return newVal;
  return existingVal === undefined || existingVal === null ? undefined : existingVal;
}

/**
 * Decide whether a metafield value should be treated as "empty" (i.e. nothing
 * meaningful was parsed) so we can skip overwriting an existing value with it.
 */
function isEmptyMetafieldValue(mfObj) {
  const v = mfObj?.value;
  if (v === undefined || v === null) return true;
  const s = String(v).trim();
  if (!s) return true;
  // list metafields serialize to JSON arrays — treat "[]" as empty.
  if (mfObj.type && mfObj.type.startsWith("list.")) {
    if (s === "[]") return true;
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr) && arr.length === 0) return true;
    } catch { /* keep as-is */ }
  }
  return false;
}

/**
 * Filter the freshly-built metafields so we never clobber a non-empty existing
 * metafield with an empty new value. Booleans always pass through (a parsed
 * false is meaningful). Non-empty new values always pass through.
 */
function filterMetafields(newMetafields, existingMetafields = {}) {
  const out = [];
  for (const mfObj of newMetafields) {
    if (mfObj.type === "boolean") {
      out.push(mfObj);
      continue;
    }
    if (!isEmptyMetafieldValue(mfObj)) {
      out.push(mfObj);
      continue;
    }
    // New value is empty — only skip if the existing product already has a value.
    const fullKey = `${mfObj.namespace || "custom"}.${mfObj.key}`;
    const existingVal = existingMetafields?.[fullKey];
    const existingHas = existingVal !== undefined && existingVal !== null && String(existingVal).trim() && String(existingVal).trim() !== "[]";
    if (!existingHas) {
      // Nothing to preserve; harmless to send the empty value through.
      out.push(mfObj);
    }
    // else: preserve existing — drop the empty new metafield.
  }
  return out;
}

// ============================================================================
// MISC HELPERS
// ============================================================================

function describeRef(ref = {}) {
  if (ref.idOrGid) return `id:${ref.idOrGid}`;
  if (ref.handle) return `handle:${ref.handle}`;
  if (ref.sku) return `sku:${ref.sku}`;
  if (ref.barcode) return `barcode:${ref.barcode}`;
  if (ref.title) return `title:${ref.title}`;
  return "(none)";
}

function shortId(idOrGid) {
  const s = String(idOrGid || "");
  const m = s.match(/(\d+)\s*$/);
  return m ? m[1] : s;
}

/**
 * Default status logger (used when no send callback is supplied).
 */
async function consoleSend(message) {
  console.log("UPDATE:", message);
}
