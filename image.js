import fetch from "node-fetch";
import sharp from "sharp";

/**
 * Generate a studio product shot with white background
 * Uses Google's Gemini image model (Nano Banana / Gemini 3 Pro Image) for image generation/editing
 */
export async function generateStudioImage(imageUrl) {
  console.log("IMAGE: Generating studio product shot");
  console.log("IMAGE: Input URL:", imageUrl);

  // #region agent log
  (()=>{const payload={sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H1',location:'image.js:12',message:'generateStudioImage entry',data:{hasGoogleAiKey:Boolean(process.env.GOOGLE_AI_API_KEY),googleApiVersion:process.env.GOOGLE_API_VERSION||'v1',googleImageModel:process.env.GOOGLE_IMAGE_MODEL||'gemini-3-pro-image-preview',imageUrlHost:(()=>{try{return new URL(imageUrl).host;}catch{return null;}})()},timestamp:Date.now()};console.log("AGENT_LOG",JSON.stringify(payload));globalThis.fetch?.('http://127.0.0.1:7242/ingest/5a136f99-0f58-49f0-8eb8-c368792b2230',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).catch(()=>{});})();
  // #endregion

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

  // Fall back to original image
  console.log("IMAGE: Generation failed, using original image");
  return imageUrl;
}

/**
 * Generate studio image using Google Gemini Image models (Nano Banana / Gemini 3 Pro Image).
 * Returns a data: URL with base64 image content.
 */
async function generateWithGeminiImage(imageUrl) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  const modelNameRaw = process.env.GOOGLE_IMAGE_MODEL || "gemini-3-pro-image-preview";
  const modelName = modelNameRaw.startsWith("models/") ? modelNameRaw.slice("models/".length) : modelNameRaw;
  // Gemini image models are commonly exposed on v1beta.
  const apiVersion = process.env.GOOGLE_IMAGE_API_VERSION || process.env.GOOGLE_API_VERSION || "v1beta";

  // Fetch the image and convert to base64
  const imageResponse = await fetch(imageUrl);
  // #region agent log
  (()=>{const payload={sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H2',location:'image.js:48',message:'Fetched input image for Gemini',data:{status:imageResponse.status,ok:imageResponse.ok,contentType:imageResponse.headers.get("content-type")||null},timestamp:Date.now()};console.log("AGENT_LOG",JSON.stringify(payload));globalThis.fetch?.('http://127.0.0.1:7242/ingest/5a136f99-0f58-49f0-8eb8-c368792b2230',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).catch(()=>{});})();
  // #endregion
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch input image (${imageResponse.status})`);
  }
  const imageBuffer = await imageResponse.arrayBuffer();
  const base64Image = Buffer.from(imageBuffer).toString("base64");
  const mimeType = imageResponse.headers.get("content-type") || "image/png";

  async function forcePureWhiteBackgroundDataUrl(dataUrl) {
    try {
      const match = /^data:([^;]+);base64,(.*)$/s.exec(String(dataUrl || ""));
      if (!match) return dataUrl;

      const inBuf = Buffer.from(match[2], "base64");
      const { data, info } = await sharp(inBuf)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const { width, height, channels } = info;
      if (!width || !height || channels < 3) return dataUrl;

      const w = width;
      const h = height;
      const visited = new Uint8Array(w * h);
      const queue = new Uint32Array(w * h);
      let head = 0;
      let tail = 0;

      function idxOf(x, y) {
        return y * w + x;
      }

      function isNearWhiteAtIndex(idx) {
        const o = idx * channels;
        const r = data[o];
        const g = data[o + 1];
        const b = data[o + 2];
        const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
        const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
        // Accept slightly-off whites (e.g. light gray) while rejecting saturated areas.
        // Tune conservatively to avoid eating into the bottle.
        return max >= 242 && (max - min) <= 18;
      }

      function pushIfBackground(x, y) {
        const idx = idxOf(x, y);
        if (visited[idx]) return;
        if (!isNearWhiteAtIndex(idx)) return;
        visited[idx] = 1;
        queue[tail++] = idx;
      }

      // Seed from border pixels (background touches edges in a packshot).
      for (let x = 0; x < w; x++) {
        pushIfBackground(x, 0);
        pushIfBackground(x, h - 1);
      }
      for (let y = 0; y < h; y++) {
        pushIfBackground(0, y);
        pushIfBackground(w - 1, y);
      }

      // Flood fill 4-neighborhood over near-white pixels connected to border.
      while (head < tail) {
        const idx = queue[head++];
        const y = Math.floor(idx / w);
        const x = idx - y * w;

        if (x > 0) pushIfBackground(x - 1, y);
        if (x + 1 < w) pushIfBackground(x + 1, y);
        if (y > 0) pushIfBackground(x, y - 1);
        if (y + 1 < h) pushIfBackground(x, y + 1);
      }

      // Force visited background pixels to pure white.
      for (let i = 0; i < visited.length; i++) {
        if (!visited[i]) continue;
        const o = i * channels;
        data[o] = 255;
        data[o + 1] = 255;
        data[o + 2] = 255;
        // Preserve alpha channel if present.
      }

      const outBuf = await sharp(data, { raw: { width: w, height: h, channels } })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer();

      return `data:image/png;base64,${outBuf.toString("base64")}`;
    } catch (e) {
      console.warn("IMAGE: Failed to force pure white background:", e?.message || String(e));
      return dataUrl;
    }
  }

  // Gemini responds best when the edit request is explicit and structured.
  // We embed a JSON "edit spec" to reduce ambiguity and ensure hands/props are removed.
  function buildEditPrompt({ strict = false } = {}) {
    const spec = {
      goal: "studio_packshot",
      background: { type: "solid", color: "#FFFFFF", seamless: true },
      subject: {
        type: "single_bottle",
        preserve_identity: true,
        preserve_label_text: true,
        preserve_colors: true,
        preserve_geometry: true
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
        "stickers_not_part_of_label",
        "background_objects"
      ],
      inpaint: {
        reconstruct_occluded_bottle_areas: true,
        match_glass_reflections: true,
        keep_artifacts_minimal: true
      },
      lighting: {
        style: "soft_even_studio",
        shadows: "minimal_natural_only",
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
        "stylization"
      ],
      output: { single_image: true }
    };

    return [
      "You are a professional product-photo retoucher.",
      "Edit the provided image to match the JSON edit spec exactly.",
      "Return only the edited image. Do not add any text overlays or borders.",
      "",
      "JSON_EDIT_SPEC:",
      JSON.stringify(spec, null, 2),
      "",
      strict
        ? "CRITICAL: If ANY human hand/fingers/arm is visible, it MUST be completely removed. Reconstruct any hidden parts of the bottle/label/glass realistically so the final image looks like a clean bottle-only studio shot."
        : "If hands/props are present, remove them cleanly and reconstruct any hidden bottle areas.",
      "CRITICAL: Background must be PERFECT pure white (#FFFFFF) with NO gradient and NO off-white tint.",
      "CRITICAL: The final image must look like a clean e-commerce packshot: centered, even studio lighting, everything visible."
    ].join("\n");
  }

  function isLikelyUnchangedOutput({ outBase64, inBase64 }) {
    if (!outBase64 || !inBase64) return false;
    if (outBase64 === inBase64) return true;
    // Heuristic: exact-match prefixes + near-identical length can indicate the model returned the original bytes.
    const lenDelta = Math.abs(outBase64.length - inBase64.length);
    const lenRatio = inBase64.length ? lenDelta / inBase64.length : 1;
    if (lenRatio < 0.01) {
      const prefixLen = 1024;
      if (outBase64.slice(0, prefixLen) === inBase64.slice(0, prefixLen)) return true;
    }
    return false;
  }

  try {
    const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent`;
    async function callGemini({ promptText }) {
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
            // Lower temperature for more consistent, constraint-following edits.
            temperature: 0.2,
            // Image models use imageConfig; keep it minimal for compatibility.
            imageConfig: { aspectRatio: "1:1" }
          }
        })
      });

      const json = await res.json().catch(() => null);

      // #region agent log
      (()=>{const cand=json?.candidates?.[0];const parts=Array.isArray(cand?.content?.parts)?cand.content.parts:[];const payload={sessionId:'debug-session',runId:'post-fix',hypothesisId:'H3',location:'image.js:callGemini',message:'Gemini image response candidate shape',data:{httpStatus:res.status,ok:res.ok,hasCandidates:Boolean(json?.candidates?.length),partsCount:parts.length,hasInlineData:parts.some(p=>Boolean(p?.inlineData?.data))},timestamp:Date.now()};console.log("AGENT_LOG",JSON.stringify(payload));globalThis.fetch?.('http://127.0.0.1:7242/ingest/5a136f99-0f58-49f0-8eb8-c368792b2230',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).catch(()=>{});})();
      // #endregion

      if (!res.ok) {
        const msg = json?.error?.message || JSON.stringify(json)?.slice(0, 300) || `HTTP ${res.status}`;
        throw new Error(`Gemini image API error (${res.status}): ${msg}`);
      }

      const candidate = json?.candidates?.[0];
      const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
      for (const part of parts) {
        if (part?.inlineData?.data) {
          const outMime = part.inlineData.mimeType || "image/png";
          const outBase64 = part.inlineData.data;
          return { outMime, outBase64 };
        }
      }

      return null;
    }

    // Attempt 1: JSON spec
    const attempt1 = await callGemini({ promptText: buildEditPrompt({ strict: false }) });
    if (attempt1?.outBase64) {
      const unchanged = isLikelyUnchangedOutput({ outBase64: attempt1.outBase64, inBase64: base64Image });
      if (!unchanged) {
        const dataUrl = `data:${attempt1.outMime};base64,${attempt1.outBase64}`;
        return await forcePureWhiteBackgroundDataUrl(dataUrl);
      }
      console.warn("IMAGE: Gemini output looks unchanged; retrying with stricter hand/prop removal prompt");
    } else {
      console.warn("IMAGE: Gemini did not return image data; retrying once");
    }

    // Attempt 2: stricter instruction (hand/prop removal + reconstruction)
    const attempt2 = await callGemini({ promptText: buildEditPrompt({ strict: true }) });
    if (attempt2?.outBase64) {
      const unchanged = isLikelyUnchangedOutput({ outBase64: attempt2.outBase64, inBase64: base64Image });
      if (!unchanged) {
        const dataUrl = `data:${attempt2.outMime};base64,${attempt2.outBase64}`;
        return await forcePureWhiteBackgroundDataUrl(dataUrl);
      }
      console.warn("IMAGE: Gemini output still looks unchanged after retry");
    }

    console.log("IMAGE: Response did not contain usable image data");
    return null;
  } catch (err) {
    console.error("IMAGE: Gemini API error:", err.message);
    // If model is not found/supported, list available models to guide configuration.
    if (String(err?.message || "").includes("models/") && String(err?.message || "").includes("not found")) {
      try {
        const listUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models?key=${encodeURIComponent(process.env.GOOGLE_AI_API_KEY)}`;
        const res = await fetch(listUrl);
        const json = await res.json().catch(() => null);
        const names = Array.isArray(json?.models) ? json.models.map(m => m?.name).filter(Boolean).slice(0, 20) : [];
        console.error("IMAGE: Available models (first 20):", names.join(", ") || "(none)");
      } catch (listErr) {
        console.error("IMAGE: Failed to list models:", listErr?.message || String(listErr));
      }
    }
    throw err;
  }
}
