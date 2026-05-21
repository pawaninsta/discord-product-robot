import fetch from "node-fetch";
import sharp from "sharp";

/**
 * Generate a studio product shot with white background
 * Uses Google's Gemini image model (Nano Banana / Gemini 3 Pro Image) for image generation/editing.
 *
 * Pipeline:
 *   1. Attempt 1: Gemini with the canonical JSON edit spec.
 *   2. Attempt 2: Gemini with a stricter sealed-bottle prompt (only if attempt 1 looks unchanged
 *      or capsule appears missing after post-processing).
 *   3. Attempt 3: Gemini with a "background only — do not modify bottle" prompt.
 *   After every successful attempt we run a sharp post-process that flattens any near-white
 *   pixels to pure #FFFFFF and detects whether the bottle's neck/capsule looks intact.
 */
export async function generateStudioImage(imageUrl) {
  console.log("IMAGE: Generating studio product shot");
  console.log("IMAGE: Input URL:", imageUrl);

  if (!process.env.GOOGLE_AI_API_KEY) {
    console.warn("IMAGE: GOOGLE_AI_API_KEY not configured, using original image");
    return imageUrl;
  }

  try {
    const result = await generateWithGeminiImage(imageUrl);
    if (result) {
      console.log("IMAGE: Gemini image success");
      return result;
    }
  } catch (err) {
    console.error("IMAGE: Gemini image failed:", err.message);
  }

  console.log("IMAGE: Generation failed, using original image");
  return imageUrl;
}

