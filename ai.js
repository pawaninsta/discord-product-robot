import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function generateProductData({ notes }) {
  const prompt = `
You are creating a premium whiskey product listing.

Return JSON ONLY with:
title
description
nose
palate
finish
abv
region
country
`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: notes || "No notes provided" }
    ]
  });

  return JSON.parse(res.choices[0].message.content);
}
