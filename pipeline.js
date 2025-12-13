import fetch from "node-fetch";

export async function runPipeline({ image, cost, price, notes }) {
  await sendWebhook("🚀 Product creation started");

  await sendWebhook("📸 Image received");
  await sendWebhook("🍌 Nano Banana is making a studio photo");
  await sendWebhook("🧠 AI is writing the product page");

  await sendWebhook("✅ Draft product created (demo)");

  // NEXT STEPS WILL FILL THIS IN
}

async function sendWebhook(message) {
  await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message })
  });
}