async function generateWithGeminiImage(imageUrl) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  const modelNameRaw = process.env.GOOGLE_IMAGE_MODEL || "gemini-3-pro-image-preview";
  const modelName = modelNameRaw.startsWith("models/") ? modelNameRaw.slice("models/".length) : modelNameRaw;
  const apiVersion = process.env.GOOGLE_IMAGE_API_VERSION || process.env.GOOGLE_API_VERSION || "v1beta";

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch input image (${imageResponse.status})`);
  }
  const imageBuffer = await imageResponse.arrayBuffer();
  const base64Image = Buffer.from(imageBuffer).toString("base64");
  const mimeType = imageResponse.headers.get("content-type") || "image/png";

  function buildEditPrompt({ mode = "normal" } = {}) {
    const spec = {
      goal: "studio_packshot",
      background: {
        type: "solid",
        color: "#FFFFFF",
        seamless: true,
        uniform_pixels: true
      },
      subject: {
        type: "single_bottle",
        preserve_identity: true,
        preserve_label_text: true,
        preserve_colors: true,
        preserve_geometry: true
      },
      bottle: {
        sealed: true,
        capsule_intact: true,
        cork_or_cap_fully_seated: true,
        full_neck_visible: true,
        preserve_capsule_color_and_text: true,
        do_not_remove_foil_or_wax: true
      },
      remove: [
        "hands",
        "fingers",
        "wrists",
        "arms",
        "people",
        "props",
        "supports",
        "stands",
        "shelves",
        "price_tags",
        "background_objects"
      ],
      inpaint: {
        reconstruct_occluded_bottle_areas: true,
        match_glass_reflections: true,
        keep_artifacts_minimal: true
      },
      lighting: {
        style: "soft_even_studio",
        shadows: "none",
        avoid_harsh_cast_shadows: true
      },
      composition: {
        aspect_ratio: "1:1",
        center_horizontally: true,
        full_bottle_visible: true,
        bottle_height_percent: "92-96",
        margin: "minimal_even_top_bottom",
        no_cropping_of_bottle: true
      },
      prohibit: [
        "extra_objects",
        "added_text",
        "added_logos",
        "watermarks",
        "label_changes",
        "color_shifts",
        "distortion",
        "stylization",
        "background_gradient",
        "background_vignette",
        "off_white_background",
        "open_bottle",
        "removed_capsule",
        "partial_cork",
        "missing_foil",
        "exposed_cork_top",
        "uncapped_bottle"
      ],
      output: { single_image: true }
    };

    const baseLines = [
      "You are a professional product-photo retoucher for e-commerce packshots.",
      "Edit the provided image to match the JSON edit spec exactly.",
      "Return only the edited image. Do not add any text overlays or borders.",
      "",
      "JSON_EDIT_SPEC:",
      JSON.stringify(spec, null, 2),
      ""
    ];

    if (mode === "background_only") {
      baseLines.push(
        "CRITICAL: Replace only the background with pure #FFFFFF (RGB 255,255,255).",
        "DO NOT modify the bottle in any way — keep label, capsule/foil, cork, glass, liquid, and geometry pixel-identical to the input.",
        "DO NOT remove or redraw any part of the bottle's neck wrapping, capsule, or cork."
      );
    } else if (mode === "sealed_strict") {
      baseLines.push(
        "CRITICAL SEALED-BOTTLE RULE: The output bottle MUST appear fully sealed — capsule, foil, or wax intact over the cork; the cork or screw cap fully seated; the full neck visible.",
        "If the input bottle appears sealed, KEEP IT THAT WAY. Do not crop the top, do not remove the capsule, do not expose the cork.",
        "If a hand or prop covers the neck, reconstruct the original sealed neck wrapping realistically — DO NOT draw an open bottle.",
        "CRITICAL BACKGROUND: The background must be a uniform, pixel-pure #FFFFFF (RGB 255,255,255). No gradients, no vignette, no off-white.",
        "CRITICAL COMPOSITION: Center the bottle, keep the full bottle visible, and frame so the bottle is ~92–96% of the image height."
      );
    } else {
      baseLines.push(
        "If hands/props are present, remove them cleanly and reconstruct any hidden bottle areas — including a sealed capsule/foil on the neck.",
        "CRITICAL BACKGROUND: The background must be a uniform, pixel-pure #FFFFFF (RGB 255,255,255). No gradients, no vignette, no off-white.",
        "CRITICAL COMPOSITION: Center the bottle, keep the full bottle visible, and frame so the bottle is ~92–96% of the image height.",
        "CRITICAL SEAL: The bottle must look sealed. Do not remove or redraw the capsule, foil, wax, or cork."
      );
    }

    return baseLines.join("\n");
  }

  function isLikelyUnchangedOutput({ outBase64, inBase64 }) {
    if (!outBase64 || !inBase64) return false;
    if (outBase64 === inBase64) return true;
    const lenDelta = Math.abs(outBase64.length - inBase64.length);
    const lenRatio = inBase64.length ? lenDelta / inBase64.length : 1;
    if (lenRatio < 0.01) {
      const prefixLen = 1024;
      if (outBase64.slice(0, prefixLen) === inBase64.slice(0, prefixLen)) return true;
    }
    return false;
  }

  function getDesiredImageSizes() {
    const requested = String(process.env.GOOGLE_IMAGE_SIZE || "4K").trim().toUpperCase();
    const options = [requested, "4K", "2K", "1K"];
    const seen = new Set();
    return options.filter(v => v && !seen.has(v) && seen.add(v));
  }

  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent`;
  const outputMimeType = String(process.env.GOOGLE_IMAGE_OUTPUT_MIME || "image/png").trim() || "image/png";

  function buildImageConfig({ imageSize, includeOutputOptions }) {
    const cfg = {
      aspectRatio: "1:1",
      ...(imageSize ? { imageSize } : {})
    };
    if (includeOutputOptions) {
      cfg.imageOutputOptions = { mimeType: outputMimeType };
    }
    return cfg;
  }

  function isUnsupportedConfigError(err) {
    const msg = String(err?.message || "").toLowerCase();
    return (
      msg.includes("unknown name") ||
      msg.includes("cannot find field") ||
      msg.includes("invalid value") ||
      msg.includes("imageoutputoptions") ||
      msg.includes("imagesize")
    );
  }

  async function callGemini({ promptText, imageSize, includeOutputOptions = true }) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: promptText },
            { inlineData: { mimeType, data: base64Image } }
          ]
        }],
        generationConfig: {
          temperature: 0.2,
          imageConfig: buildImageConfig({ imageSize, includeOutputOptions })
        }
      })
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      const msg = json?.error?.message || JSON.stringify(json)?.slice(0, 300) || `HTTP ${res.status}`;
      const error = new Error(`Gemini image API error (${res.status}): ${msg}`);
      error.status = res.status;
      error.details = msg;
      throw error;
    }

    const candidate = json?.candidates?.[0];
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      if (part?.inlineData?.data) {
        const outMime = part.inlineData.mimeType || outputMimeType || "image/png";
        const outBase64 = part.inlineData.data;
        return { outMime, outBase64 };
      }
    }

    return null;
  }

  async function attempt({ mode, imageSize }) {
    let result = null;
    try {
      result = await callGemini({ promptText: buildEditPrompt({ mode }), imageSize });
    } catch (e) {
      if (isUnsupportedConfigError(e)) {
        try {
          result = await callGemini({
            promptText: buildEditPrompt({ mode }),
            imageSize,
            includeOutputOptions: false
          });
        } catch (e2) {
          console.warn(`IMAGE: Gemini call failed (mode=${mode}, size=${imageSize}):`, e2?.message || String(e2));
          return null;
        }
      } else {
        console.warn(`IMAGE: Gemini call failed (mode=${mode}, size=${imageSize}):`, e?.message || String(e));
        return null;
      }
    }
    if (!result?.outBase64) return null;
    if (isLikelyUnchangedOutput({ outBase64: result.outBase64, inBase64: base64Image })) {
      console.warn(`IMAGE: Gemini output looks unchanged (mode=${mode}, size=${imageSize})`);
      return { ...result, unchanged: true };
    }
    return result;
  }

  const sizesToTry = getDesiredImageSizes();
  const modes = ["normal", "sealed_strict", "background_only"];

  for (const mode of modes) {
    for (const imageSize of sizesToTry) {
      const r = await attempt({ mode, imageSize });
      if (!r || r.unchanged) continue;

      let processed;
      try {
        processed = await flattenBackgroundAndValidate(Buffer.from(r.outBase64, "base64"));
      } catch (e) {
        console.warn("IMAGE: sharp post-process failed:", e?.message || String(e));
        processed = { buffer: Buffer.from(r.outBase64, "base64"), capsuleMissing: false, bgFixed: false };
      }

      const acceptableTop = !processed.capsuleMissing || mode !== "normal";
      if (acceptableTop) {
        const outBase64 = processed.buffer.toString("base64");
        console.log(
          "IMAGE: returning processed image",
          `(mode=${mode}, size=${imageSize}, bgFixed=${processed.bgFixed}, capsuleMissing=${processed.capsuleMissing})`
        );
        return `data:image/png;base64,${outBase64}`;
      }

      console.warn(`IMAGE: capsule missing after mode=${mode} — escalating to next mode`);
      break;
    }
  }

  console.log("IMAGE: All Gemini attempts failed; falling back to original image.");
  return null;
}

