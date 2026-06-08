#!/usr/bin/env node
/**
 * CLI harness for the UPDATE pipeline.
 *
 * Usage:
 *   node update-test.js --image <url> --handle <handle>
 *   node update-test.js --image <url> --id <numericOrGid>
 *   node update-test.js --image <url> --sku <sku>
 *   node update-test.js --image <url> --barcode <upc>
 *   node update-test.js --image <url> --title "<title search>"
 *
 * Optional flags:
 *   --notes "<text>"        extra notes passed to the AI
 *   --abv <number>          known ABV (preferred over guessing)
 *   --proof <number>        known proof (converted to ABV)
 *   --reference <url>       reference link (research hint)
 *   --regenerate-image      generate a studio image and attach it
 *
 * Requires env: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN, OPENAI_API_KEY
 * (GOOGLE_API_KEY/GOOGLE_CX optional for web research,
 *  GOOGLE_AI_API_KEY optional for studio image generation).
 */

import { runUpdatePipeline } from "./update-pipeline.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    // Boolean flags
    if (key === "regenerate-image") {
      args.regenerateImage = true;
      continue;
    }
    const val = argv[i + 1];
    if (val === undefined || val.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = val;
      i++;
    }
  }
  return args;
}

function checkEnv() {
  const missing = [];
  if (!process.env.SHOPIFY_STORE_DOMAIN) missing.push("SHOPIFY_STORE_DOMAIN");
  if (!process.env.SHOPIFY_ADMIN_TOKEN) missing.push("SHOPIFY_ADMIN_TOKEN");
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  return missing;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log("See header of update-test.js for usage.");
    process.exit(0);
  }

  const image = args.image ? { url: String(args.image) } : null;
  if (!image) {
    console.error("ERROR: --image <url> is required.");
    process.exit(1);
  }

  const productRef = {
    idOrGid: args.id || args.idOrGid,
    handle: args.handle,
    sku: args.sku,
    barcode: args.barcode,
    title: args.title
  };

  const refKeys = Object.entries(productRef).filter(([, v]) => v);
  if (refKeys.length === 0) {
    console.error("ERROR: one of --id / --handle / --sku / --barcode / --title is required.");
    process.exit(1);
  }

  const missingEnv = checkEnv();
  if (missingEnv.length > 0) {
    console.error("ERROR: missing required environment variables:", missingEnv.join(", "));
    console.error("This harness needs live Shopify + OpenAI credentials to run end-to-end.");
    process.exit(1);
  }

  const abv = args.abv !== undefined ? Number(args.abv) : undefined;
  const proof = args.proof !== undefined ? Number(args.proof) : undefined;

  console.log("Running update pipeline with:");
  console.log("  productRef:", JSON.stringify(productRef));
  console.log("  image:", image.url);
  if (abv !== undefined) console.log("  abv:", abv);
  if (proof !== undefined) console.log("  proof:", proof);
  if (args.regenerateImage) console.log("  regenerateImage: true");
  console.log("");

  const result = await runUpdatePipeline({
    productRef,
    image,
    notes: args.notes ? String(args.notes) : undefined,
    abv: Number.isFinite(abv) ? abv : undefined,
    proof: Number.isFinite(proof) ? proof : undefined,
    barcode: args.barcode ? String(args.barcode) : undefined,
    referenceLink: args.reference || args.referenceLink,
    regenerateImage: Boolean(args.regenerateImage),
    send: async (msg) => console.log("[status]", msg)
  });

  console.log("\n=== RESULT ===");
  console.log(JSON.stringify(result, null, 2));
  process.exit(result?.ok ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err?.message || String(err));
  process.exit(1);
});
