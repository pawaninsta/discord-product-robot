import fetch from "node-fetch";

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

export async function createDraftProduct(product) {
  console.log("SHOPIFY: Creating draft product");
  console.log("SHOPIFY PAYLOAD:", JSON.stringify(product, null, 2));

  const res = await fetch(
    `https://${SHOP}/admin/api/2024-01/products.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        product: {
          title: product.title,
          body_html: product.description,
          status: "draft",
          variants: [
            {
              price: product.price,
              cost: product.cost
            }
          ],
          images: product.imageUrl
            ? [{ src: product.imageUrl }]
            : [],
          metafields: product.metafields || []
        }
      })
    }
  );

  const text = await res.text();
  console.log("SHOPIFY RAW RESPONSE:", text);

  if (!res.ok) {
    throw new Error(`Shopify API error (${res.status}): ${text}`);
  }

  const data = JSON.parse(text);

  if (!data.product || !data.product.id) {
    throw new Error("Shopify response missing product");
  }

  console.log("SHOPIFY SUCCESS: Product created", data.product.id);

  return data.product;
}
