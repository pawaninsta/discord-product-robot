import fetch from "node-fetch";

/**
 * Generate a professional studio product shot using Google Gemini
 * - Uses Gemini's image generation/editing capabilities
 * - Returns base64 → uploads to Discord → returns URL
 */
export async function generateStudioImage(imageUrl) {
  console.log("IMAGE: Generating studio product shot");
  console.log("IMAGE: Input URL:", imageUrl);

  // Try Google Gemini (Nano Banana) first
  const geminiResult = await tryGeminiImageEdit(imageUrl);
  if (geminiResult) {
    return geminiResult;
  }

  // Try Remove.bg as fallback
  const removeBgResult = await tryRemoveBg(imageUrl);
  if (removeBgResult) {
    return removeBgResult;
  }

  // Return original if all services fail
  console.log("IMAGE: All services failed, using original image");
  return imageUrl;
}

/**
 * Google Gemini API - Image editing with Nano Banana Pro
 * Uses gemini-2.0-pro-exp-image-generation (Pro) for highest quality
 * Falls back to gemini-2.0-flash-preview-image-generation (Flash) if Pro unavailable
 */
async function tryGeminiImageEdit(imageUrl) {
  const apiKey = process.env.NANOBANANA_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    console.log("IMAGE: Google AI API key not configured (set NANOBANANA_API_KEY or GOOGLE_AI_API_KEY)");
    return null;
  }

  try {
    // First, fetch the original image and convert to base64
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      console.log("IMAGE: Failed to fetch original image");
      return null;
    }
    
    const imageBuffer = await imageResponse.buffer();
    const base64Image = imageBuffer.toString("base64");
    const mimeType = imageResponse.headers.get("content-type") || "image/jpeg";

    // Try Pro model first, fall back to Flash
    const models = [
      "gemini-2.0-pro-exp-image-generation",  // Nano Banana Pro (highest quality)
      "gemini-2.0-flash-preview-image-generation"  // Nano Banana Flash (faster)
    ];

    for (const model of models) {
      console.log(`IMAGE: Trying Gemini model: ${model}`);
      
      const result = await callGeminiModel(apiKey, model, base64Image, mimeType);
      if (result) {
        return result;
      }
    }

    console.log("IMAGE: All Gemini models failed");
    return null;

  } catch (err) {
    console.warn("IMAGE: Gemini failed:", err.message);
    return null;
  }
}

/**
 * Call a specific Gemini model for image editing
 */
async function callGeminiModel(apiKey, model, base64Image, mimeType) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000); // 90s for Pro model

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: "Edit this product photo: Remove the background completely and replace it with a pure white background. Keep the bottle exactly as it is - same angle, same lighting on the bottle itself. The result should look like a professional e-commerce product photo with clean white background, no shadows, no reflections. Output only the edited image."
                },
                {
                  inlineData: {
                    mimeType: mimeType,
                    data: base64Image
                  }
                }
              ]
            }
          ],
          generationConfig: {
            responseModalities: ["image", "text"],
            responseMimeType: "image/png"
          }
        }),
        signal: controller.signal
      }
    );

    clearTimeout(timeout);

    if (!res.ok) {
      const errorText = await res.text();
      console.log(`IMAGE: ${model} error:`, res.status, errorText.substring(0, 200));
      return null;
    }

    const data = await res.json();
    console.log(`IMAGE: ${model} response received`);

    // Extract base64 image from response
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith("image/"));

    if (!imagePart?.inlineData?.data) {
      console.log(`IMAGE: ${model} returned no image data`);
      const textParts = parts.filter(p => p.text).map(p => p.text).join(" ");
      if (textParts) {
        console.log(`IMAGE: Model response: ${textParts.substring(0, 100)}`);
      }
      return null;
    }

    console.log(`IMAGE: ${model} generated image, uploading to Discord...`);

    // Upload the generated image to Discord and get a URL
    const uploadedUrl = await uploadToDiscord(
      imagePart.inlineData.data,
      imagePart.inlineData.mimeType
    );

    if (uploadedUrl) {
      console.log(`IMAGE: ${model} success! URL:`, uploadedUrl);
      return uploadedUrl;
    }

    console.log("IMAGE: Failed to upload result to Discord");
    return null;

  } catch (err) {
    console.warn(`IMAGE: ${model} failed:`, err.message);
    return null;
  }
}

/**
 * Upload base64 image to Discord via webhook and get URL
 */
async function uploadToDiscord(base64Data, mimeType) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  
  if (!webhookUrl) {
    console.log("IMAGE: Discord webhook not configured for upload");
    return null;
  }

  try {
    // Convert base64 to buffer
    const imageBuffer = Buffer.from(base64Data, "base64");
    
    // Determine file extension
    const ext = mimeType.includes("png") ? "png" : "jpg";
    const filename = `product-${Date.now()}.${ext}`;

    // Create form data for Discord
    const FormData = (await import("form-data")).default;
    const form = new FormData();
    form.append("file", imageBuffer, {
      filename,
      contentType: mimeType
    });
    form.append("payload_json", JSON.stringify({
      content: "📸 Generated product image"
    }));

    const res = await fetch(webhookUrl, {
      method: "POST",
      body: form,
      headers: form.getHeaders()
    });

    if (!res.ok) {
      console.log("IMAGE: Discord upload failed:", res.status);
      return null;
    }

    const data = await res.json();
    
    // Get the attachment URL from Discord's response
    const attachment = data?.attachments?.[0];
    if (attachment?.url) {
      console.log("IMAGE: Discord upload success");
      return attachment.url;
    }

    return null;

  } catch (err) {
    console.warn("IMAGE: Discord upload error:", err.message);
    return null;
  }
}

/**
 * Remove.bg API - Background removal fallback
 */
async function tryRemoveBg(imageUrl) {
  if (!process.env.REMOVEBG_API_KEY) {
    console.log("IMAGE: Remove.bg API key not configured");
    return null;
  }

  try {
    console.log("IMAGE: Calling Remove.bg API");
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const formData = new URLSearchParams();
    formData.append("image_url", imageUrl);
    formData.append("size", "auto");
    formData.append("bg_color", "white");

    const res = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: {
        "X-Api-Key": process.env.REMOVEBG_API_KEY
      },
      body: formData.toString(),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errorText = await res.text();
      console.log("IMAGE: Remove.bg error:", res.status, errorText);
      return null;
    }

    // Remove.bg returns the image directly as binary
    const imageBuffer = await res.buffer();
    const base64Data = imageBuffer.toString("base64");

    console.log("IMAGE: Remove.bg success, uploading to Discord...");

    // Upload to Discord
    const uploadedUrl = await uploadToDiscord(base64Data, "image/png");
    
    if (uploadedUrl) {
      console.log("IMAGE: Remove.bg final URL:", uploadedUrl);
      return uploadedUrl;
    }

    return null;

  } catch (err) {
    console.warn("IMAGE: Remove.bg failed:", err.message);
    return null;
  }
}
