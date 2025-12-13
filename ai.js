import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Generate structured product data for Shopify
 * Uses IMAGE + NOTES + optional web research (Vision enabled)
 */
export async function generateProductData({ notes, imageUrl, webResearch }) {
  console.log("AI STEP: Generating product data (with vision)");
  console.log("AI INPUT NOTES:", notes);
  console.log("AI IMAGE URL:", imageUrl);
  console.log("AI WEB RESEARCH:", webResearch ? "Available" : "None");

  if (!imageUrl) {
    throw new Error("generateProductData requires imageUrl");
  }

  const systemPrompt = `
You are a whiskey expert and e-commerce copywriter for The Whiskey Library.

You are generating a Shopify product listing for a spirit bottle.

You can SEE the bottle image and must READ THE LABEL CAREFULLY to extract ALL information.

## CRITICAL: READ THE LABEL THOROUGHLY

Look for and extract:
- Brand name (this becomes the "vendor")
- Product name / Expression name
- Age statement (look for "X Years Old", "Aged X Years", etc.)
- ABV / Proof (convert proof to ABV: proof ÷ 2 = ABV%)
- Batch number / Barrel number
- Bottled-in-Bond designation
- Single Barrel designation
- Cask Strength / Barrel Proof designation
- Special finishes mentioned
- Distillery location / state / country
- Volume (750ml, 1L, etc.)
- Any awards or accolades shown

## RULES:
- You MUST return valid JSON only
- You MUST fill in every field
- Extract brand name separately - this is the VENDOR field
- If age is not stated, use "NAS" (No Age Statement)
- If ABV is shown as proof, convert it (proof ÷ 2)
- Be accurate - don't guess ages or batch numbers
- Use web research data if provided to fill gaps

## PRODUCT TYPES (pick one):
American Whiskey, Scotch Whisky, Irish Whiskey, Japanese Whisky, World Whiskey, Rum, Brandy, Tequila, Cognac, Mezcal, Liqueur, Other

## SUB-TYPES by category:

**American Whiskey:** Bourbon, Straight Bourbon, Rye, Straight Rye, American Single Malt, Wheat Whiskey, Corn Whiskey, Tennessee Whiskey, Blended American, Other
**Scotch Whisky:** Single Malt, Blended Malt, Blended Scotch, Single Grain, Blended Grain
**Irish Whiskey:** Single Pot Still, Single Malt, Single Grain, Blended
**Japanese Whisky:** Single Malt, Blended, Grain
**Rum:** Agricole, Jamaican, Demerara, Spanish-style, Overproof, Spiced
**Cognac:** VS, VSOP, XO, XXO, Hors d'Âge
**Tequila:** Blanco, Reposado, Añejo, Extra Añejo

## COUNTRIES (pick one):
USA, Scotland, Ireland, Japan, Canada, Taiwan, India, England, Wales, France, Mexico, Australia, Other

## US STATES (if USA):
Kentucky, Tennessee, Texas, New York, Colorado, Indiana, California, Oregon, Washington, Pennsylvania, Virginia, South Carolina, Other

## CASK WOOD OPTIONS (can be multiple):
American White Oak, European Oak, French Oak, Ex-Bourbon Barrels, Sherry Casks, Pedro Ximénez, Oloroso, Rum Casks, Wine Cask, Port Cask, Madeira Casks, Cognac Casks, Beer Cask, Mizunara Oak, Amburana Cask, Other

## FINISH TYPES (if secondary finish):
None, Sherry, Port, Madeira, Wine, Rum, Cognac, Beer/Stout, Maple, Honey, Other

## TASTING NOTE VOCABULARY:
vanilla, caramel, toffee, honey, brown sugar, chocolate, cocoa, coffee, dried fruit, raisin, date, fig, red fruit, stone fruit, orchard fruit, citrus, tropical, malt, biscuit, nutty, almond, hazelnut, peanut, baking spice, cinnamon, clove, nutmeg, pepper, herbal, floral, oak, cedar, tobacco, leather, smoke, peat, maritime, brine, earthy, mint, eucalyptus, corn, grain, cherry, apple, pear, banana, coconut, butterscotch

Return JSON in this EXACT structure:
{
  "vendor": "Brand/Distillery Name",
  "title": "Full Product Name with Age if applicable",
  "description": "A compelling 2-3 sentence product description",
  "product_type": "American Whiskey",
  "sub_type": "Straight Bourbon",
  "nose": ["vanilla", "caramel", "oak"],
  "palate": ["honey", "spice", "dried fruit"],
  "finish": ["long", "warm", "oak"],
  "country": "USA",
  "region": "Kentucky",
  "cask_wood": ["American White Oak"],
  "finish_type": "None",
  "age_statement": "NAS or X Years",
  "abv": "45%",
  "batch_number": "Batch 123 or empty string if none",
  "barrel_number": "Barrel 456 or empty string if none",
  "volume_ml": 750,
  "finished": false,
  "store_pick": false,
  "cask_strength": false,
  "single_barrel": false,
  "bottled_in_bond": false,
  "limited_time_offer": false
}
`;

  let webContext = "";
  if (webResearch?.summary) {
    webContext = `

## WEB RESEARCH (use to supplement label info):
${webResearch.summary}
`;
  }

  const userPrompt = `
Optional notes from the user (may be empty or incomplete):
${notes || "No additional notes provided"}
${webContext}

TASK:
1. CAREFULLY read ALL text on the bottle label
2. Extract brand name, product name, age, ABV, batch/barrel numbers
3. Look for special designations (Single Barrel, Cask Strength, Bottled-in-Bond)
4. Generate complete product listing with accurate extracted information
5. Use web research data if provided to fill in gaps
`;

  let response;

  try {
    response = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.3, // Lower temperature for more accurate extraction
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
                url: imageUrl,
                detail: "high" // High detail for better label reading
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
    if (data.vendor && data.product_name) {
      data.title = `${data.vendor} ${data.product_name}`;
    } else if (data.product_name) {
      data.title = data.product_name;
    }
  }

  // Ensure vendor is set
  if (!data.vendor) {
    // Try to extract from title
    const titleParts = data.title?.split(" ") || [];
    data.vendor = titleParts[0] || "Unknown";
  }

  // Build description if missing
  if (!data.description && data.title) {
    data.description = `Discover ${data.title}. A premium spirit crafted with care.`;
  }

  // Flatten tasting notes if nested
  if (data.tasting_notes) {
    data.nose = data.nose || data.tasting_notes.nose;
    data.palate = data.palate || data.tasting_notes.palate;
    data.finish = data.finish || data.tasting_notes.finish;
  }

  // Defaults for missing structured fields
  data.product_type = data.product_type || "American Whiskey";
  data.sub_type = data.sub_type || "Bourbon";
  data.country = data.country || "USA";
  data.region = data.region || "Kentucky";
  data.cask_wood = data.cask_wood || ["American White Oak"];
  data.finish_type = data.finish_type || "None";
  data.age_statement = data.age_statement || "NAS";
  data.batch_number = data.batch_number || "";
  data.barrel_number = data.barrel_number || "";
  data.volume_ml = data.volume_ml || 750;

  // Valid choices for Shopify metafields (must match exactly)
  const VALID_CASK_WOODS = [
    "American White Oak", "European Oak", "French Oak", "Ex-Bourbon Barrels",
    "Sherry Casks", "Pedro Ximénez", "Oloroso", "Rum Casks",
    "Wine Cask", "Port Cask", "Madeira Casks", "Cognac Casks",
    "Beer Cask", "Mizunara Oak", "Amburana Cask", "Other"
  ];

  const VALID_COUNTRIES = [
    "USA", "Scotland", "Ireland", "Japan", "Canada", "Taiwan", "India",
    "England", "Wales", "France", "Mexico", "Australia", "Other"
  ];

  // Normalize cask_wood to valid choices
  if (data.cask_wood) {
    const caskWoods = Array.isArray(data.cask_wood) ? data.cask_wood : [data.cask_wood];
    data.cask_wood = caskWoods.map(cw => {
      if (VALID_CASK_WOODS.includes(cw)) return cw;
      const match = VALID_CASK_WOODS.find(v => v.toLowerCase() === cw.toLowerCase());
      if (match) return match;
      if (cw.toLowerCase().includes("american") && cw.toLowerCase().includes("oak")) return "American White Oak";
      if (cw.toLowerCase().includes("sherry")) return "Sherry Casks";
      if (cw.toLowerCase().includes("bourbon")) return "Ex-Bourbon Barrels";
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
  data.bottled_in_bond = Boolean(data.bottled_in_bond);
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
    "vendor",
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

  console.log("AI STEP COMPLETE: Product data generated");
  console.log("AI OUTPUT:", JSON.stringify(data, null, 2));

  return data;
}
