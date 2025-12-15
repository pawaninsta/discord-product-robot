import puppeteer from "puppeteer";
import QRCode from "qrcode";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getProductById, uploadFileToShopify, setProductMetafield } from "./shopify.js";
import { condenseTastingCardDescription } from "./ai.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load HTML template
const TEMPLATE_PATH = join(__dirname, "tasting-card-template.html");
const TEMPLATE_HTML = readFileSync(TEMPLATE_PATH, "utf-8");

// Card dimensions at 300 DPI
const CARD_WIDTH = 1275;  // 4.25" x 300
const CARD_HEIGHT = 1650; // 5.5" x 300

// Country to flag SVG URL mapping (using flagcdn.com for reliable rendering)
const COUNTRY_FLAG_URLS = {
  "USA": "https://flagcdn.com/w80/us.png",
  "Scotland": "https://flagcdn.com/w80/gb-sct.png",
  "Ireland": "https://flagcdn.com/w80/ie.png",
  "Japan": "https://flagcdn.com/w80/jp.png",
  "Canada": "https://flagcdn.com/w80/ca.png",
  "Taiwan": "https://flagcdn.com/w80/tw.png",
  "India": "https://flagcdn.com/w80/in.png",
  "England": "https://flagcdn.com/w80/gb-eng.png",
  "Wales": "https://flagcdn.com/w80/gb-wls.png",
  "France": "https://flagcdn.com/w80/fr.png",
  "Mexico": "https://flagcdn.com/w80/mx.png",
  "Australia": "https://flagcdn.com/w80/au.png",
  "Caribbean": "https://flagcdn.com/w80/jm.png",
  "Other": "https://flagcdn.com/w80/un.png"
};

/**
 * Extract product ID from Shopify admin URL
 * Supports formats:
 * - https://admin.shopify.com/store/{shop}/products/{id}
 * - https://{shop}.myshopify.com/admin/products/{id}
 */
export function extractProductIdFromAdminUrl(url) {
  // Match: /products/{numeric_id}
  const match = url.match(/\/products\/(\d+)/);
  if (!match) {
    throw new Error("Invalid Shopify admin product URL. Expected format: .../products/{id}");
  }
  return match[1];
}

/**
 * Strip HTML tags from a string
 */
function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Escape HTML entities for safe insertion into template
 */
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Get country flag image URL
 */
function getCountryFlagUrl(country) {
  return COUNTRY_FLAG_URLS[country] || COUNTRY_FLAG_URLS["Other"];
}

/**
 * Format price for display
 */
function formatPrice(price) {
  if (!price) return "—";
  const num = parseFloat(price);
  if (isNaN(num)) return "—";
  return `$${num.toFixed(2)}`;
}

/**
 * Parse ABV and calculate proof
 */
function parseAbvProof(abvStr) {
  if (!abvStr) return { abv: "—", proof: "—", display: "—" };
  
  // Extract numeric value
  const match = String(abvStr).match(/[\d.]+/);
  if (!match) return { abv: abvStr, proof: "—", display: abvStr };
  
  const abvNum = parseFloat(match[0]);
  if (isNaN(abvNum)) return { abv: abvStr, proof: "—", display: abvStr };
  
  const proofNum = Math.round(abvNum * 2);
  return {
    abv: `${abvNum}%`,
    proof: String(proofNum),
    display: `${abvNum}% (≈${proofNum} proof)`
  };
}

/**
 * Build location string from country and state
 */
function buildLocation(country, state) {
  if (state && country) {
    return `${state}, ${country}`;
  }
  return country || state || "—";
}

/**
 * Parse metafield value (handles JSON arrays from list.single_line_text_field)
 */
function parseMetafieldValue(value) {
  if (!value) return "";
  // Try to parse as JSON array
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.join(", ");
    }
    return String(parsed);
  } catch {
    return String(value);
  }
}

/**
 * Transform Shopify product data into template-ready format
 */
async function prepareProductData(product) {
  const mf = product.metafields || {};
  
  // Extract metafield values
  const country = parseMetafieldValue(mf["custom.location_"]) || "USA";
  const state = mf["custom.state"] || "";
  const ageStatement = mf["custom.age_statement"] || "NAS";
  const abv = mf["custom.alcohol_by_volume"] || "";
  const subType = mf["custom.sub_type"] || "";
  const nose = mf["custom.nose"] || "";
  const palate = mf["custom.palate"] || "";
  const finish = mf["custom.finish"] || "";
  
  // Strip HTML from description and optionally condense
  let description = stripHtml(product.descriptionHtml);
  description = await condenseTastingCardDescription({
    title: product.title,
    description
  });
  
  const abvParsed = parseAbvProof(abv);
  
  return {
    title: product.title,
    imageUrl: product.imageUrl,
    country,
    state,
    location: buildLocation(country, state),
    countryFlagUrl: getCountryFlagUrl(country),
    subType: subType || "—",
    ageStatement: ageStatement || "NAS",
    abv: abvParsed.abv,
    proof: abvParsed.proof,
    abvDisplay: abvParsed.display,
    price: formatPrice(product.price),
    description,
    nose: nose || "—",
    palate: palate || "—",
    finish: finish || "—",
    handle: product.handle
  };
}

/**
 * Generate QR code data URL for product page
 */
async function generateQRCode(handle) {
  const productUrl = `https://whiskeylibrary.com/products/${handle}`;
  return await QRCode.toDataURL(productUrl, {
    width: 180,
    margin: 1,
    color: {
      dark: "#1a1a1a",
      light: "#fefefe"
    }
  });
}

/**
 * Build HTML from template with token replacements
 */
