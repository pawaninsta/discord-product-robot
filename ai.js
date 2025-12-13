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

Return JSON only in this exact structure (every field required; no null/empty strings; no "N/A"/"Unknown"):
{
  "title": "Brand Product Name",
  "description": "<p>HTML product description suitable for Shopify body_html</p>",
  "brand": "Brand",
  "product_name": "Product Name",
  "sub_type": "Straight Bourbon Whiskey",
  "country": "USA",
  "region": "Kentucky",
  "cask_wood": ["American White Oak"],
  "finish_type": "None",
  "age_statement": "NAS",
  "abv": "46",
  "nose": ["vanilla", "caramel", "oak"],
  "palate": ["toffee", "baking spice", "sweet corn"],
  "finish": ["warm spice", "oak", "lingering sweetness"],
  "awards": "",
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

// Map common description aliases to `description` (Shopify body_html)
if (!data.description) {
  data.description =
    data.body_html ||
    data.description_html ||
    data.product_description ||
    data.body ||
    "";
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

// Map ABV aliases and normalize to a simple numeric string (e.g. "46")
if (!data.abv) {
  data.abv = data.alcohol_by_volume ?? data.alcohol ?? data.abv_percent ?? data.proof ?? "";
}
if (data.abv !== undefined && data.abv !== null) {
  const rawAbv = String(data.abv).trim();
  // Convert proof -> ABV if it looks like proof
  if (/^\d+(\.\d+)?\s*proof$/i.test(rawAbv)) {
    const proofNum = Number(rawAbv.replace(/proof/i, "").trim());
    if (Number.isFinite(proofNum) && proofNum > 0) data.abv = String(proofNum / 2);
  } else {
    const m = rawAbv.match(/(\d+(\.\d+)?)/);
    if (m) data.abv = m[1];
  }
}

// If the model still omitted description, synthesize a safe Shopify HTML description.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toList(value) {
  if (Array.isArray(value)) return value.map(v => String(v ?? "")).map(v => v.trim()).filter(Boolean);
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return [];
    // Try split on commas/semicolons/newlines
    const parts = s.split(/[,;\n]/g).map(v => v.trim()).filter(Boolean);
    return parts.length ? parts : [s];
  }
  return [];
}

function renderList(items) {
  if (!items?.length) return "";
  return `<ul>${items.map(i => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
}

function buildDescription(d) {
  const title = escapeHtml(d.title || `${d.brand || ""} ${d.product_name || ""}`.trim() || "Whiskey");
  const subType = escapeHtml(d.sub_type || "Whiskey");
  const country = escapeHtml(d.country || "Other");
  const region = escapeHtml(d.region || "");
  const age = escapeHtml(d.age_statement || "NAS");
  const abv = escapeHtml(d.abv || "");

  const cask = toList(d.cask_wood);
  const caskText = cask.length ? escapeHtml(cask.join(", ")) : "";
  const finishType = escapeHtml(d.finish_type || "None");

  const nose = toList(d.nose);
  const palate = toList(d.palate);
  const finish = toList(d.finish);

  const origin = region ? `${country} (${region})` : country;
  const details = [
    subType && `Style: ${subType}`,
    origin && `Origin: ${origin}`,
    age && `Age: ${age}`,
    abv && `ABV: ${abv}%`,
    caskText && `Cask: ${caskText}`,
    finishType && `Finish: ${finishType}`
  ].filter(Boolean);

  const detailsHtml = details.length ? `<ul>${details.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : "";
  const noseHtml = nose.length ? `<p><strong>Nose</strong></p>${renderList(nose)}` : "";
  const palateHtml = palate.length ? `<p><strong>Palate</strong></p>${renderList(palate)}` : "";
  const finishHtml = finish.length ? `<p><strong>Finish</strong></p>${renderList(finish)}` : "";

  const intro = `<p><strong>${title}</strong> is a ${escapeHtml(d.sub_type || "whiskey")} crafted for an approachable, well-balanced pour.</p>`;
  const out = `${intro}${detailsHtml}${noseHtml}${palateHtml}${finishHtml}`.trim();
  return out || `<p><strong>${title}</strong></p>`;
}

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

  // Ensure required `description` exists (prefer model output, otherwise synthesize)
  if (isBad(data.description)) {
    data.description = buildDescription(data);
  }

  // Last-resort ABV default if the model omitted it completely
  if (isBad(data.abv)) {
    console.warn('Missing/invalid "abv" from AI, defaulting to 45');
    data.abv = "45";
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
