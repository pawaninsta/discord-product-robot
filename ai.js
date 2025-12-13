import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Generate structured product data for Shopify
 */
export async function generateProductData({ notes }) {
  console.log("AI STEP: Generating product data");
  console.log("AI INPUT NOTES:", notes);

  const systemPrompt = `
You are a whiskey expert and e-commerce copywriter.

You are generating a Shopify product listing for a whiskey bottle.

RULES:
- You MUST return valid JSON only
- You MUST fill in every field
- Never leave fields empty
- If info is unknown, use safe defaults:
  - age_statement: "NAS"
  - finish_type: "None"
  - awards: ""
- Always generate tasting notes
- Be accurate, not speculative
- Do NOT invent rare finishes or ages
- Use realistic ABV ranges if unknown

Return JSON in this exact format.
`;

  const userPrompt = `
Optional notes from the user (may be empty or incomplete):
${notes || "No additional notes provided"}

Generate a complete whiskey product listing.
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    response_format: { type: "json_object" }
  });

  let data;

  try {
    data = JSON.parse(response.choices[0].message.content);
  } catch (err) {
    console.error("AI JSON PARSE ERROR:", err);
    throw new Error("AI returned invalid JSON");
  }

  // -------------------------
  // HARD VALIDATION
  // -------------------------
  const requiredFields = [
    "title",
    "description",
    "nose",
    "palate",
    "finish",
    "sub_type",
    "country",
    "region",
    "cask_wood",
    "finish_type",
    "age_statement",
    "abv"
  ];

  for (const field of requiredFields) {
    if (!data[field] || String(data[field]).trim() === "") {
      throw new Error(`AI missing required field: ${field}`);
    }
  }

  // -------------------------
  // NORMALIZE BOOLEANS
  // -------------------------
  data.finished = Boolean(data.finished);
  data.store_pick = Boolean(data.store_pick);
  data.cask_strength = Boolean(data.cask_strength);
  data.single_barrel = Boolean(data.single_barrel);
  data.limited_time_offer = Boolean(data.limited_time_offer);

  console.log("AI STEP COMPLETE: Product data generated");
  console.log("AI OUTPUT:", JSON.stringify(data, null, 2));

  return data;
}
