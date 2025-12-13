import fetch from "node-fetch";

/**
 * Generate a professional studio product shot
 * - Removes background
 * - Front-facing bottle
 * - Pure white background
 * - Professional lighting
 */
export async function generateStudioImage(imageUrl) {
  console.log("IMAGE: Generating studio product shot");
  console.log("IMAGE: Input URL:", imageUrl);

  // Try Nano Banana API first
  const nanoBananaResult = await tryNanoBanana(imageUrl);
  if (nanoBananaResult) {
    return nanoBananaResult;
  }

  // Try Remove.bg as fallback for background removal
  const removeBgResult = await tryRemoveBg(imageUrl);
  if (removeBgResult) {
    return removeBgResult;
  }

  // Return original if all services fail
  console.log("IMAGE: All services failed, using original image");
  return imageUrl;
}

/**
 * Nano Banana API - Studio product shots
 */
async function tryNanoBanana(imageUrl) {
  if (!process.env.NANOBANANA_API_KEY) {
    console.log("IMAGE: Nano Banana API key not configured");
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch("https://api.nanobanana.ai/generate", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.NANOBANANA_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        image: imageUrl,
        style: "studio_product_white_background",
        prompt: "Professional e-commerce product photo of a liquor bottle. Front-facing view. Pure white background. Soft studio lighting. No shadows. Clean and minimal. High resolution product photography.",
        negative_prompt: "blurry, distorted, low quality, watermark, text overlay, background objects, shadows, reflections",
        remove_background: true,
        white_background: true
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    const data = await res.json();
    console.log("IMAGE: Nano Banana response:", JSON.stringify(data));

    if (data?.output_image_url) {
      console.log("IMAGE: Nano Banana success");
      return data.output_image_url;
    }

    if (data?.image_url) {
      console.log("IMAGE: Nano Banana success (alt field)");
      return data.image_url;
    }

    console.log("IMAGE: Nano Banana returned no image URL");
    return null;

  } catch (err) {
    console.warn("IMAGE: Nano Banana failed:", err.message);
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const formData = new URLSearchParams();
    formData.append("image_url", imageUrl);
    formData.append("size", "auto");
    formData.append("bg_color", "white");

    const res = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: {
        "X-Api-Key": process.env.REMOVEBG_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: formData.toString(),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (res.ok) {
      // Remove.bg returns image data, we'd need to upload it somewhere
      // For now, just log that it worked
      console.log("IMAGE: Remove.bg success - but needs image hosting");
      // In a real implementation, you'd upload the result to your CDN
    }

    return null;

  } catch (err) {
    console.warn("IMAGE: Remove.bg failed:", err.message);
    return null;
  }
}
