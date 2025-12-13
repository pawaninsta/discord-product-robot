import fetch from "node-fetch";

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

  const prompt = `Edit this existing product photo.

GOAL: Standardized studio packshot.

- Replace ONLY the background with pure white (#FFFFFF) seamless studio backdrop.
- Keep the bottle exactly the same (shape, label, colors, reflections). Do not distort.
- Keep the full bottle visible (do not crop any part of the bottle).
- COMPOSITION: Scale and crop the image so the bottle occupies ~92–96% of the image height.
  - Minimal even margin above the cap and below the base.
  - Center the bottle horizontally.
- No extra props, no shadows beyond the bottle’s natural shadow, no text overlays.`;

  try {
    const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64Image } }
          ]
        }],
        generationConfig: {
          temperature: 0.4,
          // Image models use imageConfig; keep it minimal for compatibility.
          imageConfig: { aspectRatio: "1:1" }
        }
      })
    });

    const json = await res.json().catch(() => null);

    // #region agent log
    (()=>{const cand=json?.candidates?.[0];const parts=Array.isArray(cand?.content?.parts)?cand.content.parts:[];const payload={sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H3',location:'image.js:76',message:'Gemini image response candidate shape',data:{httpStatus:res.status,ok:res.ok,hasCandidates:Boolean(json?.candidates?.length),partsCount:parts.length,hasInlineData:parts.some(p=>Boolean(p?.inlineData?.data))},timestamp:Date.now()};console.log("AGENT_LOG",JSON.stringify(payload));globalThis.fetch?.('http://127.0.0.1:7242/ingest/5a136f99-0f58-49f0-8eb8-c368792b2230',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).catch(()=>{});})();
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
        return `data:${outMime};base64,${part.inlineData.data}`;
      }
    }

    console.log("IMAGE: Response did not contain image data");
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
