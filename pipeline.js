import { generateProductData } from "./ai.js";
import { generateStudioImage } from "./image.js";
import { createDraftProduct } from "./shopify.js";
import { searchWhiskeyInfo } from "./search.js";
import fetch from "node-fetch";

/**
 * Main pipeline:
 * Discord → Image → Google Search → AI → Shopify → Discord
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
    // STEP 2: WEB RESEARCH (optional)
    // -------------------------
    let webResearch = null;
    if (notes && notes.trim()) {
      await send("🔍 Researching product info…");
      console.log("STEP 2: Searching web for:", notes);
      webResearch = await searchWhiskeyInfo(notes);
      console.log("STEP 2 COMPLETE: Web research:", webResearch ? "Found" : "None");
    }

    // -------------------------
    // STEP 3: AI (VISION + RESEARCH)
    // -------------------------
    await send("🧠 Reading label & writing listing…");
    console.log("STEP 3: Calling generateProductData");

    const aiData = await generateProductData({
      notes,
      imageUrl: finalImageUrl,
      webResearch
    });

    console.log("STEP 3 COMPLETE: AI DATA:", aiData);

    // -------------------------
    // STEP 4: SHOPIFY
    // -------------------------
    await send("🛒 Creating Shopify draft…");
    console.log("STEP 4: Creating Shopify product");

    const product = await createDraftProduct({
      title: aiData.title,
      description: aiData.description,
      vendor: aiData.vendor,
      product_type: aiData.product_type,
      price,
      cost,
      imageUrl: finalImageUrl,
      metafields: [
        // Tasting notes (list fields)
        mfList("nose", aiData.nose),
        mfList("palate", aiData.palate),
        mfList("finish", aiData.finish),
        mfList("cask_wood", aiData.cask_wood),
        
        // Product details (single text fields)
        mf("sub_type", aiData.sub_type),
        mf("country_of_origin", aiData.country),
        mf("region", aiData.region),
        mf("finish_type", aiData.finish_type),
        mf("age_statement", aiData.age_statement),
        mf("alcohol_by_volume", aiData.abv),

        // Boolean fields
        mb("finished", aiData.finished),
        mb("store_pick", aiData.store_pick),
        mb("cask_strength", aiData.cask_strength),
        mb("single_barrel", aiData.single_barrel),
        mb("limited_time_offer", aiData.limited_time_offer)
      ]
    });

    if (!product || !product.id) {
      throw new Error("Shopify product creation failed");
    }

    const adminUrl = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/products/${product.id}`;

    // Build summary message
    const summary = [
      `✅ **Draft created!**`,
      ``,
      `📦 **${aiData.title}**`,
      `🏷️ Vendor: ${aiData.vendor}`,
      `🥃 Type: ${aiData.product_type} - ${aiData.sub_type}`,
      `🌍 Origin: ${aiData.country}, ${aiData.region}`,
      `📊 ABV: ${aiData.abv}`,
      `⏳ Age: ${aiData.age_statement}`,
      ``,
      `🔗 ${adminUrl}`
    ].join("\n");

    await send(summary);
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
