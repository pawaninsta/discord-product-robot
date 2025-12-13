import { generateProductData } from "./ai.js";
import { generateStudioImage } from "./image.js";
import { createDraftProduct } from "./shopify.js";
import fetch from "node-fetch";

/**
 * Main pipeline:
 * Discord -> Image -> AI -> Shopify -> Discord
 */
export async function runPipeline({ image, cost, price, notes }) {
  console.log("PIPELINE START");
  console.log("Input received:", {
    imageUrl: image?.url,
    cost,
    price,
    notes
  });

  try {
    // -------------------------
    // STEP 1: IMAGE GENERATION
    // -------------------------
    await send("📸 Generating studio image…");
    console.log("STEP 1: Calling generateStudioImage");

    const finalImageUrl = await generateStudioImage(image.url);

    console.log("STEP 1 COMPLETE: Image URL:", finalImageUrl);

    // -------------------------
    // STEP 2: AI DESCRIPTION
    // -------------------------
    await send("🧠 Writing product listing…");
    console.log("STEP 2: Calling generateProductData");

    const aiData = await generateProductData({
  notes,
  imageUrl: finalImageUrl
});


    console.log("STEP 2 COMPLETE: AI data received:", aiData);

    // -------------------------
    // STEP 3: SHOPIFY PRODUCT
    // -------------------------
    await send("🛒 Creating Shopify draft…");
    console.log("STEP 3: Creating Shopify draft product");

    const product = await createDraftProduct({
      title: aiData.title,
      description: aiData.description,
      price,
      cost,
      imageUrl: finalImageUrl,
      metafields: [
  mf("nose", aiData.nose),
  mf("palate", aiData.palate),
  mf("finish", aiData.finish),
  mf("sub_type", aiData.sub_type),
  mf("country_of_origin", aiData.country),
  mf("region", aiData.region),
  mf("cask_wood", aiData.cask_wood),
  mf("finish_type", aiData.finish_type),
  mf("age_statement", aiData.age_statement),
  mf("alcohol_by_volume", aiData.abv),

  mb("finished", aiData.finished),
  mb("store_pick", aiData.store_pick),
  mb("cask_strength", aiData.cask_strength),
  mb("single_barrel", aiData.single_barrel),
  mb("limited_time_offer", aiData.limited_time_offer)
]
function mb(key, value) {
  return {
    namespace: "custom",
    key,
    value: Boolean(value),
    type: "boolean"
  };
}

    });

    console.log("STEP 3 COMPLETE: Shopify product created:", {
      id: product.id,
      title: product.title
    });

    // -------------------------
    // STEP 4: RETURN LINK
    // -------------------------
    const adminUrl = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/products/${product.id}`;

    await send(`✅ Draft created: ${adminUrl}`);
    console.log("PIPELINE SUCCESS:", adminUrl);

  } catch (err) {
    console.error("PIPELINE ERROR:", err);
    await send(`❌ Pipeline failed: ${err.message}`);
  }
}

/**
 * Helper to create Shopify metafields
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
 * Send message to Discord webhook
 */
async function send(message) {
  console.log("DISCORD:", message);

  await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message })
  });
}
