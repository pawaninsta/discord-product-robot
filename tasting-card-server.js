import express from "express";
import { generateTastingCard, extractProductIdFromAdminUrl } from "./tasting-card.js";

const app = express();
app.use(express.json());

const PORT = process.env.TASTING_CARD_PORT || 3001;

/**
 * POST /tasting-card/generate
 * 
 * Body:
 *   { "product_id": "8234567890" }
 *   OR
 *   { "admin_url": "https://admin.shopify.com/store/whiskeylibrary/products/8234567890" }
 * 
 * Response:
 *   {
 *     "success": true,
 *     "product_id": "gid://shopify/Product/8234567890",
 *     "card_image_url": "https://cdn.shopify.com/...",
 *     "card_image_id": "gid://shopify/MediaImage/456"
 *   }
 */
app.post("/tasting-card/generate", async (req, res) => {
  console.log("TASTING CARD SERVER: Received request", req.body);

  try {
    const { product_id, admin_url } = req.body;

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

    console.log("TASTING CARD SERVER: Generating for product:", productId);

    const result = await generateTastingCard({ productId });

    if (result.success) {
      return res.status(200).json({
        success: true,
        product_id: result.productId,
        product_title: result.productTitle,
        product_handle: result.productHandle,
        card_image_url: result.cardImageUrl,
        card_image_id: result.cardImageId
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
