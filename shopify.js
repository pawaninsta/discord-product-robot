import fetch from "node-fetch";

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

export async function createDraftProduct(product) {
  console.log("SHOPIFY: Creating draft product");
  console.log("SHOPIFY PAYLOAD:", JSON.stringify(product, null, 2));

  let metafields = product.metafields || [];
  let attempt = 0;
  const maxAttempts = 5;

  while (attempt < maxAttempts) {
    attempt++;
    console.log(`SHOPIFY: Attempt ${attempt} with ${metafields.length} metafields`);

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
            metafields
          }
        })
      }
    );

    const text = await res.text();
    console.log("SHOPIFY RAW RESPONSE:", text);

    if (res.ok) {
      const data = JSON.parse(text);

      if (!data.product || !data.product.id) {
        throw new Error("Shopify response missing product");
      }

      console.log("SHOPIFY SUCCESS: Product created", data.product.id);
      return data.product;
    }

    // Handle 422 metafield type errors by retrying without problematic fields
    if (res.status === 422 && metafields.length > 0) {
      try {
        const errorData = JSON.parse(text);
        
        // Check if it's a metafield type error
        if (errorData.errors?.type || errorData.errors?.metafields) {
          console.log("SHOPIFY: Metafield type mismatch detected, removing problematic fields");
          
          // Try to identify which metafields are problematic from the error
          const errorStr = JSON.stringify(errorData.errors);
          
          // Remove metafields one by one based on type mismatch
          const listFields = metafields.filter(m => m.type === "list.single_line_text_field");
          const singleFields = metafields.filter(m => m.type === "single_line_text_field");
          
          if (errorStr.includes("'list.single_line_text_field' must be consistent")) {
            // Some list fields should be single - convert them
            metafields = metafields.map(m => {
              if (m.type === "list.single_line_text_field") {
                // Try to convert to single value
                try {
                  const arr = JSON.parse(m.value);
                  return {
                    ...m,
                    type: "single_line_text_field",
                    value: Array.isArray(arr) ? arr[0] || "" : String(m.value)
                  };
                } catch {
                  return { ...m, type: "single_line_text_field" };
                }
              }
              return m;
            });
            console.log("SHOPIFY: Converted list fields to single fields");
            continue;
          }
          
          if (errorStr.includes("'single_line_text_field' must be consistent")) {
            // Some single fields should be list - convert them
            metafields = metafields.map(m => {
              if (m.type === "single_line_text_field") {
                return {
                  ...m,
                  type: "list.single_line_text_field",
                  value: JSON.stringify([m.value].filter(Boolean))
                };
              }
              return m;
            });
            console.log("SHOPIFY: Converted single fields to list fields");
            continue;
          }
          
          // If we can't identify the specific issue, remove all metafields and retry
          console.log("SHOPIFY: Removing all metafields and retrying");
          metafields = [];
          continue;
        }
      } catch (parseErr) {
        console.log("SHOPIFY: Could not parse error response");
      }
    }

    // If we get here, it's a non-recoverable error
    throw new Error(`Shopify API error (${res.status}): ${text}`);
  }

  throw new Error("Shopify: Max retry attempts exceeded");
}
