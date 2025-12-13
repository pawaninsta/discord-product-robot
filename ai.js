import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function generateProductData({ notes }) {
  console.log("🧠 AI: Starting product description generation");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000); // 25s hard stop

  try {
    const prompt = `
You are creating a premium whiskey product listing.

Return VALID JSON ONLY with these exact keys:
title
description
nose
palate
finish
abv
region
country

Do not include markdown.
Do not include commentary.
`;

    console.log("🧠 AI: Sending request to OpenAI");

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: notes || "No notes provided" }
      ],
      temperature: 0.7,
      signal: controller.signal
    });

    clearTimeout(timeout);

    const content = res.choices?.[0]?.message?.content;

    console.log("🧠 AI: Raw response received");
    console.log(content);

    if (!content) {
      throw new Error("Empty AI response");
    }

    const parsed = JSON.parse(content);

    console.log("🧠 AI: JSON parsed successfully");

    return parsed;

  } catch (err) {
    console.error("❌ AI generation failed:", err.message);

    // SAFE FALLBACK (never block pipeline)
    return {
      title: "Untitled Whiskey",
      description: "Description could not be generated automatically.",
      nose: "N/A",
      palate: "N/A",
      finish: "N/A",
      abv: "N/A",
      region: "N/A",
      country: "N/A"
    };
  }
}
