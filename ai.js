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

IMPORTANT: For cask_wood, you MUST use ONLY these exact values (can be an array for multiple):
["American White Oak", "European Oak", "French Oak", "Ex-Bourbon Barrels", "Sherry Casks", "Pedro Ximénez", "Fino / Amontillado", "Rum Casks", "Wine Cask", "Port Cask", "Madeira Casks", "Cognac or Brandy Casks", "Beer Cask", "Mizunara Oak", "Amburana Cask", "Chinquapin Oak", "Other"]

IMPORTANT: For country, you MUST use ONLY these exact values:
["USA", "Ireland", "Scotland", "Canada", "Japan", "India", "Taiwan", "England", "France", "Mexico", "Italy", "Portugal", "Other"]

Return JSON in this EXACT structure:
{
  "title": "Brand Name Product Name",
  "description": "A compelling 2-3 sentence product description for Shopify",
  "nose": ["aroma note 1", "aroma note 2", "aroma note 3"],
  "palate": ["taste note 1", "taste note 2", "taste note 3"],
  "finish": ["finish note 1", "finish note 2"],
  "sub_type": "Straight Bourbon Whiskey",
  "country": "USA",
  "region": "Kentucky",
  "cask_wood": ["American White Oak"],
  "finish_type": "None",
  "age_statement": "4 Years" or "NAS",
  "abv": "45%",
  "finished": false,
  "store_pick": false,
  "cask_strength": false,
  "single_barrel": false,
  "limited_time_offer": false
}
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
// NORMALIZE AI SCHEMA
// -------------------------

// Build title if missing
if (!data.title) {
  if (data.brand && data.product_name) {
    data.title = `${data.brand} ${data.product_name}`;
  } else if (data.product_name) {
    data.title = data.product_name;
  }
}

// Build description if missing
if (!data.description && data.title) {
  data.description = `Discover ${data.title}. A premium whiskey crafted with care.`;
}

// Flatten tasting notes if nested
if (data.tasting_notes) {
  data.nose = data.nose || data.tasting_notes.nose;
  data.palate = data.palate || data.tasting_notes.palate;
  data.finish = data.finish || data.tasting_notes.finish;
}

// Defaults for missing structured fields
data.sub_type = data.sub_type || "Straight Bourbon Whiskey";
data.country = data.country || "USA";
data.region = data.region || "Kentucky";
data.cask_wood = data.cask_wood || "American White Oak";
data.finish_type = data.finish_type || "None";
data.age_statement = data.age_statement || "NAS";

// Valid choices for Shopify metafields (must match exactly)
const VALID_CASK_WOODS = [
  "American White Oak", "European Oak", "French Oak", "Ex-Bourbon Barrels",
  "Sherry Casks", "Pedro Ximénez", "Fino / Amontillado", "Rum Casks",
  "Wine Cask", "Port Cask", "Madeira Casks", "Cognac or Brandy Casks",
  "Beer Cask", "Mizunara Oak", "Amburana Cask", "Chinquapin Oak", "Other"
];

const VALID_COUNTRIES = [
  "USA", "Ireland", "Scotland", "Canada", "Japan", "India",
  "Taiwan", "England", "France", "Mexico", "Italy", "Portugal", "Other"
];

// Normalize cask_wood to valid choices
if (data.cask_wood) {
  const caskWoods = Array.isArray(data.cask_wood) ? data.cask_wood : [data.cask_wood];
  data.cask_wood = caskWoods.map(cw => {
    // Try exact match first
    if (VALID_CASK_WOODS.includes(cw)) return cw;
    // Try case-insensitive match
    const match = VALID_CASK_WOODS.find(v => v.toLowerCase() === cw.toLowerCase());
    if (match) return match;
    // Common mappings
    if (cw.toLowerCase().includes("american") && cw.toLowerCase().includes("oak")) return "American White Oak";
    if (cw.toLowerCase().includes("sherry")) return "Sherry Casks";
    if (cw.toLowerCase().includes("bourbon")) return "Ex-Bourbon Barrels";
    // Default to Other if no match
    console.warn(`Unknown cask_wood value "${cw}", defaulting to "Other"`);
    return "Other";
  });
}

// Normalize country to valid choice
if (data.country) {
  const country = String(data.country);
  if (!VALID_COUNTRIES.includes(country)) {
    const match = VALID_COUNTRIES.find(v => v.toLowerCase() === country.toLowerCase());
    if (match) {
      data.country = match;
    } else {
      console.warn(`Unknown country value "${country}", defaulting to "Other"`);
      data.country = "Other";
    }
  }
}

// Boolean defaults
data.finished = Boolean(data.finished);
data.store_pick = Boolean(data.store_pick);
data.cask_strength = Boolean(data.cask_strength);
data.single_barrel = Boolean(data.single_barrel);
data.limited_time_offer = Boolean(data.limited_time_offer);

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
