import { generateProductData } from "./ai.js";
import { generateStudioImage } from "./image.js";
import { createDraftProduct } from "./shopify.js";
import { searchWhiskeyInfo } from "./search.js";
import { extractLabelSignals } from "./ai.js";
import fetch from "node-fetch";

/**
 * Main pipeline:
 * Discord → Image → AI → Shopify → Discord
 */
export async function runPipeline({ image, cost, price, notes }) {
  console.log("PIPELINE START");

  try {
    // -------------------------
    // STEP 1: IMAGE
    // -------------------------
    await send("📸 Generating studio image…");
    console.log("STEP 1: Image input:", image.url);

    const finalImageUrl = await generateStudioImage(image.url);

    console.log("STEP 1 COMPLETE: Image URL:", finalImageUrl);

    // -------------------------
    // STEP 2: AI (VISION) + RESEARCH + SIGNALS
    // -------------------------
    await send("🧠 Writing product listing…");
    console.log("STEP 2: Calling generateProductData");

    // Extract a few high-signal facts first (ABV/proof, store pick, single barrel)
    let signals = null;
    try {
      signals = await extractLabelSignals({ notes, imageUrl: finalImageUrl });
      console.log("SIGNALS:", JSON.stringify(signals));
    } catch (sigErr) {
      console.warn("SIGNALS: failed:", sigErr?.message || String(sigErr));
    }

    // Optional web research to reduce generic output
    let webResearch = null;
    try {
      const query = signals?.store_pick
        ? `${signals?.evidence?.[0] || ""} ${signals?.evidence?.[1] || ""}`.trim()
        : "";
      // Fall back to vendor/title once we have aiData if this returns empty.
      if (query) webResearch = await searchWhiskeyInfo(query);
    } catch (webErr) {
      console.warn("SEARCH: failed:", webErr?.message || String(webErr));
    }

    const notesWithSignals = [
      notes || "",
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

    console.log("STEP 2 COMPLETE: AI DATA:", aiData);

    // If ABV couldn't be found, ask the user and stop before creating the Shopify product.
    if (aiData.needs_abv || !String(aiData.abv || "").trim()) {
      await send("❓ I couldn’t find ABV/proof on the label. Please re-run `/create-product` and include it in **notes** like `ABV: 53.5%` (or `Proof: 107`).");
      console.log("PIPELINE STOP: Missing ABV; user clarification requested");
      return;
    }

    // -------------------------
    // STEP 3: SHOPIFY
    // -------------------------
    await send("🛒 Creating Shopify draft…");
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
        mf("alcohol_by_volume", aiData.abv),
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

const adminUrl = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/products/${product.id}`;


    await send(`✅ Draft created: ${adminUrl}`);
    console.log("PIPELINE SUCCESS:", adminUrl);

  } catch (err) {
    console.error("PIPELINE ERROR:", err);
    await send(`❌ Pipeline failed: ${err.message}`);
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
async function send(message) {
  console.log("DISCORD:", message);

  await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message })
  });
}
