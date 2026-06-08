import fetch from "node-fetch";

/**
 * Generate a clean e-commerce "studio packshot" from a user-uploaded bottle photo.
 *
 * Pipeline: takes the source photo (which may include a hand, messy background,
 * shelf, props, etc.), sends it to Google's Gemini image-editing model, and asks
 * the model to reproduce the SAME bottle on a pure white background with hands /
 * props removed. Returns a `data:` URL with the edited PNG/JPEG.
 *
 * On any failure (no API key, network error, model returns no usable image, or the
 * model just echoes the input unchanged) we fall back to returning the original
 * `imageUrl` so the product-creation pipeline never hard-breaks on a bad photo.
 *
 * Model: defaults to "gemini-3-pro-image-preview" (Nano Banana Pro). The Pro tier
 * is chosen over the cheaper Flash tier deliberately: this is a final, client-facing
 * e-commerce asset whose value depends on the bottle label text/logos staying
 * crisp and READABLE and the geometry staying true. Google's own guidance is to use
 * Pro when "the image must carry readable text ... a final deliverable" because a
 * single failed/garbled output costs manual repair time. Override with
 * GOOGLE_IMAGE_MODEL if you want to route to Flash for cheaper/lower-risk runs.
 *
 * Docs used:
 *  - https://ai.google.dev/gemini-api/docs/image-generation  (Nano Banana image gen/edit, imageConfig)
 *  - https://ai.google.dev/gemini-api/docs/models/gemini-3-pro-image-preview
 *  - https://ai.google.dev/gemini-api/docs/gemini-3  (responseModalities, generateContent)
 *  - https://ai.google.dev/gemini-api/docs/thought-signatures  (thinking models emit intermediate
 *    "thought" image parts; must skip thought:true parts and take the FINAL image)
 *
 * @param {string} imageUrl - URL (or data URL) of the source bottle photo.
 * @param {object} [opts]
 * @param {string} [opts.productContext] - OPTIONAL short hint (brand / expression
 *   name, e.g. "Lagavulin 16 Year"). Used ONLY to help the model read the existing
 *   label correctly. It is never used to invent or "correct" label text.
 * @returns {Promise<string>} data: URL of the studio image, or the original imageUrl on failure.
 */
export async function generateStudioImage(imageUrl, { productContext } = {}) {
  console.log("IMAGE: Generating studio product shot");
  console.log("IMAGE: Input URL:", imageUrl);

  if (!process.env.GOOGLE_AI_API_KEY) {
    console.warn("IMAGE: GOOGLE_AI_API_KEY not configured, using original image");
    return imageUrl;
  }

  try {
    const result = await generateWithGeminiImage(imageUrl, { productContext });
    if (result) {
      console.log("IMAGE: Gemini image success");
      return result;
    }
  } catch (err) {
    console.error("IMAGE: Gemini image failed:", err.message);
  }

  // Graceful fallback: better to ship the original photo than nothing.
  console.log("IMAGE: Generation failed, using original image");
  return imageUrl;
}

/**
 * Build the editing prompt. The prompt is written in plain imperative English
 * (Gemini image models respond better to a clear scene/edit description than to a
 * dumped JSON blob), with each constraint mapped to one of the 4 reported defects.
 */
