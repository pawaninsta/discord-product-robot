#!/usr/bin/env node
/**
 * CLI harness for generateStudioImage().
 *
 *   node image-test.js <input-image-url-or-path> [productContext]
 *
 * Examples:
 *   node image-test.js ./samples/lagavulin.jpg "Lagavulin 16 Year"
 *   node image-test.js https://example.com/bottle.jpg
 *
 * Writes the output to ./out/studio-<timestamp>.png and prints status.
 * Requires GOOGLE_AI_API_KEY in the environment; fails gracefully if missing.
 *
 * Note: this imports image.js, which does NOT touch the network at import time.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { generateStudioImage } from "./image.js";

function fail(msg) {
  console.error(`\n[image-test] ERROR: ${msg}\n`);
  process.exit(1);
}

async function main() {
  const input = process.argv[2];
  const productContext = process.argv[3]; // optional

  if (!input) {
    fail(
      "Missing input.\n" +
        "Usage: node image-test.js <input-image-url-or-path> [productContext]"
    );
  }

  if (!process.env.GOOGLE_AI_API_KEY) {
    fail(
      "GOOGLE_AI_API_KEY is not set.\n" +
        "Set it before running, e.g.:\n" +
        "  GOOGLE_AI_API_KEY=your_key node image-test.js ./bottle.jpg \"Brand Name\"\n" +
        "Without a key, generateStudioImage() just returns the original image."
    );
  }

  // Accept either a URL or a local file path. Local paths -> file:// URL so the
  // node-fetch inside image.js can read them.
  let imageUrl = input;
  const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
  if (!isUrl) {
    const abs = path.resolve(process.cwd(), input);
    if (!existsSync(abs)) fail(`Local file not found: ${abs}`);
    imageUrl = pathToFileURL(abs).href;
  }

  console.log("[image-test] Input:", imageUrl);
  if (productContext) console.log("[image-test] productContext:", productContext);
  console.log("[image-test] Model:", process.env.GOOGLE_IMAGE_MODEL || "gemini-3-pro-image-preview");
  console.log("[image-test] Calling generateStudioImage()...\n");

  const result = await generateStudioImage(imageUrl, { productContext });

  if (!result || result === imageUrl) {
    fail(
      "generateStudioImage() returned the original image (generation failed or was skipped).\n" +
        "Check the IMAGE: log lines above for the reason."
    );
  }

  if (!result.startsWith("data:")) {
    // Shouldn't happen on success, but handle defensively.
    console.log("[image-test] Got a non-data URL result:", result);
    return;
  }

  const match = /^data:(.+?);base64,(.*)$/s.exec(result);
  if (!match) fail("Result was a data URL but could not be parsed.");
  const [, mime, b64] = match;
  const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";

  const outDir = path.resolve(process.cwd(), "out");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `studio-${Date.now()}.${ext}`);
  await writeFile(outPath, Buffer.from(b64, "base64"));

  console.log(`\n[image-test] SUCCESS`);
  console.log(`[image-test] mime: ${mime}`);
  console.log(`[image-test] wrote: ${outPath}`);
}

main().catch((err) => fail(err?.stack || err?.message || String(err)));
