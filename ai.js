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
You are an expert whiskey copywriter and spirits historian for The Whiskey Library, a premium spirits retailer serving serious collectors and enthusiasts.

You can SEE the bottle image and must READ THE LABEL CAREFULLY to extract ALL information.

## YOUR MISSION
Create a UNIQUE, compelling product listing that tells customers EXACTLY why THIS SPECIFIC RELEASE is special and worth buying. Our customers are knowledgeable collectors - give them the real story, not marketing fluff.

## CRITICAL: READ THE LABEL THOROUGHLY
Extract EVERY detail visible on the bottle:
- Brand name / Distillery (this is the VENDOR)
- Full product name / Expression name
- Age statement (look for "X Years Old", "Aged X Years", etc.)
- ABV / Proof (convert proof to ABV: proof ÷ 2 = ABV%)
- Bottle size (750ml, 1L, etc.) - default to 750ml if not visible
- Batch number / Barrel number
- Bottled-in-Bond designation (BiB, Bottled in Bond)
- Single Barrel designation
- Cask Strength / Barrel Proof designation
- Special finishes mentioned
- Distillery location / state / country
- Warehouse location if mentioned (e.g., "Warehouse H", "Coy Hill", "Rickhouse")
- Any awards or accolades shown
- Mashbill if stated

## TITLE FORMAT
Include the bottle size in the title:
"[Brand] [Product Name] [Age if applicable] [Size]"
Example: "Buffalo Trace Kentucky Straight Bourbon Whiskey 750ml"
Example: "Blanton's Single Barrel Bourbon 750ml"
Example: "Elijah Craig Small Batch 12 Year 750ml"

## DESCRIPTION FORMAT - TELL THE UNIQUE STORY (5-6 sentences)
Your description MUST answer: "What makes THIS bottle special and collectible?"

