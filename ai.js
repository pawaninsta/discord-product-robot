import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Generates structured whiskey product data.
 * Always returns valid data (never blocks pipeline).
 */
export async function generateProductData({ notes }) {
  console.log("🧠 AI: Starting whiskey product generation");

  const systemPrompt = `
You are a senior whiskey buyer and spirits copywriter.

Your job is to generate HIGH-QUALITY e-commerce product data
for a premium whiskey retailer.

IMPORTANT RULES:
- Return ONLY valid JSON
- Do NOT include markdown
- Do NOT include explanations
- Do NOT include extra keys
- Use realistic whiskey language
- If something is unknown, make a reasonable educated guess

JSON SCHEMA (must match exactly):

{
  "title": string,
  "description": string,
  "nose": string,
  "palate": string,
  "finish": string,
  "abv": string,
  "region": string,
  "country": string,
  "sub_type": string,
  "cask_wood": string,
  "finished": boolean,
  "finish_type": string,
  "store_pick": boolean,
  "cask_strength": boolean,
  "single_barrel": boolean,
  "limited_time_offer": boolean,
  "age_statement": string
}
`;

  const userPrompt = `
Product notes (may be incomplete):

${notes || "No additional notes provided."}

Assume this is a premium whiskey suitable for a specialty retailer.
`;

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    const raw = res.choices?.[0]?.message?.content;

    console.log("🧠 AI RAW OUTPUT:");
    console.log(raw);

    if (!raw) throw new Error("Empty AI response");

    // -------- SAFE JSON EXTRACTION --------
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON object found");

    const parsed = JSON.parse(jsonMatch[0]);

    console.log("🧠 AI PARSED OUTPUT:", parsed);

    return parsed;

  } catch (err) {
    console.error("❌ AI FAILED — using fallback:", err.message);

    return {
      title: "Limited Release Whiskey",
      description:
        "This limited release whiskey offers a balanced and approachable profile with classic oak-forward character, making it ideal for sipping neat or enjoying in refined cocktails.",
      nose: "Vanilla, caramel, toasted oak",
      palate: "Sweet oak, baking spice, brown sugar",
      finish: "Medium-long finish with warming spice and vanilla",
      abv: "50%",
      region: "Kentucky",
      country: "USA",
      sub_type: "Straight Whiskey",
      cask_wood: "American Oak",
      finished: false,
      finish_type: "",
      store_pick: false,
      cask_strength: false,
      single_barrel: false,
      limited_time_offer: true,
      age_statement: "NAS"
    };
  }
}
