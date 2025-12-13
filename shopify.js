import fetch from "node-fetch";

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

/**
 * Metafield type mapping based on your Shopify store definitions
 * Based on the Product metafields screenshot
 */
const METAFIELD_TYPES = {
  // List fields (tasting notes)
  nose: "list.single_line_text_field",
  palate: "list.single_line_text_field",
  finish: "list.single_line_text_field",
  cask_wood: "list.single_line_text_field",
  
  // Single text fields
  sub_type: "single_line_text_field",
  country_of_origin: "single_line_text_field",
  region: "single_line_text_field",
  finish_type: "single_line_text_field",
  age_statement: "single_line_text_field",
  alcohol_by_volume: "single_line_text_field",
  awards: "single_line_text_field",
  gift_pack: "single_line_text_field",
  
  // Boolean fields
  finished: "boolean",
  store_pick: "boolean",
  cask_strength: "boolean",
  single_barrel: "boolean",
  limited_time_offer: "boolean"
};

/**
 * Fix metafield types to match Shopify definitions
 */
function fixMetafieldTypes(metafields) {
  return metafields.map(mf => {
    const correctType = METAFIELD_TYPES[mf.key];
    
    if (!correctType || mf.type === correctType) {
      return mf;
    }
    
    console.log(`SHOPIFY: Fixing ${mf.key} from ${mf.type} to ${correctType}`);
    
    // Convert list to single
    if (mf.type === "list.single_line_text_field" && correctType === "single_line_text_field") {
      let value = mf.value;
      try {
        const arr = JSON.parse(mf.value);
        value = Array.isArray(arr) ? arr[0] || "" : String(mf.value);
      } catch {
        value = String(mf.value);
      }
      return { ...mf, type: correctType, value };
    }
    
    // Convert single to list
    if (mf.type === "single_line_text_field" && correctType === "list.single_line_text_field") {
      const value = JSON.stringify([mf.value].filter(Boolean));
      return { ...mf, type: correctType, value };
    }
    
    return { ...mf, type: correctType };
  });
}

export async function createDraftProduct(product) {
  console.log("SHOPIFY: Creating draft product");
  console.log("SHOPIFY PAYLOAD:", JSON.stringify(product, null, 2));

  // Fix metafield types before first attempt
  let metafields = fixMetafieldTypes(product.metafields || []);
  
  // Attempt 1: With corrected metafields
  console.log(`SHOPIFY: Attempt 1 with ${metafields.length} metafields`);
  
  let res = await makeRequest(product, metafields);
  let text = await res.text();
  console.log("SHOPIFY RAW RESPONSE:", text);

  if (res.ok) {
    return parseSuccess(text);
  }

  // Attempt 2: Without metafields (fallback)
  if (res.status === 422) {
    console.log("SHOPIFY: Metafield error, retrying without metafields");
    
    res = await makeRequest(product, []);
    text = await res.text();
    console.log("SHOPIFY RAW RESPONSE (no metafields):", text);

    if (res.ok) {
      console.log("SHOPIFY: Product created without metafields - add them manually in Shopify admin");
      return parseSuccess(text);
    }
  }

  throw new Error(`Shopify API error (${res.status}): ${text}`);
}

async function makeRequest(product, metafields) {
  return fetch(
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
          vendor: product.vendor || "The Whiskey Library",
          product_type: product.product_type || "",
          status: "draft",
          variants: [
            {
              price: product.price,
              cost: product.cost,
              inventory_management: "shopify",
              inventory_policy: "deny",
              weight: 3.5,
              weight_unit: "lb",
              requires_shipping: true
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
}

function parseSuccess(text) {
  const data = JSON.parse(text);

  if (!data.product || !data.product.id) {
    throw new Error("Shopify response missing product");
  }

  console.log("SHOPIFY SUCCESS: Product created", data.product.id);
  console.log("SHOPIFY: Vendor set to:", data.product.vendor);
  console.log("SHOPIFY: Product Type set to:", data.product.product_type);
  
  return data.product;
}