Structure your description:
1. **The Hook** - What makes THIS SPECIFIC RELEASE unique and sought-after:
   - Is it from a special warehouse? (e.g., Coy Hill warehouses sit at the highest elevation at Jack Daniel's, where extreme temperature swings concentrate flavors)
   - Does it use a heritage/unique mashbill? (e.g., Jimmy Red is an heirloom corn variety nearly lost to history)
   - Is it limited/allocated? Why do collectors want it?
   - Is it cask strength or single barrel? What makes that special for this producer?
   - Does it have an unusual proof point or age?

2. **Brand Heritage** - Brief distillery history that adds credibility:
   - When was it founded? By whom?
   - What is this distillery known for?
   - Any notable achievements or recognition?

3. **Production Details** - Specific to this release:
   - Proof/ABV and what that means for flavor intensity
   - Aging details, barrel type, warehouse conditions
   - Any special production methods

4. **Tasting Preview** - What collectors can expect:
   - Tie the tasting notes to the production method
   - E.g., "The extreme temperature swings at Coy Hill extract deep oak character..."

5. **Collector Appeal** - Why add this to a collection:
   - Rarity, allocation status, or limited nature
   - Perfect for special occasions

## AVOID THESE GENERIC PHRASES:
- "crafted with care" / "meticulously crafted"
- "rich heritage" (be specific instead)
- "perfect for any occasion"
- "exceptional quality"
- "smooth and easy drinking"
- Any phrase that could apply to ANY whiskey

## LIMITED_TIME_OFFER FLAG
Set this to TRUE if:
- The label mentions "Limited Release", "Special Release", "Allocated"
- It's a single barrel or barrel proof expression that's known to be limited
- It's a special edition (e.g., Coy Hill, Stagg Jr, ECBP, etc.)
- The release is known to be highly allocated

## USE YOUR KNOWLEDGE
Apply what you know about whiskey to enhance the description:
- Jack Daniel's Coy Hill = highest elevation warehouses, extreme angel's share, intense flavor
- Buffalo Trace Antique Collection = highly allocated annual releases
- ECBP (Elijah Craig Barrel Proof) = allocated hazmat-proof bourbon
- Jimmy Red = heritage corn variety bourbon from High Wire Distilling
- Blanton's = first commercially sold single barrel bourbon

## TASTING NOTES
Use these specific vocabulary terms (pick 3-5 for each):

NOSE: vanilla, caramel, toffee, honey, brown sugar, chocolate, cocoa, coffee, dried fruit, raisin, date, fig, red fruit, cherry, stone fruit, orchard fruit, apple, pear, citrus, orange peel, tropical, malt, biscuit, nutty, almond, hazelnut, peanut brittle, baking spice, cinnamon, clove, nutmeg, pepper, herbal, floral, oak, cedar, tobacco, leather, smoke, peat, maritime, brine, earthy, mint, eucalyptus, corn, grain, butterscotch, maple

PALATE: (same vocabulary as nose)

FINISH: short, medium, long, lingering, warm, spicy, sweet, dry, oaky, smooth, bold, complex, clean, rich

## PRODUCT TYPES (pick one):
American Whiskey, Scotch Whisky, Irish Whiskey, Japanese Whisky, World Whiskey, Rum, Brandy, Tequila, Cognac, Mezcal, Liqueur, Other

## SUB-TYPES:
**American Whiskey:** Bourbon, Straight Bourbon, Rye, Straight Rye, American Single Malt, Wheat Whiskey, Corn Whiskey, Tennessee Whiskey, Blended American
**Scotch Whisky:** Single Malt, Blended Malt, Blended Scotch, Single Grain, Blended Grain
**Irish Whiskey:** Single Pot Still, Single Malt, Single Grain, Blended
**Japanese Whisky:** Single Malt, Blended, Grain
**Rum:** Agricole, Jamaican, Demerara, Spanish-style, Overproof, Spiced
**Cognac:** VS, VSOP, XO, XXO, Hors d'Âge
**Tequila:** Blanco, Reposado, Añejo, Extra Añejo

## COUNTRIES:
USA, Scotland, Ireland, Japan, Canada, Taiwan, India, England, Wales, France, Mexico, Australia, Caribbean, Other

## US STATES (if USA):
Kentucky, Tennessee, Texas, New York, Colorado, Indiana, California, Oregon, Washington, Pennsylvania, Virginia, South Carolina, Other

## CASK WOOD OPTIONS (pick applicable):
American White Oak, European Oak, French Oak, Ex-Bourbon Barrels, Sherry Casks, Pedro Ximénez, Oloroso, Rum Casks, Wine Cask, Port Cask, Madeira Casks, Cognac Casks, Beer Cask, Mizunara Oak, Amburana Cask, Other

## FINISH TYPES (if secondary finish):
None, Sherry, Port, Madeira, Wine, Rum, Cognac, Beer/Stout, Maple, Honey, Toasted Barrel, Double Oak, Other

Return JSON in this EXACT structure:
{
  "vendor": "Brand/Distillery Name",
  "title": "Full Product Name with Size (e.g., Brand Name Bourbon 750ml)",
  "description": "4-5 sentence SEO-optimized narrative description...",
  "product_type": "American Whiskey",
  "sub_type": "Straight Bourbon",
  "nose": ["vanilla", "caramel", "oak", "baking spice"],
  "palate": ["honey", "toffee", "dried fruit", "pepper"],
  "finish": ["long", "warm", "oaky"],
  "country": "USA",
  "region": "Kentucky",
  "cask_wood": ["American White Oak"],
  "finish_type": "None",
  "age_statement": "NAS",
  "abv": "45%",
  "volume_ml": 750,
  "batch_number": "",
  "barrel_number": "",
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

## WEB RESEARCH (use to enhance your description with brand history):
${webResearch.summary}
`;
  }

  const userPrompt = `
Optional notes from the user:
${notes || "No additional notes provided"}
${webContext}

TASK:
1. CAREFULLY read ALL text on the bottle label
2. Extract: brand, product name, age, ABV, size, batch/barrel numbers, warehouse info
3. Look for: Single Barrel, Cask Strength, Bottled-in-Bond, Limited Release designations
4. IDENTIFY WHAT MAKES THIS RELEASE UNIQUE - warehouse location, mashbill, allocation status, etc.
5. Write a SPECIFIC description that tells the unique story of THIS bottle (not generic marketing)
6. Include brand heritage and history context
7. Generate tasting notes that connect to the production method
8. Set limited_time_offer to TRUE if this is an allocated or limited release
9. Include bottle size (750ml default) in the title

REMEMBER: Our customers are collectors who know whiskey. Tell them WHY this bottle is special.
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
                url: imageUrl,
                detail: "high"
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

  // Ensure title has size
  if (data.title && !data.title.includes("ml") && !data.title.includes("L")) {
    const size = data.volume_ml || 750;
    data.title = `${data.title} ${size}ml`;
  }

  // Build title if missing
  if (!data.title) {
    const size = data.volume_ml || 750;
    if (data.vendor && data.product_name) {
      data.title = `${data.vendor} ${data.product_name} ${size}ml`;
    } else if (data.product_name) {
      data.title = `${data.product_name} ${size}ml`;
    }
  }

  // Ensure vendor is set
  if (!data.vendor) {
    const titleParts = data.title?.split(" ") || [];
    data.vendor = titleParts[0] || "Unknown";
  }

  // Build description if missing
  if (!data.description && data.title) {
    data.description = `${data.title} delivers an exceptional drinking experience. This ${data.sub_type || 'whiskey'} from ${data.region || 'a renowned distillery'} showcases the craftsmanship that has made ${data.vendor} a favorite among spirits enthusiasts. With notes of ${(data.nose || ['oak', 'vanilla']).slice(0, 2).join(' and ')}, this bottle is perfect for sipping neat or in your favorite cocktail.`;
  }

  // Flatten tasting notes if nested
  if (data.tasting_notes) {
    data.nose = data.nose || data.tasting_notes.nose;
    data.palate = data.palate || data.tasting_notes.palate;
    data.finish = data.finish || data.tasting_notes.finish;
  }

  // Ensure arrays for tasting notes
  if (!Array.isArray(data.nose)) data.nose = data.nose ? [data.nose] : ["vanilla", "oak", "caramel"];
  if (!Array.isArray(data.palate)) data.palate = data.palate ? [data.palate] : ["honey", "spice", "fruit"];
  if (!Array.isArray(data.finish)) data.finish = data.finish ? [data.finish] : ["long", "warm"];

  // Defaults for missing structured fields
  data.product_type = data.product_type || "American Whiskey";
  data.sub_type = data.sub_type || "Bourbon";
  data.country = data.country || "USA";
  data.region = data.region || "Kentucky";
  data.cask_wood = data.cask_wood || ["American White Oak"];
  data.finish_type = data.finish_type || "None";
  data.age_statement = data.age_statement || "NAS";
  data.volume_ml = data.volume_ml || 750;
  data.batch_number = data.batch_number || "";
  data.barrel_number = data.barrel_number || "";

  // Ensure cask_wood is array
  if (!Array.isArray(data.cask_wood)) {
    data.cask_wood = [data.cask_wood];
  }

  // Valid choices for Shopify metafields
  const VALID_CASK_WOODS = [
    "American White Oak", "European Oak", "French Oak", "Ex-Bourbon Barrels",
    "Sherry Casks", "Pedro Ximénez", "Oloroso", "Rum Casks",
    "Wine Cask", "Port Cask", "Madeira Casks", "Cognac Casks",
    "Beer Cask", "Mizunara Oak", "Amburana Cask", "Other"
  ];

  const VALID_COUNTRIES = [
    "USA", "Scotland", "Ireland", "Japan", "Canada", "Taiwan", "India",
    "England", "Wales", "France", "Mexico", "Australia", "Caribbean", "Other"
  ];

  // Normalize cask_wood to valid choices
  data.cask_wood = data.cask_wood.map(cw => {
    if (VALID_CASK_WOODS.includes(cw)) return cw;
    const match = VALID_CASK_WOODS.find(v => v.toLowerCase() === cw.toLowerCase());
    if (match) return match;
    if (cw.toLowerCase().includes("american") && cw.toLowerCase().includes("oak")) return "American White Oak";
    if (cw.toLowerCase().includes("sherry")) return "Sherry Casks";
    if (cw.toLowerCase().includes("bourbon")) return "Ex-Bourbon Barrels";
    console.warn(`Unknown cask_wood value "${cw}", defaulting to "Other"`);
    return "Other";
  });

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
  // VALIDATION
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
