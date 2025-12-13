import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Generate structured product data for Shopify
 * Uses IMAGE + NOTES (Vision enabled)
 */
export async function generateProductData({ notes, imageUrl }) {
  console.log("AI STEP: Generating product data (with vision)");
  console.log("AI INPUT NOTES:", notes);
  console.log("AI IMAGE URL:", imageUrl);

  if (!imageUrl) {
    throw new Error("generateProductData requires imageUrl");
  }

  const systemPrompt = `
You are a whiskey expert and e-commerce copywriter.

You are generating a Shopify product listing for a whiskey bottle.

You can SEE the bottle image and must read the label text.

RULES:
- You MUST return valid JSON only
- You MUST fill in every field
- Never leave fields empty
- If information is unknown or unclear, use safe defaults:
  - age_statement: "NAS"
  - finish_type: "None"
  - awards: ""
- Always generate realistic tasting notes
- Do NOT invent rare finishes, ages, or mash bills
- Use realistic ABV ranges if not clearly stated on the label
- Prefer what is visible on the label over assumptions

Return JSON in this exact structure.
`;

  const userPrompt = `
Optional notes from the user (may be empty or incomplete):
${notes || "No additional notes provided"}

TASK:
1. Read the bottle label from the image
2. Identify the brand and product name
3. Generate a complete whiskey product listing suitable for Shopify
`;

  let response;

  try {
    response = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            {
              type: "image_url",
              image_url: {
                url: imageUrl
              }
            }
          ]
        }
      ],
      response_format: { type: "json_object" }
    });
  } catch (err) {
    console.error("OPENAI API ERROR:", err);
    throw new Error("OpenAI request failed");
  }

  const raw = response?.choices?.[0]?.message?.content;

  console.log("AI RAW RESPONSE:");
  console.log(raw);

  if (!raw) {
    throw new Error("AI returned empty response");
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error("AI JSON PARSE ERROR:", err);
    console.error("RAW STRING:", raw);
    throw new Error("AI returned invalid JSON");
  }

  // -------------------------
  // HARD VALIDATION
  // -------------------------
  function isBad(value) {
    return (
      value === null ||
      value === undefined ||
      value === "" ||
      value === "N/A" ||
      value === "Unknown"
    );
  }

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
    if (isBad(data[field])) {
      console.error("AI VALIDATION FAILED:", field, data[field]);
      throw new Error(`AI missing or invalid field: ${field}`);
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
