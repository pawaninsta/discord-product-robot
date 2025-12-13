import fetch from "node-fetch";

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

/**
 * Create a draft product with metafields
 * Uses a two-step process to ensure metafields are saved:
 * 1. Create product
 * 2. Update metafields via separate call
 */
export async function createDraftProduct(product) {
  console.log("SHOPIFY: Creating draft product");
  console.log("SHOPIFY PAYLOAD:", JSON.stringify(product, null, 2));

  // Step 1: Create the product (without metafields to avoid type errors)
  const productData = await createProduct(product);
  
  if (!productData || !productData.id) {
    throw new Error("Shopify product creation failed");
  }

  console.log("SHOPIFY: Product created:", productData.id);

  // Step 2: Update metafields via GraphQL (more reliable)
  if (product.metafields && product.metafields.length > 0) {
    await updateMetafields(productData.id, product.metafields);
  }

  // Step 3: Publish to all sales channels
  await publishToAllChannels(productData.id);

  return productData;
}

/**
 * Create the base product
 */
async function createProduct(product) {
  const res = await fetch(
    `https://${SHOP}/admin/api/2024-10/products.json`,
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
          published_scope: "global", // Publish to all channels
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
            : []
        }
      })
    }
  );

  const text = await res.text();
  console.log("SHOPIFY: Create product response:", text);

  if (!res.ok) {
    throw new Error(`Shopify API error (${res.status}): ${text}`);
  }

  const data = JSON.parse(text);
  
  if (!data.product || !data.product.id) {
    throw new Error("Shopify response missing product");
  }

  console.log("SHOPIFY: Vendor:", data.product.vendor);
  console.log("SHOPIFY: Product Type:", data.product.product_type);

  return data.product;
}

/**
 * Update metafields using GraphQL API (more reliable than REST)
 */
async function updateMetafields(productId, metafields) {
  console.log("SHOPIFY: Updating metafields for product", productId);
  console.log("SHOPIFY: Metafields to set:", metafields.length);

  // Convert product ID to GraphQL GID format
  const gid = `gid://shopify/Product/${productId}`;

  // Build metafields array for GraphQL
  const metafieldsInput = metafields.map(mf => ({
    namespace: mf.namespace || "custom",
    key: mf.key,
    value: mf.value,
    type: mf.type
  }));

  const mutation = `
    mutation productUpdate($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          id
          metafields(first: 25) {
            edges {
              node {
                namespace
                key
                value
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    input: {
      id: gid,
      metafields: metafieldsInput
    }
  };

  try {
    const res = await fetch(
      `https://${SHOP}/admin/api/2024-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ query: mutation, variables })
      }
    );

    const data = await res.json();
    console.log("SHOPIFY: GraphQL response:", JSON.stringify(data, null, 2));

    if (data.errors) {
      console.error("SHOPIFY: GraphQL errors:", data.errors);
    }

    if (data.data?.productUpdate?.userErrors?.length > 0) {
      console.error("SHOPIFY: User errors:", data.data.productUpdate.userErrors);
      
      // Try setting metafields one by one to identify the problem
      console.log("SHOPIFY: Retrying metafields individually...");
      await updateMetafieldsIndividually(productId, metafields);
    } else {
      console.log("SHOPIFY: Metafields updated successfully");
      
      // Log which metafields were set
      const savedMetafields = data.data?.productUpdate?.product?.metafields?.edges || [];
      console.log("SHOPIFY: Saved metafields:", savedMetafields.length);
    }

  } catch (err) {
    console.error("SHOPIFY: Metafield update failed:", err.message);
    // Don't throw - product was still created
  }
}

/**
 * Try updating metafields one by one to identify issues
 */
