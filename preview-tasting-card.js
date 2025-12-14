#!/usr/bin/env node
/**
 * Preview Tasting Card
 * 
 * Generates a preview of the tasting card with sample data and opens it in the browser.
 * 
 * Usage:
 *   node preview-tasting-card.js           # Preview with mock data
 *   node preview-tasting-card.js --png     # Also generate PNG file
 */

import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { exec } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load HTML template
const TEMPLATE_PATH = join(__dirname, "tasting-card-template.html");
const TEMPLATE_HTML = readFileSync(TEMPLATE_PATH, "utf-8");

// Sample product data (Smoke Wagon as example)
const SAMPLE_DATA = {
  title: "Smoke Wagon Straight Bourbon Whiskey 750ml",
  imageUrl: "https://cdn.shopify.com/s/files/1/0740/7261/6785/files/smoke-wagon-straight-bourbon.png?v=1699574400",
  countryFlag: "🇺🇸",
  location: "Nevada, USA",
  ageStatement: "NAS",
  abvDisplay: "46.25% (≈93 proof)",
  price: "$34.99",
  description: "Smoke Wagon Straight Bourbon is crafted by Aaron Chepenik at the Nevada H&C Distilling Co. in Las Vegas. This small-batch bourbon uses a high-rye mashbill sourced from MGP in Indiana, aged in new charred American oak barrels. The result is a bold, spicy bourbon with exceptional depth that punches well above its price point.",
  nose: "Honey, vanilla custard, toasted oak, caramel corn, light baking spice",
  palate: "Creamy caramel, toffee, gentle rye spice, dark fruit, cinnamon",
  finish: "Medium-long with caramel sweetness, oak tannins, and a peppery fade",
  qrCodeDataUrl: generatePlaceholderQR()
};

/**
 * Generate a simple placeholder QR code (gray square with text)
 */
function generatePlaceholderQR() {
  // Create a simple SVG placeholder for the QR code
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
      <rect width="180" height="180" fill="#f0f0f0" rx="8"/>
      <rect x="20" y="20" width="140" height="140" fill="#1a1a1a" rx="4"/>
      <rect x="30" y="30" width="40" height="40" fill="#ffffff"/>
      <rect x="110" y="30" width="40" height="40" fill="#ffffff"/>
      <rect x="30" y="110" width="40" height="40" fill="#ffffff"/>
      <rect x="80" y="80" width="20" height="20" fill="#ffffff"/>
      <text x="90" y="175" text-anchor="middle" font-family="Inter, sans-serif" font-size="10" fill="#666">whiskeylibrary.com</text>
    </svg>
  `;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/**
 * Escape HTML entities
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
 * Build HTML from template with sample data
 */
function buildPreviewHtml(data) {
  let html = TEMPLATE_HTML;
  
  const replacements = {
    "{{TITLE}}": escapeHtml(data.title),
    "{{IMAGE_URL}}": data.imageUrl || "https://via.placeholder.com/380x450/f8f8f8/999999?text=Bottle+Image",
    "{{COUNTRY_FLAG}}": data.countryFlag,
    "{{LOCATION}}": escapeHtml(data.location),
    "{{AGE_STATEMENT}}": escapeHtml(data.ageStatement),
    "{{ABV_DISPLAY}}": escapeHtml(data.abvDisplay),
    "{{PRICE}}": data.price,
    "{{DESCRIPTION}}": escapeHtml(data.description),
    "{{NOSE}}": escapeHtml(data.nose),
    "{{PALATE}}": escapeHtml(data.palate),
    "{{FINISH}}": escapeHtml(data.finish),
    "{{QR_CODE_DATA_URL}}": data.qrCodeDataUrl
  };
  
  for (const [token, value] of Object.entries(replacements)) {
    html = html.replace(new RegExp(token.replace(/[{}]/g, "\\$&"), "g"), value);
  }
  
  return html;
}

/**
 * Open a file in the default browser
 */
function openInBrowser(filePath) {
  const platform = process.platform;
  let command;
  
  if (platform === "darwin") {
    command = `open "${filePath}"`;
  } else if (platform === "win32") {
    command = `start "" "${filePath}"`;
  } else {
    command = `xdg-open "${filePath}"`;
  }
  
  exec(command, (err) => {
    if (err) {
      console.error("Failed to open browser:", err.message);
      console.log("\nManually open this file in your browser:");
      console.log(filePath);
    }
  });
}

/**
 * Main
 */
async function main() {
  console.log("🎴 Generating tasting card preview...\n");
  
  // Build HTML with sample data
  const html = buildPreviewHtml(SAMPLE_DATA);
  
  // Write to temp file
  const tempDir = mkdtempSync(join(tmpdir(), "tasting-card-"));
  const previewPath = join(tempDir, "tasting-card-preview.html");
  writeFileSync(previewPath, html);
  
  console.log("📄 Preview HTML saved to:");
  console.log(`   ${previewPath}\n`);
  
  // Also save to project directory for easy access
  const localPreviewPath = join(__dirname, "tasting-card-preview.html");
  writeFileSync(localPreviewPath, html);
  console.log("📄 Also saved locally to:");
  console.log(`   ${localPreviewPath}\n`);
  
  // Check if --png flag is provided
  if (process.argv.includes("--png")) {
    console.log("📸 Generating PNG preview...");
    try {
      const puppeteer = await import("puppeteer");
      const browser = await puppeteer.default.launch({ headless: true });
      const page = await browser.newPage();
      
      await page.setViewport({ width: 1275, height: 1650, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: "networkidle0" });
      await page.evaluateHandle("document.fonts.ready");
      
      const pngPath = join(__dirname, "tasting-card-preview.png");
      await page.screenshot({
        path: pngPath,
        type: "png",
        clip: { x: 0, y: 0, width: 1275, height: 1650 }
      });
      
      await browser.close();
      console.log(`   Saved to: ${pngPath}\n`);
    } catch (err) {
      console.error("   PNG generation failed:", err.message);
      console.log("   (Run 'npm install' first if puppeteer is not installed)\n");
    }
  }
  
  // Open in browser
  console.log("🌐 Opening in browser...\n");
  openInBrowser(localPreviewPath);
  
  console.log("Sample data used:");
  console.log("─".repeat(50));
  console.log(`  Title:    ${SAMPLE_DATA.title}`);
  console.log(`  Location: ${SAMPLE_DATA.countryFlag} ${SAMPLE_DATA.location}`);
  console.log(`  Age:      ${SAMPLE_DATA.ageStatement}`);
  console.log(`  ABV:      ${SAMPLE_DATA.abvDisplay}`);
  console.log(`  Price:    ${SAMPLE_DATA.price}`);
  console.log(`  Nose:     ${SAMPLE_DATA.nose.slice(0, 40)}...`);
  console.log(`  Palate:   ${SAMPLE_DATA.palate.slice(0, 40)}...`);
  console.log(`  Finish:   ${SAMPLE_DATA.finish.slice(0, 40)}...`);
  console.log("─".repeat(50));
  console.log("\n✨ Done! Check your browser.");
}

main().catch(console.error);
