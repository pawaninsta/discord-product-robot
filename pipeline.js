import { generateProductData } from "./ai.js";
import { generateStudioImage } from "./image.js";
import { createDraftProduct } from "./shopify.js";
import { searchWhiskeyInfo, searchTastingNotes } from "./search.js";
import { extractLabelSignals, identifyBottleForSearch } from "./ai.js";
import fetch from "node-fetch";

/**
 * Main pipeline:
 * Discord → Image → AI → Shopify → Discord
 */
export async function runPipeline({ image, cost, price, abv, proof, quantity, barcode, referenceLink, notes, send } = {}) {
  console.log("PIPELINE START");

  const sendImpl = typeof send === "function" ? send : webhookSend;
  const sendSafe = async (message) => {
    try {
      await sendImpl(message);
    } catch (e) {
      console.warn("DISCORD: send failed:", e?.message || String(e));
    }
  };

  let adminUrl = "";
  let needsAbv = false;

  try {
    // -------------------------
    // STEP 1: IMAGE
    // -------------------------
    await sendSafe("📸 Generating studio image…");
    console.log("STEP 1: Image input:", image.url);

    const finalImageUrl = await generateStudioImage(image.url);

    console.log("STEP 1 COMPLETE: Image URL:", finalImageUrl);

    // -------------------------
    // STEP 2: AI (VISION) + RESEARCH + SIGNALS
    // -------------------------
    await sendSafe("🧠 Writing product listing…");
    console.log("STEP 2: Calling generateProductData");

    // Normalize user-provided ABV/proof (preferred over guessing)
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
      abvFromInput ? `ABV: ${abvFromInput}` : ""
    ].filter(Boolean).join("\n");

    // Extract a few high-signal facts first (ABV/proof, store pick, single barrel)
    let signals = null;
    try {
      signals = await extractLabelSignals({ notes: notesWithUserAbv, imageUrl: finalImageUrl });
      console.log("SIGNALS:", JSON.stringify(signals));
    } catch (sigErr) {
      console.warn("SIGNALS: failed:", sigErr?.message || String(sigErr));
    }

    // Web research (tasting notes + specs) to reduce generic output
    let webResearch = null;
    try {
      // Step A: identify bottle for a clean search query
      const ident = await identifyBottleForSearch({ notes: notesWithUserAbv, imageUrl: finalImageUrl }).catch(() => null);
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

        webResearch = {
          query: fallbackQuery,
          summary: specs?.summary || "",
          results: specs?.results || [],
          tastingNotesSummary: tasting?.tastingNotesSummary || "",
          tastingResults: tasting?.results || []
        };
      }
    } catch (webErr) {
      console.warn("SEARCH: failed:", webErr?.message || String(webErr));
    }

    const notesWithSignals = [
      notesWithUserAbv || "",
      signals ? `\n\nLABEL SIGNALS (detected): ${JSON.stringify({ store_pick: signals.store_pick, single_barrel: signals.single_barrel, abv: signals.abv, proof: signals.proof, evidence: signals.evidence })}` : ""
    ].join("");

    const aiData = await generateProductData({
      notes: notesWithSignals,
      imageUrl: finalImageUrl,
      webResearch
    });

    // Merge signals into aiData if they are higher confidence
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

    console.log("STEP 2 COMPLETE: AI DATA:", aiData);

    // If ABV couldn't be found, continue the workflow but omit ABV and notify the user at the end.
    needsAbv = Boolean(aiData.needs_abv) || !String(aiData.abv || "").trim();
    if (needsAbv) {
      aiData.abv = "";
    }

    // Do NOT append reference/search links to the customer-facing description.
    // Instead, store them as internal Shopify tags (visible in admin, not on PDP).
    const tags = [];
    if (referenceLink) {
      const clean = String(referenceLink).trim();
      if (clean) tags.push(`ref:${clean}`);
    }
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(aiData.title || "")}`;
    if (aiData.title) tags.push(`search:${searchUrl}`);

    // -------------------------
    // STEP 3: SHOPIFY
    // -------------------------
    await sendSafe("🛒 Creating Shopify draft…");
    console.log("STEP 3: Creating Shopify product");

    // #region agent log
    (()=>{const payload={sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H7',location:'pipeline.js:43',message:'Preparing Shopify payload',data:{aiVendor:aiData?.vendor||null,aiProductType:aiData?.product_type||null,metafieldKeys:['nose','palate','finish','sub_type','location_','state','cask_wood','finish_type','age_statement','alcohol_by_volume','finished','store_pick','cask_strength','single_barrel','limited_boolean'],imageUrlIsDataUrl:typeof finalImageUrl==='string'&&finalImageUrl.startsWith('data:')},timestamp:Date.now()};console.log("AGENT_LOG",JSON.stringify(payload));globalThis.fetch?.('http://127.0.0.1:7242/ingest/5a136f99-0f58-49f0-8eb8-c368792b2230',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).catch(()=>{});})();
    // #endregion

    const product = await createDraftProduct({
      title: aiData.title,
      description: aiData.description,
      vendor: aiData.vendor,
      product_type: aiData.product_type,
      price,
      cost,
      imageUrl: finalImageUrl,
      barcode,
      quantity,
      tags,
      metafields: [
        // NOTE: These metafield definitions are single_line_text_field in Shopify
        mf("nose", Array.isArray(aiData.nose) ? aiData.nose.join(", ") : aiData.nose),
        mf("palate", Array.isArray(aiData.palate) ? aiData.palate.join(", ") : aiData.palate),
        mf("finish", Array.isArray(aiData.finish) ? aiData.finish.join(", ") : aiData.finish),
        mf("sub_type", aiData.sub_type),
        // NOTE: Shopify definition expects list.single_line_text_field
        mfList("location_", aiData.country),
        mf("state", aiData.region),
        mfList("cask_wood", aiData.cask_wood),
        // NOTE: Shopify definition expects list.single_line_text_field
        mfList("finish_type", aiData.finish_type),
        mf("age_statement", aiData.age_statement),
        // Only set ABV when confidently known; otherwise omit it and ask the user after draft creation.
        ...(String(aiData.abv || "").trim() ? [mf("alcohol_by_volume", aiData.abv)] : []),
        mf("awards", aiData.awards),

        mb("finished", aiData.finished),
        mb("gift_pack", aiData.gift_pack),
        mb("store_pick", aiData.store_pick),
        mb("cask_strength", aiData.cask_strength),
        mb("single_barrel", aiData.single_barrel),
        mb("limited_boolean", aiData.limited_time_offer)
      ]
    });

    if (!product || !product.id) {
      throw new Error("Shopify product creation failed");
    }

    adminUrl = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/products/${product.id}`;

    await sendSafe(`✅ Draft created: ${adminUrl}`);
    if (needsAbv) {
      await sendSafe("⚠️ ABV/proof wasn’t found on the label with confidence, so I left **Alcohol by Volume** blank. Please fill it in manually or re-run with the **abv**/**proof** command options.");
    }
    console.log("PIPELINE SUCCESS:", adminUrl);

    return { ok: true, adminUrl, needsAbv, productId: product.id };
  } catch (err) {
    console.error("PIPELINE ERROR:", err);
    await sendSafe(`❌ Pipeline failed: ${err?.message || String(err)}`);
    return { ok: false, error: err?.message || String(err) };
  }
}

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

/**
 * Discord webhook helper
 */
async function webhookSend(message) {
  console.log("DISCORD:", message);
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: String(message ?? "") })
  });
}
