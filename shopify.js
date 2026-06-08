import fetch from "node-fetch";
import FormData from "form-data";
import { Readable } from "stream";

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

/**
 * Get a product by its numeric ID (or GID)
 * Returns product data with metafields for tasting card generation
 */
export async function getProductById(productId) {
  console.log("SHOPIFY: Fetching product by ID:", productId);

  // Normalize to GID if just numeric ID provided
  const gid = String(productId).startsWith("gid://")
    ? productId
    : `gid://shopify/Product/${productId}`;

  // Filter by namespace:"custom" so pagination only counts our metafields,
  // not app/theme/SEO metafields that could push ours past the `first` limit.
  const query = `
    query GetProduct($id: ID!) {
      product(id: $id) {
        id
        title
        handle
        descriptionHtml
        featuredImage {
          url
        }
        variants(first: 1) {
          edges {
            node {
              price
            }
          }
        }
        metafields(namespace: "custom", first: 50) {
          edges {
            node {
              namespace
              key
              value
            }
          }
        }
      }
    }
  `;

  const res = await fetch(
    `https://${SHOP}/admin/api/2024-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, variables: { id: gid } })
    }
  );

  const data = await res.json();

  if (data.errors) {
    console.error("SHOPIFY: GraphQL errors:", data.errors);
    throw new Error(`Shopify GraphQL error: ${data.errors[0]?.message}`);
  }

  const product = data.data?.product;
  if (!product) {
    throw new Error(`Product not found: ${productId}`);
  }

  // Parse metafields into a flat object
  const metafields = {};
  for (const edge of product.metafields?.edges || []) {
    const node = edge.node;
    const fullKey = `${node.namespace}.${node.key}`;
    metafields[fullKey] = node.value;
  }

  const mfKeys = Object.keys(metafields);
  console.log(`SHOPIFY: Fetched ${mfKeys.length} metafields:`, mfKeys.join(", "));

  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    descriptionHtml: product.descriptionHtml,
    imageUrl: product.featuredImage?.url,
    price: product.variants?.edges?.[0]?.node?.price,
    metafields
  };
}

/**
 * Upload a file (PNG buffer) to Shopify Files via stagedUploadsCreate + fileCreate
 * Returns the MediaImage GID and CDN URL
 */
export async function uploadFileToShopify(pngBuffer, filename = "tasting-card.png") {
  console.log("SHOPIFY: Uploading file to Shopify Files:", filename, "size:", pngBuffer.length);

  // Step 1: Create staged upload target
  const stagedUploadMutation = `
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters {
            name
            value
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const stagedRes = await fetch(
    `https://${SHOP}/admin/api/2024-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: stagedUploadMutation,
        variables: {
          input: [{
            resource: "FILE",
            filename,
            mimeType: "image/png",
            httpMethod: "POST"
          }]
        }
      })
    }
  );

  const stagedData = await stagedRes.json();

  if (stagedData.errors || stagedData.data?.stagedUploadsCreate?.userErrors?.length > 0) {
    const errors = stagedData.errors || stagedData.data.stagedUploadsCreate.userErrors;
    console.error("SHOPIFY: Staged upload errors:", errors);
    
    // Check for ACCESS_DENIED error and provide helpful guidance
    const isAccessDenied = stagedData.errors?.some(e => e?.extensions?.code === "ACCESS_DENIED");
    if (isAccessDenied) {
      throw new Error(
        `Staged upload failed: ACCESS_DENIED. ` +
        `Your Shopify Admin API token is missing the 'write_files' scope. ` +
        `Go to Shopify Admin → Settings → Apps → Develop apps → Your App → Configuration → Admin API integration, ` +
        `add 'write_files' and 'read_files' scopes, save, and regenerate the API token.`
      );
    }
    
    throw new Error(`Staged upload failed: ${JSON.stringify(errors)}`);
  }

  const target = stagedData.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) {
    throw new Error("No staged upload target returned");
  }

  console.log("SHOPIFY: Staged upload URL:", target.url);

  // Step 2: Upload the file to the staged URL
  const formData = new FormData();
  for (const param of target.parameters) {
    formData.append(param.name, param.value);
  }

  // CRITICAL FIX: form-data requires a stream, not raw buffer.
  // Readable.from(buffer) iterates over bytes as numbers, so we must wrap in array.
  // Also ensure we have a proper Node.js Buffer, not Uint8Array.
  const safeBuffer = Buffer.isBuffer(pngBuffer) ? pngBuffer : Buffer.from(pngBuffer);
  const bufferStream = Readable.from([safeBuffer]);
  formData.append("file", bufferStream, {
    filename,
    contentType: "image/png",
    knownLength: safeBuffer.length
  });

  const uploadRes = await fetch(target.url, {
    method: "POST",
    body: formData,
    headers: formData.getHeaders()
  });

  if (!uploadRes.ok) {
    const uploadText = await uploadRes.text();
    console.error("SHOPIFY: File upload failed:", uploadRes.status, uploadText);
    throw new Error(`File upload failed: ${uploadRes.status}`);
  }

  console.log("SHOPIFY: File uploaded to staged URL");

  // Step 3: Create the file in Shopify
  const fileCreateMutation = `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          ... on MediaImage {
            id
            image {
              url
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

  const fileRes = await fetch(
    `https://${SHOP}/admin/api/2024-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: fileCreateMutation,
        variables: {
          files: [{
            contentType: "IMAGE",
            originalSource: target.resourceUrl
          }]
        }
      })
    }
  );

  const fileData = await fileRes.json();

  if (fileData.errors || fileData.data?.fileCreate?.userErrors?.length > 0) {
    const errors = fileData.errors || fileData.data.fileCreate.userErrors;
    console.error("SHOPIFY: File create errors:", errors);
    throw new Error(`File create failed: ${JSON.stringify(errors)}`);
  }

  const file = fileData.data?.fileCreate?.files?.[0];
  if (!file) {
    throw new Error("No file created");
  }

  console.log("SHOPIFY: File created:", file.id);

  return {
    id: file.id,
    url: file.image?.url
  };
}

/**
 * Set a metafield on a product
 * 
 * @param {string} productId - Product ID (numeric or GID)
 * @param {string} namespace - Metafield namespace (e.g., "custom")
 * @param {string} key - Metafield key
 * @param {string} value - Value to set
 * @param {string} type - Metafield type (default: "single_line_text_field")
 *                        Common types: "single_line_text_field", "file_reference", "number_integer"
 */
export async function setProductMetafield(productId, namespace, key, value, type = "single_line_text_field") {
  console.log("SHOPIFY: Setting metafield", `${namespace}.${key}`, "on product:", productId, "type:", type);

  // Normalize to GID if just numeric ID provided
  const productGid = String(productId).startsWith("gid://")
    ? productId
    : `gid://shopify/Product/${productId}`;

  const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          key
          value
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const res = await fetch(
    `https://${SHOP}/admin/api/2024-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          metafields: [{
            ownerId: productGid,
            namespace,
            key,
            value,
            type
          }]
        }
      })
    }
  );

  const data = await res.json();

  if (data.errors || data.data?.metafieldsSet?.userErrors?.length > 0) {
    const errors = data.errors || data.data.metafieldsSet.userErrors;
    console.error("SHOPIFY: Metafield set errors:", errors);
    throw new Error(`Metafield set failed: ${JSON.stringify(errors)}`);
  }

  console.log("SHOPIFY: Metafield set successfully");
  return data.data?.metafieldsSet?.metafields?.[0];
}

/**
 * Run a single vendor search query against Shopify and return unique vendor strings.
 */
async function _vendorQuery(searchQuery) {
  const query = `
    query SearchVendors($searchQuery: String!) {
      products(first: 20, query: $searchQuery) {
        edges {
          node {
            vendor
          }
        }
      }
    }
  `;

  const res = await fetch(
    `https://${SHOP}/admin/api/2024-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query,
        variables: { searchQuery }
      })
    }
  );

  const data = await res.json();

  if (data.errors) {
    console.error("SHOPIFY: _vendorQuery GraphQL errors:", data.errors);
    throw new Error(`Vendor search failed: ${data.errors[0]?.message}`);
  }

  const edges = data.data?.products?.edges || [];
  const vendors = new Set();
  for (const edge of edges) {
    const v = String(edge.node?.vendor || "").trim();
    if (v) vendors.add(v);
  }
  return [...vendors];
}

/**
 * Search for existing Shopify vendors matching a query string.
 * 1. Tries exact match first (vendor:"Ancient Ancient Age")
 * 2. If no results, does broader word-based searches (vendor:Ancient, vendor:Age)
 *    to find close matches like "Ancient Age"
 * Returns an array of unique vendor strings found in the store.
 */
export async function searchVendors(vendorQuery) {
  if (!vendorQuery || !String(vendorQuery).trim()) return [];

  const trimmed = String(vendorQuery).trim();

  // Step 1: Exact match
  const exact = await _vendorQuery(`vendor:"${trimmed}"`);
  if (exact.length > 0) {
    console.log("SHOPIFY: searchVendors exact match found:", exact);
    return exact;
  }

  // Step 2: Broader word-based search — find vendors containing any of the words
  const words = [...new Set(trimmed.toLowerCase().split(/\s+/).filter(w => w.length >= 3))];
  if (words.length === 0) {
    console.log("SHOPIFY: searchVendors no usable words for broad search");
    return [];
  }

  const allVendors = new Set();
  for (const word of words) {
    const found = await _vendorQuery(`vendor:${word}`);
    for (const v of found) allVendors.add(v);
  }

  console.log("SHOPIFY: searchVendors broad search found:", [...allVendors]);
  return [...allVendors];
}

/**
 * Match an AI-generated vendor string against a list of existing Shopify vendors.
 * Returns { vendor, matchType } or null.
 *   matchType: "exact"  — case-insensitive exact match
 *              "close"  — one name contains the other, or high word overlap
 */
export function matchVendor(aiVendor, candidateVendors) {
  if (!aiVendor || !Array.isArray(candidateVendors) || candidateVendors.length === 0) {
    return null;
  }

  const normalized = String(aiVendor).trim().toLowerCase();
  const aiWords = normalized.split(/\s+/);

  // Pass 1: Exact case-insensitive match
  for (const candidate of candidateVendors) {
    if (String(candidate).trim().toLowerCase() === normalized) {
      return { vendor: candidate, matchType: "exact" };
    }
  }

  // Pass 2: Containment — one vendor name contains the other entirely
  // e.g., AI says "Ancient Ancient Age" but DB has "Ancient Age"
  let bestClose = null;
  let bestOverlap = 0;

  for (const candidate of candidateVendors) {
    const candNorm = String(candidate).trim().toLowerCase();
    const candWords = candNorm.split(/\s+/);

    // Check containment (either direction)
    if (normalized.includes(candNorm) || candNorm.includes(normalized)) {
      // Prefer the longer overlap (more specific match)
      if (candNorm.length > bestOverlap) {
        bestClose = candidate;
        bestOverlap = candNorm.length;
      }
      continue;
    }

    // Check word overlap — e.g., "Buffalo Trace Distillery" vs "Buffalo Trace"
    const shared = aiWords.filter(w => candWords.includes(w)).length;
    const overlapRatio = shared / Math.max(aiWords.length, candWords.length);
    if (overlapRatio >= 0.5 && shared >= 1 && shared > bestOverlap) {
      bestClose = candidate;
      bestOverlap = shared;
    }
  }

  if (bestClose) {
    return { vendor: bestClose, matchType: "close" };
  }

  return null;
}

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
          tags: Array.isArray(product.tags) ? product.tags.join(", ") : (product.tags || ""),
          status: "draft",
          published_scope: "global", // Publish to all channels
          variants: [
            {
              price: product.price,
              cost: product.cost,
              inventory_management: "shopify",
              inventory_policy: "deny",
              inventory_quantity: typeof product.quantity === "number" ? product.quantity : undefined,
              barcode: product.barcode ? String(product.barcode) : undefined,
              weight: 3.5,
              weight_unit: "lb",
              requires_shipping: true
            }
          ],
          images: (() => {
            if (!product.imageUrl) return [];
            // If we received a data URL (e.g., from OpenAI image edits), upload via base64 attachment.
            if (typeof product.imageUrl === "string" && product.imageUrl.startsWith("data:")) {
              const match = product.imageUrl.match(/^data:(.+?);base64,(.+)$/);
              const attachment = match?.[2];
              if (!attachment) return [];
              return [{ attachment, filename: "studio.png" }];
            }
            return [{ src: product.imageUrl }];
          })()
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

// ============================================================================
// UPDATE FLOW (append-only additions for the /update-product capability)
// These functions resolve an EXISTING product and update its listing fields.
// They never create products and never touch price/cost/inventory.
// ============================================================================

/**
 * Internal: run a GraphQL request against the Admin API and return parsed JSON.
 * Throws on top-level GraphQL `errors`.
 */
async function _graphql(query, variables) {
  const res = await fetch(
    `https://${SHOP}/admin/api/2024-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, variables })
    }
  );

  const data = await res.json();
  if (data.errors) {
    console.error("SHOPIFY: GraphQL errors:", JSON.stringify(data.errors));
    throw new Error(`Shopify GraphQL error: ${data.errors[0]?.message || "unknown"}`);
  }
  return data;
}

/**
 * Internal: shape a raw GraphQL product node into the same summary shape
 * getProductById returns, plus the first variant's id/sku/barcode.
 */
function _shapeProductNode(product) {
  if (!product) return null;

  const metafields = {};
  for (const edge of product.metafields?.edges || []) {
    const node = edge.node;
    metafields[`${node.namespace}.${node.key}`] = node.value;
  }

  const firstVariant = product.variants?.edges?.[0]?.node || null;

  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    descriptionHtml: product.descriptionHtml,
    vendor: product.vendor,
    productType: product.productType,
    tags: product.tags || [],
    imageUrl: product.featuredImage?.url,
    price: firstVariant?.price,
    variantId: firstVariant?.id || null,
    sku: firstVariant?.sku || null,
    barcode: firstVariant?.barcode || null,
    metafields
  };
}

// Fields fetched for every product we resolve in the update flow.
const _PRODUCT_FIELDS = `
  id
  title
  handle
  descriptionHtml
  vendor
  productType
  tags
  featuredImage { url }
  variants(first: 1) {
    edges {
      node {
        id
        price
        sku
        barcode
      }
    }
  }
  metafields(namespace: "custom", first: 50) {
    edges {
      node {
        namespace
        key
        value
      }
    }
  }
`;

/**
 * Resolve an existing product to update. Supports several reference types so the
 * caller can pick whatever is convenient. Matching is intentionally strict to
 * AVOID duplicates: we only return a single product when the match is unambiguous.
 *
 * @param {object} ref
 * @param {string} [ref.idOrGid]  numeric id or gid://shopify/Product/...
 * @param {string} [ref.handle]   product handle (exact)
 * @param {string} [ref.sku]      variant SKU (exact)
 * @param {string} [ref.barcode]  variant barcode / UPC (exact)
 * @param {string} [ref.title]    title search (may be fuzzy)
 * @returns {Promise<object|null|Array>}
 *   - object: single match (same shape as getProductById + variantId/sku/barcode)
 *   - null:   no match found
 *   - Array:  multiple matches (caller must disambiguate; never auto-pick)
 */
export async function findProduct({ idOrGid, handle, sku, barcode, title } = {}) {
  // 1) Direct id / gid lookup — most precise.
  if (idOrGid) {
    try {
      const gid = String(idOrGid).startsWith("gid://")
        ? idOrGid
        : `gid://shopify/Product/${idOrGid}`;
      const data = await _graphql(
        `query FindById($id: ID!) { product(id: $id) { ${_PRODUCT_FIELDS} } }`,
        { id: gid }
      );
      return _shapeProductNode(data.data?.product);
    } catch (err) {
      console.warn("SHOPIFY: findProduct by id failed:", err?.message || String(err));
      return null;
    }
  }

  // 2) Build a search query for the products(query:...) connection.
  //    Each branch targets exactly one field so matches stay unambiguous.
  let searchQuery = "";
  if (handle) {
    searchQuery = `handle:${JSON.stringify(String(handle).trim())}`;
  } else if (sku) {
    searchQuery = `sku:${JSON.stringify(String(sku).trim())}`;
  } else if (barcode) {
    searchQuery = `barcode:${JSON.stringify(String(barcode).trim())}`;
  } else if (title) {
    // Title search is fuzzy; we return all matches so the caller disambiguates.
    searchQuery = `title:${JSON.stringify(String(title).trim())}`;
  } else {
    return null;
  }

  const data = await _graphql(
    `query FindProducts($q: String!) {
      products(first: 10, query: $q) {
        edges { node { ${_PRODUCT_FIELDS} } }
      }
    }`,
    { q: searchQuery }
  );

  const edges = data.data?.products?.edges || [];
  const matched = edges.map(e => _shapeProductNode(e.node)).filter(Boolean);

  if (matched.length === 0) return null;
  if (matched.length === 1) return matched[0];
  return matched; // multiple — caller decides
}

/**
 * Update only the provided fields on an EXISTING product. Never creates a
 * product, never touches price/cost/inventory.
 *
 * @param {string} productId  numeric id or gid
 * @param {object} fields
 * @param {string} [fields.title]
 * @param {string} [fields.description]   maps to descriptionHtml / body_html
 * @param {string} [fields.vendor]
 * @param {string} [fields.product_type]
 * @param {string[]|string} [fields.tags]
 * @param {Array<{namespace,key,value,type}>} [fields.metafields]
 * @param {string} [fields.imageUrl]  attached as a NEW product image (data: URL supported)
 * @returns {Promise<object>} updated product summary
 */
export async function updateProductListing(productId, fields = {}) {
  console.log("SHOPIFY: Updating product listing:", productId);

  const gid = String(productId).startsWith("gid://")
    ? productId
    : `gid://shopify/Product/${productId}`;

  // ---- Core fields + metafields via productUpdate -------------------------
  const input = { id: gid };
  if (typeof fields.title === "string" && fields.title.trim()) input.title = fields.title;
  if (typeof fields.description === "string" && fields.description.trim()) input.descriptionHtml = fields.description;
  if (typeof fields.vendor === "string" && fields.vendor.trim()) input.vendor = fields.vendor;
  if (typeof fields.product_type === "string" && fields.product_type.trim()) input.productType = fields.product_type;
  if (fields.tags !== undefined && fields.tags !== null) {
    input.tags = Array.isArray(fields.tags)
      ? fields.tags
      : String(fields.tags).split(",").map(t => t.trim()).filter(Boolean);
  }

  const metafields = Array.isArray(fields.metafields) ? fields.metafields : [];
  if (metafields.length > 0) {
    input.metafields = metafields.map(mf => ({
      namespace: mf.namespace || "custom",
      key: mf.key,
      value: mf.value,
      type: mf.type
    }));
  }

  const mutation = `
    mutation productUpdate($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          ${_PRODUCT_FIELDS}
        }
        userErrors { field message }
      }
    }
  `;

  // Core-only mutation used for retries (avoids re-sending metafields).
  const coreMutation = `
    mutation productUpdate($input: ProductInput!) {
      productUpdate(input: $input) {
        product { ${_PRODUCT_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  let updatedNode = null;
  try {
    const data = await _graphql(mutation, { input });
    const userErrors = data.data?.productUpdate?.userErrors || [];
    if (userErrors.length > 0) {
      console.error("SHOPIFY: productUpdate userErrors:", JSON.stringify(userErrors));
      // Mirror createDraftProduct's fallback: retry metafields individually.
      if (metafields.length > 0) {
        console.log("SHOPIFY: Retrying metafields individually after productUpdate error…");
        // Strip metafields and retry core fields alone so title/description still land.
        const coreInput = { ...input };
        delete coreInput.metafields;
        if (Object.keys(coreInput).length > 1) { // more than just id
          try {
            const retry = await _graphql(coreMutation, { input: coreInput });
            updatedNode = retry.data?.productUpdate?.product || null;
          } catch (e) {
            console.warn("SHOPIFY: core-only productUpdate retry failed:", e?.message || String(e));
          }
        }
        await _updateMetafieldsIndividually(gid, metafields);
      }
    } else {
      updatedNode = data.data?.productUpdate?.product || null;
    }
  } catch (err) {
    console.error("SHOPIFY: productUpdate failed:", err?.message || String(err));
    // Best-effort: still try metafields individually so partial progress is made.
    if (metafields.length > 0) {
      await _updateMetafieldsIndividually(gid, metafields);
    }
  }

  // ---- Optional NEW image via productCreateMedia --------------------------
  if (fields.imageUrl) {
    try {
      await _attachProductImage(gid, fields.imageUrl);
    } catch (err) {
      console.warn("SHOPIFY: attaching product image failed:", err?.message || String(err));
    }
  }

  // ---- Return a fresh summary --------------------------------------------
  if (updatedNode) {
    return _shapeProductNode(updatedNode);
  }
  // Fall back to a fresh fetch if the mutation didn't return the node.
  try {
    const data = await _graphql(
      `query Refetch($id: ID!) { product(id: $id) { ${_PRODUCT_FIELDS} } }`,
      { id: gid }
    );
    return _shapeProductNode(data.data?.product);
  } catch {
    return { id: gid };
  }
}

/**
 * Internal: update metafields one-by-one (mirrors updateMetafieldsIndividually
 * used by the create flow) so one bad metafield doesn't fail the whole batch.
 */
async function _updateMetafieldsIndividually(gid, metafields) {
  let successCount = 0;
  const mutation = `
    mutation productUpdate($input: ProductInput!) {
      productUpdate(input: $input) {
        product { id }
        userErrors { field message }
      }
    }
  `;
  for (const mf of metafields) {
    try {
      const data = await _graphql(mutation, {
        input: {
          id: gid,
          metafields: [{
            namespace: mf.namespace || "custom",
            key: mf.key,
            value: mf.value,
            type: mf.type
          }]
        }
      });
      const errs = data.data?.productUpdate?.userErrors || [];
      if (errs.length > 0) {
        console.error(`SHOPIFY: Failed to set ${mf.key}:`, errs[0].message);
      } else {
        successCount++;
      }
    } catch (err) {
      console.error(`SHOPIFY: Error setting ${mf.key}:`, err?.message || String(err));
    }
  }
  console.log(`SHOPIFY: Set ${successCount}/${metafields.length} metafields individually`);
}

/**
 * Internal: attach a NEW image to an existing product.
 * Mirrors createProduct's data-url handling: for data: URLs we upload the bytes
 * to Shopify Files first, then reference the resulting CDN URL; plain URLs are
 * passed straight to productCreateMedia.
 */
async function _attachProductImage(gid, imageUrl) {
  let originalSource = imageUrl;

  if (typeof imageUrl === "string" && imageUrl.startsWith("data:")) {
    const match = imageUrl.match(/^data:(.+?);base64,(.+)$/);
    const b64 = match?.[2];
    if (!b64) {
      console.warn("SHOPIFY: data URL had no base64 payload; skipping image");
      return;
    }
    const buffer = Buffer.from(b64, "base64");
    const uploaded = await uploadFileToShopify(buffer, "studio.png");
    originalSource = uploaded?.url;
    if (!originalSource) {
      console.warn("SHOPIFY: file upload returned no URL; skipping image");
      return;
    }
  }

  const mutation = `
    mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media {
          ... on MediaImage { id image { url } }
        }
        mediaUserErrors { field message }
      }
    }
  `;

  const data = await _graphql(mutation, {
    productId: gid,
    media: [{
      originalSource,
      mediaContentType: "IMAGE"
    }]
  });

  const errs = data.data?.productCreateMedia?.mediaUserErrors || [];
  if (errs.length > 0) {
    console.error("SHOPIFY: productCreateMedia errors:", JSON.stringify(errs));
  } else {
    console.log("SHOPIFY: Attached new product image");
  }
}