function buildEditPrompt(productContext) {
  // productContext is used ONLY as a reading aid, never as a license to fabricate.
  const contextLine = productContext
    ? `For reference only, this bottle is believed to be "${String(productContext).trim()}". ` +
      `Use this ONLY to read the existing label more accurately. Do NOT add, change, ` +
      `translate, or "correct" any text or logo based on it.`
    : "";

  return [
    "You are a professional product photographer retouching a bottle photo into a clean e-commerce packshot.",
    "Edit the SOURCE image into a single-bottle studio product shot. Output only the edited image, no text or borders.",
    "",
    // DEFECT 4 — grounding / identity preservation. This is the most important rule:
    // the output must be the SAME physical bottle, not a stylized re-imagining.
    "IDENTITY (most important): Keep this EXACT bottle. Preserve the real label artwork, all printed text, fonts, logos, colors, the liquid color, and the fill level exactly as they appear in the source. Do NOT invent, restyle, sharpen-into-different, translate, or re-letter any text. If a hand or finger covers part of the bottle, reconstruct ONLY that hidden area so it matches the surrounding glass/label realistically.",
    contextLine,
    "",
    // DEFECT 2 — seal / closure preservation. The model often "opens" the bottle.
    "CLOSURE: The bottle is SEALED and unopened. Preserve the exact top closure from the source - the cork, capsule, screw cap, wax seal, foil, or neck tag - in the same shape, color, and position. Never remove the closure and never render the bottle as open or uncapped.",
    "",
    // DEFECT 3 — proportions / geometry.
    "GEOMETRY: Keep the bottle's true shape and proportions. Do NOT stretch, squash, slim, widen, or re-shape it. The silhouette, neck length, shoulder, and body must match the source.",
    "",
    // DEFECT 1 — pure white background, no shadow/gradient/vignette.
    "BACKGROUND: Replace the entire background with a single, completely uniform PURE WHITE (#FFFFFF, RGB 255,255,255). No off-white, cream, grey, gradient, vignette, texture, or colored tint. Cast NO shadow on the background - no drop shadow, no contact shadow, no reflection pool. The bottle should sit on pure white with only its own subtle on-glass highlights.",
    "",
    "REMOVE: any hands, fingers, arms, people, price tags, shelves, stands, props, or other objects. Keep only the single bottle.",
    "LIGHTING: soft, even studio lighting on the bottle itself. Center the bottle, keep the whole bottle (closure to base) in frame, sized at roughly 90% of the image height.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Heuristic: detect when the model essentially handed us the input back unchanged
 * (some models echo the source when they refuse/ignore the edit). Cheap guard so we
 * don't ship a non-edited image as if it were a packshot.
 */
function isLikelyUnchangedOutput(outBase64, inBase64) {
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

/**
 * Pick the FINAL rendered image from a Gemini response.
 *
 * Gemini 3 Pro Image ("thinking" image model) can return up to ~3 image parts:
 * intermediate "thought" drafts (marked `thought: true`) plus the final image.
 * Grabbing parts[0] (as legacy code does) can hand back a rough draft. Per Google's
 * guidance we skip any `thought: true` part and take the LAST inlineData image,
 * which is the finished render. Falls back to the last inlineData part of any kind.
 * See https://ai.google.dev/gemini-api/docs/thought-signatures
 */
function extractFinalImagePart(parts) {
  let lastAny = null;
  let lastFinal = null;
  for (const part of parts) {
    if (!part?.inlineData?.data) continue;
    lastAny = part;
    if (part.thought !== true) lastFinal = part;
  }
  return lastFinal || lastAny;
}

/**
 * Call the Gemini image-editing model and return a data: URL, or null if no image.
 */
async function generateWithGeminiImage(imageUrl, { productContext } = {}) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;

  // Default to Nano Banana Pro; overridable via env (kept name GOOGLE_IMAGE_MODEL).
  const modelNameRaw = process.env.GOOGLE_IMAGE_MODEL || "gemini-3-pro-image-preview";
  const modelName = modelNameRaw.startsWith("models/")
    ? modelNameRaw.slice("models/".length)
    : modelNameRaw;
  // Gemini image models are served on v1beta.
  const apiVersion =
    process.env.GOOGLE_IMAGE_API_VERSION || process.env.GOOGLE_API_VERSION || "v1beta";

  // Fetch the source image and inline it as base64 (REST inlineData).
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch input image (${imageResponse.status})`);
  }
  const imageBuffer = await imageResponse.arrayBuffer();
  const base64Image = Buffer.from(imageBuffer).toString("base64");
  const mimeType = imageResponse.headers.get("content-type") || "image/png";

  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent`;
  const promptText = buildEditPrompt(productContext);

  // imageSize options to try (largest first). 4K/2K/1K are the documented sizes for
  // Nano Banana Pro; some routes/models ignore or reject imageSize, so we fall back.
  const requestedSize = String(process.env.GOOGLE_IMAGE_SIZE || "2K").trim().toUpperCase();
  const sizesToTry = [...new Set([requestedSize, "2K", "1K"].filter(Boolean))];

  async function callGemini(imageSize) {
    const imageConfig = {
      // 1:1 square is the standard e-commerce packshot frame on the storefront.
      aspectRatio: "1:1",
      ...(imageSize ? { imageSize } : {}),
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: promptText },
              { inlineData: { mimeType, data: base64Image } },
            ],
          },
        ],
        generationConfig: {
          // REQUIRED so the model returns image bytes (not just a text reply).
          responseModalities: ["TEXT", "IMAGE"],
          // Low temperature -> more faithful, less "creative" edits (helps identity).
          temperature: 0.2,
          imageConfig,
        },
      }),
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      const msg =
        json?.error?.message || JSON.stringify(json)?.slice(0, 300) || `HTTP ${res.status}`;
      const error = new Error(`Gemini image API error (${res.status}): ${msg}`);
      error.status = res.status;
      throw error;
    }

    const parts = json?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return null;
    const finalPart = extractFinalImagePart(parts);
    if (!finalPart) return null;
    return {
      outMime: finalPart.inlineData.mimeType || "image/png",
      outBase64: finalPart.inlineData.data,
    };
  }

  // Detect "this model/route doesn't accept imageSize" so we can drop it and retry.
  function isUnsupportedSizeError(err) {
    const msg = String(err?.message || "").toLowerCase();
    return (
      msg.includes("imagesize") ||
      msg.includes("unknown name") ||
      msg.includes("invalid value") ||
      msg.includes("cannot find field")
    );
  }

  for (const imageSize of sizesToTry) {
    let result;
    try {
      result = await callGemini(imageSize);
    } catch (err) {
      if (isUnsupportedSizeError(err)) {
        // Retry once for this iteration without imageSize, then continue.
        try {
          result = await callGemini(null);
        } catch (err2) {
          console.warn(`IMAGE: Gemini call failed (no imageSize):`, err2?.message || String(err2));
          continue;
        }
      } else {
        console.warn(
          `IMAGE: Gemini call failed (imageSize=${imageSize}):`,
          err?.message || String(err)
        );
        continue;
      }
    }

    if (result?.outBase64) {
      if (isLikelyUnchangedOutput(result.outBase64, base64Image)) {
        console.warn(`IMAGE: Gemini output looks unchanged (imageSize=${imageSize}); trying next size`);
        continue;
      }
      return `data:${result.outMime};base64,${result.outBase64}`;
    }
    console.warn(`IMAGE: Gemini returned no image data (imageSize=${imageSize})`);
  }

  console.log("IMAGE: Response did not contain usable image data");
  return null;
}
