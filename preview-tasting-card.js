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
  imageUrl: generatePlaceholderBottle(),
  countryFlagUrl: "https://flagcdn.com/w80/us.png",
  location: "Nevada, United States",
  subType: null,  // Not shown in reference image
  ageStatement: "NAS",
  abvDisplay: "46.25% (≈92.5 proof)",
  price: "$29.99",
  description: "Smoke Wagon Straight Bourbon is the brand's approachable entry-level bourbon designed as an everyday sipper with a distinctive profile from its high-rye mash bill and warehouse aging in the heat of Nevada. The bourbon is blended from multiple sourced barrels and aged on top floors for extra wood influence, then bottled non-chill-filtered to retain character and mouthfeel. Its combination of sweet and spicy elements reflects Smoke Wagon's signature style — offering a flavorful yet gentle introduction to its broader lineup.",
  nose: "Honey, vanilla custard, toasted nuts and light oak",
  palate: "Creamy caramel and toffee, gentle rye spice, apple and pepper",
  finish: "Medium with caramel sweetness, light tobacco, lingering rye warmth",
  qrCodeDataUrl: generatePlaceholderQR()
};

/**
 * Generate a placeholder bottle image
 */
function generatePlaceholderBottle() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
      <defs>
        <linearGradient id="bottleGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#2a1810"/>
          <stop offset="30%" style="stop-color:#4a2820"/>
          <stop offset="70%" style="stop-color:#3a1815"/>
          <stop offset="100%" style="stop-color:#1a0808"/>
        </linearGradient>
        <linearGradient id="labelGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#f5e6d3"/>
          <stop offset="100%" style="stop-color:#d4c4a8"/>
        </linearGradient>
      </defs>
      <!-- Bottle neck -->
      <rect x="125" y="20" width="50" height="60" fill="url(#bottleGrad)" rx="3"/>
      <!-- Bottle cap -->
      <rect x="120" y="5" width="60" height="20" fill="#1a0808" rx="3"/>
      <!-- Bottle body -->
      <path d="M90 80 L90 420 Q90 440 110 440 L190 440 Q210 440 210 420 L210 80 Q210 70 175 70 L125 70 Q90 70 90 80" fill="url(#bottleGrad)"/>
      <!-- Label background -->
      <rect x="100" y="150" width="100" height="180" fill="url(#labelGrad)" rx="4"/>
      <!-- Label text lines -->
      <text x="150" y="190" text-anchor="middle" font-family="Georgia, serif" font-size="12" font-weight="bold" fill="#2a1810">SMOKE</text>
      <text x="150" y="210" text-anchor="middle" font-family="Georgia, serif" font-size="12" font-weight="bold" fill="#2a1810">WAGON</text>
      <line x1="115" y1="225" x2="185" y2="225" stroke="#b27821" stroke-width="1"/>
      <text x="150" y="250" text-anchor="middle" font-family="Georgia, serif" font-size="9" fill="#4a4a4a">STRAIGHT</text>
      <text x="150" y="265" text-anchor="middle" font-family="Georgia, serif" font-size="9" fill="#4a4a4a">BOURBON</text>
      <text x="150" y="280" text-anchor="middle" font-family="Georgia, serif" font-size="9" fill="#4a4a4a">WHISKEY</text>
      <text x="150" y="310" text-anchor="middle" font-family="Georgia, serif" font-size="8" fill="#666">750ml</text>
    </svg>
  `;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/**
 * Generate a simple placeholder QR code (gray square with text)
 */
function generatePlaceholderQR() {
  // Create a simple SVG placeholder for the QR code (320x320 for better scannability)
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
      <rect width="320" height="320" fill="#f0f0f0" rx="8"/>
      <rect x="35" y="35" width="250" height="250" fill="#1a1a1a" rx="4"/>
      <rect x="60" y="60" width="75" height="75" fill="#ffffff"/>
      <rect x="185" y="60" width="75" height="75" fill="#ffffff"/>
      <rect x="60" y="185" width="75" height="75" fill="#ffffff"/>
      <rect x="140" y="140" width="40" height="40" fill="#ffffff"/>
      <text x="160" y="308" text-anchor="middle" font-family="Inter, sans-serif" font-size="14" fill="#666">whiskeylibrary.com</text>
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
 * Check if a value should be hidden (empty or dash only)
 */
function shouldHideValue(value, fieldName) {
  if (!value || value === "—" || value === "-") return true;
  return false;
}

/**
 * Build dynamic spec rows, hiding empty fields
 */
function buildSpecsRows(data) {
  const rows = [];
  
  // Location row
  if (!shouldHideValue(data.location, "location")) {
    rows.push(`
        <div class="spec-row">
          <img class="flag-img" src="${data.countryFlagUrl}" alt="Flag" />
          <span class="value">${escapeHtml(data.location)}</span>
        </div>`);
  }
  
  // Type row
  if (!shouldHideValue(data.subType, "type")) {
    rows.push(`
        <div class="spec-row">
          <span class="label">TYPE</span>
          <span class="value">${escapeHtml(data.subType)}</span>
        </div>`);
  }
  
  // Age row (hide if NAS or empty)
  if (!shouldHideValue(data.ageStatement, "age")) {
    rows.push(`
        <div class="spec-row">
          <span class="label">AGE</span>
          <span class="value">${escapeHtml(data.ageStatement)}</span>
        </div>`);
  }
  
  // ABV row
  if (!shouldHideValue(data.abvDisplay, "abv")) {
    rows.push(`
        <div class="spec-row">
          <span class="label">ABV</span>
          <span class="value">${escapeHtml(data.abvDisplay)}</span>
        </div>`);
  }
  
  // Price row
  if (!shouldHideValue(data.price, "price")) {
    rows.push(`
        <div class="spec-row">
          <span class="label">$$$$</span>
          <span class="value">${data.price}</span>
        </div>`);
  }
  
  return rows.join("");
}

/**
 * Build HTML from template with sample data
 */
function buildPreviewHtml(data) {
  let html = TEMPLATE_HTML;
  
  // Build dynamic specs rows (hiding empty fields)
  const specsRows = buildSpecsRows(data);
  
  const replacements = {
    "{{TITLE}}": escapeHtml(data.title),
    "{{IMAGE_URL}}": data.imageUrl || "https://via.placeholder.com/380x450/f8f8f8/999999?text=Bottle+Image",
    "{{SPECS_ROWS}}": specsRows,
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
  console.log(`  Location: ${SAMPLE_DATA.location}`);
  console.log(`  Type:     ${SAMPLE_DATA.subType}`);
  console.log(`  Age:      ${SAMPLE_DATA.ageStatement} (hidden if NAS)`);
  console.log(`  ABV:      ${SAMPLE_DATA.abvDisplay}`);
  console.log(`  Price:    ${SAMPLE_DATA.price}`);
  console.log(`  Nose:     ${SAMPLE_DATA.nose.slice(0, 40)}...`);
  console.log(`  Palate:   ${SAMPLE_DATA.palate.slice(0, 40)}...`);
  console.log(`  Finish:   ${SAMPLE_DATA.finish.slice(0, 40)}...`);
  console.log("─".repeat(50));
  console.log("\n✨ Done! Check your browser.");
}

main().catch(console.error);
