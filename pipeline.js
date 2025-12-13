import { generateProductData } from "./ai.js";
import { generateStudioImage } from "./image.js";
import { createDraftProduct } from "./shopify.js";
import fetch from "node-fetch";

export async function runPipeline({ image, cost, price, notes }) {
  await send("📸 Generating studio image…");
  const finalImage = await generateStudioImage(image.url);

  await send("🧠 Writing product listing…");
  const ai = await generateProductData({ notes });

  await send("🛒 Creating Shopify draft…");
  const product = await createDraftProduct({
    title: ai.title,
    description: ai.description,
    price,
    cost,
    imageUrl: finalImage,
    metafields: [
      mf("nose", ai.nose),
      mf("palate", ai.palate),
      mf("finish", ai.finish),
      mf("alcohol_by_volume", ai.abv),
      mf("region", ai.region),
      mf("country_of_origin", ai.country)
    ]
  });

  await send(`✅ Draft created: https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/products/${product.id}`);
}

function mf(key, value) {
  return {
    namespace: "custom",
    key,
    value,
    type: "single_line_text_field"
  };
}

async function send(msg) {
  await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: msg })
  });
}