function buildCardHtml(productData, qrDataUrl) {
  let html = TEMPLATE_HTML;
  
  const replacements = {
    "{{TITLE}}": escapeHtml(productData.title),
    "{{IMAGE_URL}}": productData.imageUrl || "",
    "{{COUNTRY_FLAG_URL}}": productData.countryFlagUrl,
    "{{COUNTRY}}": escapeHtml(productData.country),
    "{{LOCATION}}": escapeHtml(productData.location),
    "{{SUB_TYPE}}": escapeHtml(productData.subType),
    "{{AGE_STATEMENT}}": escapeHtml(productData.ageStatement),
    "{{ABV_DISPLAY}}": escapeHtml(productData.abvDisplay),
    "{{PRICE}}": productData.price,
    "{{DESCRIPTION}}": escapeHtml(productData.description),
    "{{NOSE}}": escapeHtml(productData.nose),
    "{{PALATE}}": escapeHtml(productData.palate),
    "{{FINISH}}": escapeHtml(productData.finish),
    "{{QR_CODE_DATA_URL}}": qrDataUrl
  };
  
  for (const [token, value] of Object.entries(replacements)) {
    html = html.replace(new RegExp(token.replace(/[{}]/g, "\\$&"), "g"), value);
  }
  
  return html;
}

/**
 * Validate that all placeholders have been replaced
 */
function validateNoUnreplacedTokens(html) {
  const unreplaced = html.match(/\{\{[A-Z_]+\}\}/g);
  if (unreplaced && unreplaced.length > 0) {
    console.warn("TASTING CARD: Unreplaced tokens found:", unreplaced);
  }
}

/**
 * Validate required product data
 */
function validateProductData(data) {
  const required = ["title", "imageUrl"];
  const missing = required.filter(field => !data[field]);
  if (missing.length > 0) {
    throw new Error(`Missing required fields for tasting card: ${missing.join(", ")}`);
  }
}

/**
 * Render HTML to PNG using Puppeteer
 */
async function renderToPng(html) {
  console.log("TASTING CARD: Launching Puppeteer");
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  
  try {
    const page = await browser.newPage();
    
    // Set viewport to exact card dimensions
    await page.setViewport({
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      deviceScaleFactor: 1
    });
    
    // Load the HTML content
    await page.setContent(html, {
      waitUntil: "networkidle0"
    });
    
    // Wait for fonts to load
    await page.evaluateHandle("document.fonts.ready");
    
    // Capture screenshot as PNG
    const pngBuffer = await page.screenshot({
      type: "png",
      fullPage: false,
      clip: {
        x: 0,
        y: 0,
        width: CARD_WIDTH,
        height: CARD_HEIGHT
      }
    });
    
    console.log("TASTING CARD: Screenshot captured, size:", pngBuffer.length);
    
    return pngBuffer;
  } finally {
    await browser.close();
  }
}

/**
 * Main function: Generate a tasting card for a product
 * 
 * @param {Object} options
 * @param {string} options.productId - Shopify product ID (numeric or GID)
 * @param {string} options.adminUrl - Shopify admin URL (alternative to productId)
 * @param {boolean} options.uploadToShopify - Whether to upload and attach to product (default: true)
 * @returns {Object} { success, pngBuffer, cardImageUrl, cardImageId, productId, error }
 */
export async function generateTastingCard({ productId, adminUrl, uploadToShopify = true } = {}) {
  console.log("TASTING CARD: Starting generation");
  
  try {
    // Resolve product ID from admin URL if needed
    if (!productId && adminUrl) {
      productId = extractProductIdFromAdminUrl(adminUrl);
    }
    
    if (!productId) {
      throw new Error("Product ID or admin URL is required");
    }
    
    console.log("TASTING CARD: Product ID:", productId);
    
    // Fetch product data from Shopify
    const product = await getProductById(productId);
    console.log("TASTING CARD: Fetched product:", product.title);
    
    // Prepare data for template
    const productData = await prepareProductData(product);
    validateProductData(productData);
    
    // Generate QR code
    const qrDataUrl = await generateQRCode(productData.handle);
    console.log("TASTING CARD: QR code generated");
    
    // Build HTML from template
    const html = buildCardHtml(productData, qrDataUrl);
    validateNoUnreplacedTokens(html);
    
    // Render to PNG
    const pngBuffer = await renderToPng(html);
    
    let cardImageUrl = null;
    let cardImageId = null;
    
    // Upload to Shopify and attach to product
    if (uploadToShopify) {
      const filename = `tasting-card-${productData.handle}.png`;
      const file = await uploadFileToShopify(pngBuffer, filename);
      cardImageUrl = file.url;
      cardImageId = file.id;
      
      // Set metafield on product
      await setProductMetafield(product.id, "custom", "tasting_card", file.id);
      
      console.log("TASTING CARD: Attached to product via metafield");
    }
    
    console.log("TASTING CARD: Generation complete");
    
    return {
      success: true,
      pngBuffer,
      cardImageUrl,
      cardImageId,
      productId: product.id,
      productTitle: product.title,
      productHandle: product.handle
    };
    
  } catch (err) {
    console.error("TASTING CARD ERROR:", err);
    return {
      success: false,
      error: err.message || String(err)
    };
  }
}

/**
 * Async wrapper for pipeline integration
 * Sends status updates via callback
 */
export async function generateTastingCardAsync(productId, sendSafe) {
  try {
    await sendSafe("🎴 Generating tasting card in background...");
    
    const result = await generateTastingCard({ productId });
    
    if (result.success) {
      await sendSafe(`🎴 Tasting card generated: ${result.cardImageUrl}`);
    } else {
      await sendSafe(`⚠️ Tasting card generation failed: ${result.error}`);
    }
    
    return result;
  } catch (err) {
    await sendSafe(`⚠️ Tasting card error: ${err.message}`);
    return { success: false, error: err.message };
  }
}
