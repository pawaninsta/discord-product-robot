import express from "express";
import crypto from "crypto";
import { generateTastingCard, extractProductIdFromAdminUrl } from "./tasting-card.js";
import { getProductById, setProductMetafield } from "./shopify.js";

const app = express();
app.use(express.json());

const PORT = process.env.TASTING_CARD_PORT || 3001;

/**
 * Create a hash of all tasting card-relevant fields.
 * If any of these change, the tasting card needs regeneration.
 * 
 * @param {Object} product - Product data from getProductById
 * @returns {string} MD5 hash of relevant content
 */
function createTastingCardHash(product) {
  const mf = product.metafields || {};
  
  const relevantData = {
    title: product.title || "",
    price: product.price || "",
    description: product.descriptionHtml || "",
    // Metafields that appear on the tasting card
    location: mf["custom.location_"] || "",
    state: mf["custom.state"] || "",
    age_statement: mf["custom.age_statement"] || "",
    abv: mf["custom.alcohol_by_volume"] || "",
    sub_type: mf["custom.sub_type"] || "",
    nose: mf["custom.nose"] || "",
    palate: mf["custom.palate"] || "",
    finish: mf["custom.finish"] || ""
  };

  const dataString = JSON.stringify(relevantData);
  return crypto.createHash("md5").update(dataString).digest("hex");
}

/**
 * POST /tasting-card/generate
 * 
 * Body:
 *   { "product_id": "8234567890" }
 *   OR
 *   { "admin_url": "https://admin.shopify.com/store/whiskeylibrary/products/8234567890" }
 *   Optional:
 *   { "force": true }  - Skip cache check and regenerate anyway
 * 
 * Response:
 *   {
 *     "success": true,
 *     "product_id": "gid://shopify/Product/8234567890",
 *     "card_image_url": "https://cdn.shopify.com/...",
 *     "card_image_id": "gid://shopify/MediaImage/456"
 *   }
 *   OR (when skipped):
 *   {
 *     "success": true,
 *     "skipped": true,
 *     "reason": "Content unchanged"
 *   }
 */
app.post("/tasting-card/generate", async (req, res) => {
  console.log("TASTING CARD SERVER: Received request", req.body);

  try {
    const { product_id, admin_url, force } = req.body;
    const forceRegenerate = force === true;

    let productId = product_id;

    // Extract product ID from admin URL if provided
    if (!productId && admin_url) {
      try {
        productId = extractProductIdFromAdminUrl(admin_url);
      } catch (err) {
        return res.status(400).json({
          success: false,
          error: err.message
        });
      }
    }

    if (!productId) {
      return res.status(400).json({
        success: false,
        error: "Either product_id or admin_url is required"
      });
    }

    productId = String(productId);
    console.log("TASTING CARD SERVER: Checking product:", productId);

    // Fetch current product data to calculate hash
    const product = await getProductById(productId);
    
    // Calculate hash of current tasting-card-relevant content
    const currentHash = createTastingCardHash(product);
    
    // Get stored hash from metafield (if it exists)
    const storedHash = product.metafields?.["custom.tasting_card_hash"] || null;

    console.log("TASTING CARD SERVER: Hash check", {
      productId,
      productTitle: product.title,
      currentHash: currentHash.slice(0, 8) + "...",
      storedHash: storedHash ? storedHash.slice(0, 8) + "..." : null,
      hashMatch: currentHash === storedHash,
      forceRegenerate
    });

    // Skip if content hasn't changed (unless force flag is set)
    if (!forceRegenerate && storedHash && storedHash === currentHash) {
      console.log("TASTING CARD SERVER: Skipping - content unchanged");
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: "Content unchanged (title, price, metafields same)",
        product_id: product.id,
        product_title: product.title,
        content_hash: currentHash
      });
    }

    // Content changed or first time - regenerate the tasting card
    const changeReason = !storedHash ? "First generation" : "Content changed";
    console.log(`TASTING CARD SERVER: Regenerating (${changeReason})`);

    const result = await generateTastingCard({ productId });

    if (result.success) {
      // Store the new hash in Shopify metafield for future comparisons
      try {
        await setProductMetafield(
          productId,
          "custom",
          "tasting_card_hash",
          currentHash
        );
        console.log("TASTING CARD SERVER: Saved new hash to metafield");
      } catch (hashErr) {
        console.error("TASTING CARD SERVER: Failed to save hash:", hashErr.message);
        // Don't fail the request - card was still generated
      }

      return res.status(200).json({
        success: true,
        product_id: result.productId,
        product_title: result.productTitle,
        product_handle: result.productHandle,
        card_image_url: result.cardImageUrl,
        card_image_id: result.cardImageId,
        regeneration_reason: changeReason,
        content_hash: currentHash
      });
    } else {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (err) {
    console.error("TASTING CARD SERVER ERROR:", err);
    return res.status(500).json({
      success: false,
      error: err.message || String(err)
    });
  }
});

/**
 * GET /health
 * Simple health check endpoint
 */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", service: "tasting-card-server" });
});

/**
 * Start server if run directly
 */
if (process.argv[1].endsWith("tasting-card-server.js")) {
  app.listen(PORT, () => {
    console.log(`🎴 Tasting Card Server running on port ${PORT}`);
  });
}

export { app };
