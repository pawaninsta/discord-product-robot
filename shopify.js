import fetch from "node-fetch";

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

export async function createDraftProduct(product) {
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
          variants: [{
            price: product.price,
            cost: product.cost
          }],
          images: [{
            src: product.imageUrl
          }],
          metafields: product.metafields
        }
      })
    }
  );

  const data = await res.json();
  return data.product;
}
