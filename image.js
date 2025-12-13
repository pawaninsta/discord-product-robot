import fetch from "node-fetch";

export async function generateStudioImage(imageUrl) {
  const res = await fetch("https://api.nanobanana.ai/generate", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.NANOBANANA_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      image: imageUrl,
      style: "studio_product_white_background"
    })
  });

  const data = await res.json();
  return data.output_image_url;
}
