import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from "node-fetch";

/**
 * Generate a studio product shot with white background
 * Uses Google's Gemini with Imagen (Nano Banana Pro) for image generation
 */
export async function generateStudioImage(imageUrl) {
  console.log("IMAGE: Generating studio product shot");
  console.log("IMAGE: Input URL:", imageUrl);

  // #region agent log
  (()=>{const payload={sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H1',location:'image.js:12',message:'generateStudioImage entry',data:{hasGoogleAiKey:Boolean(process.env.GOOGLE_AI_API_KEY),googleApiVersion:process.env.GOOGLE_API_VERSION||'v1',googleImageModel:process.env.GOOGLE_IMAGE_MODEL||'gemini-1.5-flash',imageUrlHost:(()=>{try{return new URL(imageUrl).host;}catch{return null;}})()},timestamp:Date.now()};console.log("AGENT_LOG",JSON.stringify(payload));globalThis.fetch?.('http://127.0.0.1:7242/ingest/5a136f99-0f58-49f0-8eb8-c368792b2230',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).catch(()=>{});})();
  // #endregion

  if (!process.env.GOOGLE_AI_API_KEY) {
    console.warn("IMAGE: GOOGLE_AI_API_KEY not configured, using original image");
    return imageUrl;
  }

  try {
    const result = await generateWithGemini(imageUrl);
    if (result) {
      console.log("IMAGE: Gemini/Imagen success");
      return result;
    }
  } catch (err) {
    console.error("IMAGE: Gemini/Imagen failed:", err.message);
  }

  // Fall back to original image
  console.log("IMAGE: Generation failed, using original image");
  return imageUrl;
}

/**
 * Generate studio image using Google Gemini with Imagen (Nano Banana Pro)
 */
async function generateWithGemini(imageUrl) {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
  const apiVersion = process.env.GOOGLE_API_VERSION || "v1";
  
  // Use Gemini model with image generation capability
  const modelName = process.env.GOOGLE_IMAGE_MODEL || "gemini-1.5-flash";
  const model = genAI.getGenerativeModel({
    // NOTE: The previous model id was returning 404 in Railway logs.
    // This SDK version (@google/generative-ai@0.21.0) documents Gemini 1.5 models.
    // You can override with GOOGLE_IMAGE_MODEL if your account supports a newer image-capable model.
    model: modelName,
    generationConfig: {
      temperature: 0.4,
    },
  }, { apiVersion });

  // Fetch the image and convert to base64
  const imageResponse = await fetch(imageUrl);
  // #region agent log
  (()=>{const payload={sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H2',location:'image.js:48',message:'Fetched input image for Gemini',data:{status:imageResponse.status,ok:imageResponse.ok,contentType:imageResponse.headers.get("content-type")||null},timestamp:Date.now()};console.log("AGENT_LOG",JSON.stringify(payload));globalThis.fetch?.('http://127.0.0.1:7242/ingest/5a136f99-0f58-49f0-8eb8-c368792b2230',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).catch(()=>{});})();
  // #endregion
  const imageBuffer = await imageResponse.arrayBuffer();
  const base64Image = Buffer.from(imageBuffer).toString("base64");
  const mimeType = imageResponse.headers.get("content-type") || "image/png";

  const prompt = `Take this product image and place it on a clean, professional white studio background. 
Keep the product exactly as it appears - same angle, same lighting on the product itself.
Only replace the background with a pure white (#FFFFFF) seamless studio backdrop.
The product should appear to be professionally photographed in a commercial product photography studio.
Do not alter the product in any way - just isolate it and place it on the white background.`;

  try {
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Image,
        },
      },
    ]);

    const response = result.response;
    
    // Check if the response contains an image
    if (response.candidates && response.candidates[0]) {
      const candidate = response.candidates[0];
      // #region agent log
      (()=>{const payload={sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H3',location:'image.js:76',message:'Gemini response candidate shape',data:{hasContent:Boolean(candidate.content),partsCount:Array.isArray(candidate.content?.parts)?candidate.content.parts.length:0,hasInlineData:Array.isArray(candidate.content?.parts)?candidate.content.parts.some(p=>Boolean(p?.inlineData?.data)):false},timestamp:Date.now()};console.log("AGENT_LOG",JSON.stringify(payload));globalThis.fetch?.('http://127.0.0.1:7242/ingest/5a136f99-0f58-49f0-8eb8-c368792b2230',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).catch(()=>{});})();
      // #endregion
      
      // Look for inline image data in the response
      if (candidate.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
          if (part.inlineData && part.inlineData.data) {
            // Return base64 data URL
            const outputMimeType = part.inlineData.mimeType || "image/png";
            return `data:${outputMimeType};base64,${part.inlineData.data}`;
          }
        }
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