async function updateMetafieldsIndividually(productId, metafields) {
  const gid = `gid://shopify/Product/${productId}`;
  let successCount = 0;

  for (const mf of metafields) {
    const mutation = `
      mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product { id }
          userErrors { field message }
        }
      }
    `;

    const variables = {
      input: {
        id: gid,
        metafields: [{
          namespace: mf.namespace || "custom",
          key: mf.key,
          value: mf.value,
          type: mf.type
        }]
      }
    };

    try {
      const res = await fetch(
        `https://${SHOP}/admin/api/2024-10/graphql.json`,
        {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": TOKEN,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ query: mutation, variables })
        }
      );

      const data = await res.json();
      
      if (data.data?.productUpdate?.userErrors?.length > 0) {
        console.error(`SHOPIFY: Failed to set ${mf.key}:`, data.data.productUpdate.userErrors[0].message);
      } else {
        console.log(`SHOPIFY: Successfully set ${mf.key}`);
        successCount++;
      }

    } catch (err) {
      console.error(`SHOPIFY: Error setting ${mf.key}:`, err.message);
    }
  }

  console.log(`SHOPIFY: Set ${successCount}/${metafields.length} metafields individually`);
}

/**
 * Publish product to all sales channels
 * Requires read_publications and write_publications scopes on API token
 */
async function publishToAllChannels(productId) {
  console.log("SHOPIFY: Publishing to all sales channels");

  const gid = `gid://shopify/Product/${productId}`;

  // First, get all publication IDs
  const publicationsQuery = `
    query {
      publications(first: 20) {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  `;

  try {
    const pubRes = await fetch(
      `https://${SHOP}/admin/api/2024-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ query: publicationsQuery })
      }
    );

    const pubData = await pubRes.json();
    
    // Check for GraphQL errors (usually indicates missing scopes)
    if (pubData.errors) {
      console.error("SHOPIFY: Publications query error:", JSON.stringify(pubData.errors));
      console.error("SHOPIFY: ⚠️  Make sure your API token has 'read_publications' scope!");
      return;
    }

    const publications = pubData.data?.publications?.edges || [];
    
    // Check if publications query returned empty
    if (publications.length === 0) {
      console.warn("SHOPIFY: ⚠️  No publications found!");
      console.warn("SHOPIFY: This usually means the API token is missing 'read_publications' scope.");
      console.warn("SHOPIFY: Add 'read_publications' and 'write_publications' scopes to your Shopify Admin API token.");
      return;
    }

    const channelNames = publications.map(p => p.node.name).join(", ");
    console.log("SHOPIFY: Found publications:", channelNames);

    // Publish to each channel
    let successCount = 0;
    for (const pub of publications) {
      const publishMutation = `
        mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
          publishablePublish(id: $id, input: $input) {
            publishable {
              ... on Product {
                id
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      try {
        const publishRes = await fetch(
          `https://${SHOP}/admin/api/2024-10/graphql.json`,
          {
            method: "POST",
            headers: {
              "X-Shopify-Access-Token": TOKEN,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              query: publishMutation,
              variables: {
                id: gid,
                input: [{ publicationId: pub.node.id }]
              }
            })
          }
        );

        const publishData = await publishRes.json();
        
        if (publishData.errors) {
          console.error(`SHOPIFY: Failed to publish to ${pub.node.name}:`, publishData.errors[0]?.message);
        } else if (publishData.data?.publishablePublish?.userErrors?.length > 0) {
          console.error(`SHOPIFY: Failed to publish to ${pub.node.name}:`, 
            publishData.data.publishablePublish.userErrors[0].message);
        } else {
          console.log(`SHOPIFY: ✓ Published to ${pub.node.name}`);
          successCount++;
        }
      } catch (pubErr) {
        console.error(`SHOPIFY: Error publishing to ${pub.node.name}:`, pubErr.message);
      }
    }

    console.log(`SHOPIFY: Published to ${successCount}/${publications.length} channels`);

  } catch (err) {
    console.error("SHOPIFY: Failed to publish to channels:", err.message);
    // Don't throw - product was still created
  }
}
