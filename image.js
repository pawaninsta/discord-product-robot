import fetch from "node-fetch";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Generate a studio product shot with white background
 * Tries Gemini 3 first, then NanoBanana, then falls back to original
 */
export async function generateStudioImage(imageUrl) {
  console.log("IMAGE: Generating studio product shot");
  console.log("IMAGE: Input URL:", imageUrl);

  // Try Gemini 3 first (if API key is configured)
  if (process.env.GOOGLE_AI_API_KEY) {
    try {
      const result = await generateWithGemini(imageUrl);
      if (result) {
        console.log("IMAGE: Gemini 3 success");
        return result;
      }
    } catch (err) {
      console.error("IMAGE: Gemini 3 failed:", err.message);
    }
  } else {
    console.log("IMAGE: GOOGLE_AI_API_KEY not configured, skipping Gemini");
  }

  // Try NanoBanana as fallback
  if (process.env.NANOBANANA_API_KEY) {
    try {
      const result = await generateWithNanoBanana(imageUrl);
      if (result) {
        console.log("IMAGE: NanoBanana success");
        return result;
      }
    } catch (err) {
      console.error("IMAGE: NanoBanana failed:", err.message);
    }
  } else {
    console.log("IMAGE: NANOBANANA_API_KEY not configured, skipping NanoBanana");
  }

  // Fall back to original image
  console.log("IMAGE: All services failed, using original image");
  return imageUrl;
}

/**
 * Generate studio image using Gemini 3 with Imagen 3
 */
async function generateWithGemini(imageUrl) {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
  
  // Use Gemini 3 Flash for image generation
  // Note: Model name may need to be updated based on latest Google AI availability
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash-exp-image-generation",
    generationConfig: {
      // Do NOT set response_mime_type for image generation - this caused the 400 error
      temperature: 0.4,
    },
  });

  // Fetch the image and convert to base64
  const imageResponse = await fetch(imageUrl);
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
      
      // Look for inline image data in the response
      if (candidate.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
          if (part.inlineData && part.inlineData.data) {
            // Convert base64 to data URL
            const outputMimeType = part.inlineData.mimeType || "image/png";
            return `data:${outputMimeType};base64,${part.inlineData.data}`;
          }
        }
      }
    }

    console.log("IMAGE: Gemini response did not contain image data");
    return null;
  } catch (err) {
    // Log the specific error for debugging
    console.error("IMAGE: Gemini API error:", err.message);
    throw err;
  }
}

/**
 * Generate studio image using NanoBanana API
 */
async function generateWithNanoBanana(imageUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000); // 30 sec timeout

  try {
    const res = await fetch("https://api.nanobanana.ai/generate", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.NANOBANANA_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        image: imageUrl,
        style: "studio_product_white_background"
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`NanoBanana API returned ${res.status}`);
    }

    const data = await res.json();

    if (data?.output_image_url) {
      return data.output_image_url;
    }

    return null;
  } finally {
    clearTimeout(timeout);
  }
}
