import fetch from "node-fetch";

export async function generateStudioImage(imageUrl) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000); // 20 sec timeout

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

    const data = await res.json();

    // If Nano Banana gives us an image, use it
    if (data?.output_image_url) {
      return data.output_image_url;
    }

    // Fallback if response format is different
    return imageUrl;

  } catch (err) {
    console.warn("Nano Banana failed, using original image");
    return imageUrl;
  }
}