/**
 * sharp pipeline: replace near-white background pixels with pure #FFFFFF,
 * then check the top region of the image for a missing-capsule anomaly.
 *
 * Heuristics:
 *  - Background detection: 4 corners + 4 edge midpoints must each have a mean RGB > 245
 *    to consider the image "studio-like". If so, we replace any pixel where R,G,B all > 235
 *    AND chroma (max-min) < 14 with (255,255,255).
 *  - Capsule check: locate the bottle's bounding box from the mask, then inspect the top
 *    15% strip. If the neck region in that strip is wider than ~85% of the bottle width AND
 *    the topmost non-background pixel sits more than ~8% below the bottle's top edge, the
 *    capsule has likely been removed.
 *
 * Returns { buffer: PNG, bgFixed: boolean, capsuleMissing: boolean }.
 */
export async function flattenBackgroundAndValidate(pngBuffer) {
  const img = sharp(pngBuffer).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  function pixel(x, y) {
    const idx = (y * width + x) * channels;
    return [data[idx], data[idx + 1], data[idx + 2]];
  }

  // Per-pixel test for "near-white background pixel" — used both for the studio-like gate
  // (must apply to every corner sample) and for the actual flatten mask.
  function isNearWhite(r, g, b) {
    if (r < 225 || g < 225 || b < 225) return false;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max - min < 16;
  }

  // Use the 4 corners (a centered bottle won't reach them) plus the 4 side mid-edges that sit
  // 5% inside the frame (away from the bottle, which is typically centered and ~92-96% tall).
  const sideInset = Math.max(3, Math.floor(Math.min(width, height) * 0.05));
  const samples = [
    pixel(2, 2),
    pixel(width - 3, 2),
    pixel(2, height - 3),
    pixel(width - 3, height - 3),
    pixel(sideInset, Math.floor(height / 2)),
    pixel(width - 1 - sideInset, Math.floor(height / 2))
  ];
  // Studio-like means every edge sample is near-white (lets us catch off-white backgrounds
  // around 235-252 while rejecting genuinely colored or dark backdrops).
  const studioLike = samples.every(([r, g, b]) => isNearWhite(r, g, b));

  let bgFixed = false;
  if (studioLike) {
    for (let i = 0; i < data.length; i += channels) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (isNearWhite(r, g, b)) {
        if (r !== 255 || g !== 255 || b !== 255) {
          data[i] = 255;
          data[i + 1] = 255;
          data[i + 2] = 255;
          bgFixed = true;
        }
      }
    }
  }

  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      if (!isNearWhite(r, g, b)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  let capsuleMissing = false;
  if (maxX > minX && maxY > minY) {
    const bottleWidth = maxX - minX + 1;
    const bottleHeight = maxY - minY + 1;
    const topStripHeight = Math.max(1, Math.round(bottleHeight * 0.15));
    let neckLeft = width, neckRight = -1;
    let topPixelY = -1;
    for (let y = minY; y < minY + topStripHeight && y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = (y * width + x) * channels;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        if (!isNearWhite(r, g, b)) {
          if (topPixelY < 0) topPixelY = y;
          if (x < neckLeft) neckLeft = x;
          if (x > neckRight) neckRight = x;
        }
      }
    }
    if (neckRight >= neckLeft && topPixelY >= 0) {
      const neckWidth = neckRight - neckLeft + 1;
      const neckRatio = neckWidth / bottleWidth;
      const topOffsetRatio = (topPixelY - minY) / bottleHeight;
      if (neckRatio > 0.85 && topOffsetRatio > 0.08) {
        capsuleMissing = true;
      }
    }
  }

  const outBuffer = await sharp(data, { raw: { width, height, channels } })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();

  return { buffer: outBuffer, bgFixed, capsuleMissing };
}
