import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Character limits for tasting card sections (calibrated to actual layout)
// Note: AI targets slightly lower to avoid truncation
const DESCRIPTION_LIMITS = { min: 300, max: 400, target: 380 };  // ~6-7 lines at 26px font
const TASTING_NOTE_LIMITS = { min: 50, max: 100, target: 90 };  // ~4 lines at 24px font

/**
 * Condense a product description for use on a tasting card.
 * Only condenses if text exceeds max limit. Targets max to fill available space.
 */
export async function condenseTastingCardDescription({ title, description }) {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/5a136f99-0f58-49f0-8eb8-c368792b2230',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ai.js:condenseTastingCardDescription',message:'Entry',data:{descLen:description?.length||0,maxLimit:DESCRIPTION_LIMITS.max,willCondense:(description?.length||0)>DESCRIPTION_LIMITS.max},hypothesisId:'H2',timestamp:Date.now(),sessionId:'debug-session'})}).catch(()=>{});
  // #endregion
  if (!description || description.trim().length === 0) {
    return "";
  }

  // If already fits within max, return as-is (no API call needed)
  if (description.length <= DESCRIPTION_LIMITS.max) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/5a136f99-0f58-49f0-8eb8-c368792b2230',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ai.js:condenseTastingCardDescription',message:'Skipping - already fits',data:{descLen:description.length},hypothesisId:'H2',timestamp:Date.now(),sessionId:'debug-session'})}).catch(()=>{});
    // #endregion
    return description;
  }

  const systemPrompt = `
You are a whiskey copywriter condensing product descriptions for tasting cards.
The tasting card has space for approximately ${DESCRIPTION_LIMITS.target} characters (about 6 lines).

Rules:
- Target approximately ${DESCRIPTION_LIMITS.target} characters (HARD MAX: ${DESCRIPTION_LIMITS.max})
- Write 4-5 COMPLETE sentences that tell the core story
- MUST end with a complete sentence - no trailing ellipsis or cut-off words
- Keep the most compelling hook/unique selling point
- Mention what makes this bottle special (age, proof, barrel selection, etc.)
- Remove redundant marketing fluff
- Maintain the direct, Ogilvy-inspired tone
- Do NOT include tasting notes (those appear separately on the card)
- CRITICAL: End on a complete sentence. Never cut off mid-thought.

Return ONLY the condensed description text, no JSON or formatting.
`;

  const userPrompt = `
Product: ${title}

Original description:
${description}

Condense this to approximately ${DESCRIPTION_LIMITS.max} characters (4-5 sentences) for a tasting card:
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 250,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    const condensed = response?.choices?.[0]?.message?.content?.trim();
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/5a136f99-0f58-49f0-8eb8-c368792b2230',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ai.js:condenseTastingCardDescription',message:'AI returned',data:{condensedLen:condensed?.length||0,maxLimit:DESCRIPTION_LIMITS.max,overLimit:(condensed?.length||0)>DESCRIPTION_LIMITS.max},hypothesisId:'H2',timestamp:Date.now(),sessionId:'debug-session'})}).catch(()=>{});
    // #endregion
    
    if (!condensed) {
      // Fallback: truncate original
      return description.slice(0, DESCRIPTION_LIMITS.max - 3) + "...";
    }

    // Safety: if AI over-condensed below minimum, use truncation instead
    if (condensed.length < DESCRIPTION_LIMITS.min) {
      return description.slice(0, DESCRIPTION_LIMITS.max - 3) + "...";
    }

    // Safety: if AI EXCEEDED max limit, truncate at sentence boundary
    if (condensed.length > DESCRIPTION_LIMITS.max) {
      console.log("TASTING_CARD_DEBUG: AI description exceeded max, truncating at sentence boundary");
      // Find last sentence end within limit
      const truncated = condensed.slice(0, DESCRIPTION_LIMITS.max);
      const lastPeriod = truncated.lastIndexOf(". ");
      if (lastPeriod > DESCRIPTION_LIMITS.max * 0.7) {
        return truncated.slice(0, lastPeriod + 1);  // Include the period
      }
      // Fallback: cut at word boundary
      const lastSpace = truncated.lastIndexOf(" ");
      if (lastSpace > DESCRIPTION_LIMITS.max * 0.7) {
        return truncated.slice(0, lastSpace);
      }
      return truncated;
    }

    return condensed;
  } catch (err) {
    console.error("condenseTastingCardDescription error:", err);
    // Fallback: truncate original
    return description.slice(0, DESCRIPTION_LIMITS.max - 3) + "...";
  }
}

/**
 * Condense a tasting note (nose/palate/finish) for use on a tasting card.
 * Only condenses if text exceeds max limit. Targets max to fill available space.
 */
export async function condenseTastingNote({ noteType, noteText }) {
  if (!noteText || noteText.trim().length === 0) {
    return "";
  }

  // If already fits within max, return as-is (no API call needed)
  if (noteText.length <= TASTING_NOTE_LIMITS.max) {
    return noteText;
  }

  const systemPrompt = `
You are condensing tasting notes for a whiskey tasting card.
The card has space for approximately ${TASTING_NOTE_LIMITS.target} characters per tasting note (about 4 lines).

Rules:
- Target approximately ${TASTING_NOTE_LIMITS.target} characters (HARD MAX: ${TASTING_NOTE_LIMITS.max})
- Keep the most distinctive and evocative flavor descriptors
- Maintain descriptive prose style (not just a list)
- MUST end with complete content - no trailing ellipsis or cut-off words
- CRITICAL: End on a complete phrase. Never cut off mid-thought.

Return ONLY the condensed tasting note text, no labels or formatting.
`;

  const userPrompt = `
${noteType.toUpperCase()} note to condense:
${noteText}

Condense to approximately ${TASTING_NOTE_LIMITS.max} characters:
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 80,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    const condensed = response?.choices?.[0]?.message?.content?.trim();
    
    if (!condensed) {
      // Fallback: truncate original
      return noteText.slice(0, TASTING_NOTE_LIMITS.max - 3) + "...";
    }

    // Safety: if AI over-condensed below minimum, use truncation instead
    if (condensed.length < TASTING_NOTE_LIMITS.min) {
      return noteText.slice(0, TASTING_NOTE_LIMITS.max - 3) + "...";
    }

    return condensed;
  } catch (err) {
    console.error("condenseTastingNote error:", err);
    // Fallback: truncate original
    return noteText.slice(0, TASTING_NOTE_LIMITS.max - 3) + "...";
  }
}

/**
 * Extract high-signal label facts and flags (ABV/proof, store pick, single barrel).
 * This is intentionally narrow and deterministic vs the full listing generation.
 */
export async function extractLabelSignals({ notes, imageUrl }) {
  if (!imageUrl) throw new Error("extractLabelSignals requires imageUrl");

  const system = `
You are extracting facts from a whiskey bottle label image.
Return ONLY valid JSON.

Rules:
- If ABV/proof is NOT explicitly visible, do not guess. Leave abv="" and proof="" and set needs_abv=true.
- Detect store pick signals: retail logos, stickers, "store pick", "private selection", "@whiskeylibrary", etc.
- Detect single barrel signals: "single barrel", "single cask", barrel selection language.

JSON shape:
{
  "abv": "",
  "proof": "",
  "needs_abv": true,
  "store_pick": false,
  "single_barrel": false,
  "evidence": ["short phrases you read on the label"],
  "confidence": { "abv": 0, "store_pick": 0, "single_barrel": 0 }
}
`;

  const user = `
Notes from user (may include ABV/proof/store pick info):
${notes || ""}
`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: user },
          { type: "image_url", image_url: { url: imageUrl, detail: "high" } }
        ]
      }
    ],
    response_format: { type: "json_object" }
  });

  const raw = resp?.choices?.[0]?.message?.content || "{}";
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }

  return {
    abv: String(data.abv || "").trim(),
    proof: String(data.proof || "").trim(),
    needs_abv: Boolean(data.needs_abv),
    store_pick: Boolean(data.store_pick),
    single_barrel: Boolean(data.single_barrel),
    evidence: Array.isArray(data.evidence) ? data.evidence.map(String).slice(0, 10) : [],
    confidence: {
      abv: Number(data.confidence?.abv || 0),
      store_pick: Number(data.confidence?.store_pick || 0),
      single_barrel: Number(data.confidence?.single_barrel || 0)
    }
  };
}

/**
 * Identify the bottle well enough to run web searches (brand/expression/age/finish).
 * This is intentionally lightweight/deterministic and avoids creative writing.
 */
export async function identifyBottleForSearch({ notes, imageUrl }) {
  if (!imageUrl) throw new Error("identifyBottleForSearch requires imageUrl");

  const system = `
You identify a spirits bottle from an image so we can search the web for accurate specs and tasting notes.
Return ONLY valid JSON.

Rules:
- Read the label carefully. Prefer exact label text.
- If unsure, leave fields blank rather than guessing.
- Make "query" short and search-friendly: include brand + expression + age (if any) + finish (if any) + key designator (single barrel, store pick, batch).

JSON shape:
{
  "vendor": "",
  "product_name": "",
  "age_statement": "",
  "finish_hint": "",
  "key_designators": [],
  "query": "",
  "confidence": 0,
  "evidence": ["short label phrases"]
}
`;

  const user = `
Optional user notes (may include proof/ABV/barrel/batch info):
${notes || ""}
`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: user },
          { type: "image_url", image_url: { url: imageUrl, detail: "high" } }
        ]
      }
    ],
    response_format: { type: "json_object" }
  });

  const raw = resp?.choices?.[0]?.message?.content || "{}";
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }

  const vendor = String(data.vendor || "").trim();
  const product_name = String(data.product_name || "").trim();
  const age_statement = String(data.age_statement || "").trim();
  const finish_hint = String(data.finish_hint || "").trim();
  const key_designators = Array.isArray(data.key_designators)
    ? data.key_designators.map(String).map(s => s.trim()).filter(Boolean).slice(0, 6)
    : [];
  const evidence = Array.isArray(data.evidence) ? data.evidence.map(String).slice(0, 10) : [];

  let query = String(data.query || "").trim();
  if (!query) {
    query = [vendor, product_name, age_statement, finish_hint, key_designators.join(" ")]
      .map(s => String(s || "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return {
    vendor,
    product_name,
    age_statement,
    finish_hint,
    key_designators,
    query,
    confidence: Math.max(0, Math.min(1, Number(data.confidence || 0))),
    evidence
  };
}

/**
 * Generate structured product data for Shopify
 * Uses IMAGE + NOTES + optional web research (Vision enabled)
 */
export async function generateProductData({ notes, imageUrl, webResearch, tastingPriors, tastingMode = "inferred", choicesBlock = "" }) {
  console.log("AI STEP: Generating product data (with vision)");
  console.log("AI INPUT NOTES:", notes);
  console.log("AI IMAGE URL:", imageUrl);
  console.log("AI WEB RESEARCH:", webResearch ? "Available" : "None");
  // tastingMode/tastingPriors are optional and may be undefined
  // (kept out of the loud logs to avoid huge payload spam)

  // #region agent log
  (()=>{const payload={sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H4',location:'ai.js:16',message:'generateProductData entry',data:{hasImageUrl:Boolean(imageUrl),imageUrlHost:(()=>{try{return new URL(imageUrl).host;}catch{return null;}})(),notesLen:(notes||"").length,hasWebResearch:Boolean(webResearch?.summary||webResearch?.tastingNotesSummary||webResearch?.status),webResearchStatus:webResearch?.status||null},timestamp:Date.now()};console.log("AGENT_LOG",JSON.stringify(payload));globalThis.fetch?.('http://127.0.0.1:7242/ingest/5a136f99-0f58-49f0-8eb8-c368792b2230',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).catch(()=>{});})();
  // #endregion

  if (!imageUrl) {
    throw new Error("generateProductData requires imageUrl");
  }

  const systemPrompt = `
You are an expert whiskey copywriter and spirits historian for The Whiskey Library, a premium spirits retailer serving serious collectors and enthusiasts.

You can SEE the bottle image and must READ THE LABEL CAREFULLY to extract ALL information.

## STYLE (CRITICAL)
Write in a direct-response style inspired by David Ogilvy:
- Lead with a concrete, specific hook from the LABEL (single barrel, store pick, age, proof, distillery, bottling details).
- Use specific facts, avoid vague hype.
- Favor short, punchy sentences. Make every sentence earn its place.
- Sell the *reason to believe*: what it is, why it’s special, why buy now.

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

## DESCRIPTION FORMAT (STRICT — short blurb + bullet highlights, ≤700 chars TOTAL)
Return TWO fields:

"short_description":
  One sentence, ≤140 characters, the hook. Plain text (no HTML). Used on tasting cards and listing previews.

"description":
  HTML body in this EXACT structure (≤700 characters total, counting all HTML):

  <p>{2–3 sentence story paragraph. Specific facts from the label and web research only. The hook (warehouse / mashbill / allocation / age / proof) → why it's special → who it's for.}</p>
  <ul>
    <li><strong>Age:</strong> {age_statement, e.g. "11 Years" or "NAS"}</li>
    <li><strong>Proof:</strong> {proof number, e.g. "115 proof" or "—" if unknown}</li>
    <li><strong>Mash Bill:</strong> {short description, e.g. "High-rye bourbon (75% corn / 21% rye / 4% malted barley)" or "—"}</li>
    <li><strong>Finish:</strong> {cask finish if any, e.g. "PX Sherry" or "Traditional oak"}</li>
    <li><strong>Distillery:</strong> {distillery_name + state, e.g. "MGP, Indiana" or vendor + state}</li>
    <li><strong>Allocation:</strong> {"Limited release" if limited_time_offer else "Year-round"}</li>
  </ul>

STRICT RULES:
- Total HTML length ≤ 700 characters. Count whole HTML (tags included).
- The <p> must end on a complete sentence — no ellipses, no cut-offs.
- Every <li> must be present even if a value is unknown ("—"). Keeps layout stable.
- Do NOT add extra paragraphs, headings, links, or images. Only <p> followed by <ul><li>…</li></ul>.
- Avoid generic phrases:
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

## TASTING NOTES - WRITE RICH, EVOCATIVE PROSE
Your tasting notes MUST be specific to this bottle and written as RICH, DESCRIPTIVE PROSE - not simple word lists.

**STYLE GUIDE FOR TASTING NOTES:**
Write each section (nose, palate, finish) as a flowing, evocative sentence that paints a picture. Use:
- Descriptive modifiers: "sweet oak", "honeyed caramel", "gentle rye spice", "creamy toffee"
- Connecting phrases: "with hints of", "layered with", "leading to", "underpinned by"
- Textural descriptors: "creamy", "silky", "velvety", "chewy", "coating"
- Intensity qualifiers: "subtle", "bold", "delicate", "rich", "deep", "light"

**EXAMPLES OF RICH TASTING NOTES:**

NOSE examples:
- "Sweet oak with orange zest, caramel, vanilla, cinnamon and toasted nuts"
- "Honey and vanilla custard, toasted nuts and light oak"
- "Rich butterscotch and dark cherry, underpinned by charred oak and baking spices"
- "Bright citrus zest layered with creamy vanilla, brown sugar, and hints of leather"

PALATE examples:
- "Honeyed caramel and brown sugar, spicy oak, chocolate and leather with hints of dried fruit"
- "Creamy caramel and toffee, gentle rye spice, apple and pepper"
- "Full-bodied with dark chocolate and espresso, transitioning to dried fruits and warm baking spices"
- "Velvety mouthfeel with layers of vanilla custard, toasted pecans, and cinnamon warmth"

FINISH examples:
- "Long, warm oak tannin with lingering spice, toasted oak, dry cocoa and subtle tobacco"
- "Medium with caramel sweetness, light tobacco, lingering rye warmth"
- "Extended and warming, fading slowly with notes of leather, dark chocolate, and sweet pipe tobacco"
- "Clean and satisfying with lasting honey sweetness and gentle oak char"

If WEB RESEARCH tasting-note evidence is provided, you MUST ground the notes in it:
- Prefer notes that appear repeatedly across sources.
- Weave the web-sourced flavors into rich, descriptive prose.
- Avoid adding flavors that are not supported by snippets or label/production facts.
- Do not reuse a generic/template set of notes across bottles.

Anti-anchoring rule:
- The JSON schema below shows empty arrays for nose/palate/finish on purpose. Do NOT leave them empty.
- Populate them with RICH DESCRIPTIVE PHRASES for THIS bottle.

**VOCABULARY to draw from (combine creatively with modifiers):**

FLAVORS: vanilla, caramel, toffee, honey, brown sugar, chocolate, cocoa, coffee, dried fruit, raisin, date, fig, red fruit, cherry, stone fruit, orchard fruit, apple, pear, citrus, orange peel, orange zest, tropical, malt, biscuit, nutty, almond, hazelnut, pecan, peanut brittle, baking spice, cinnamon, clove, nutmeg, allspice, pepper, black pepper, white pepper, herbal, floral, oak, charred oak, toasted oak, cedar, tobacco, pipe tobacco, leather, smoke, peat, maritime, brine, earthy, mint, eucalyptus, corn, grain, butterscotch, maple, dark chocolate, milk chocolate, espresso, molasses, burnt sugar, custard

TEXTURES: creamy, silky, velvety, chewy, coating, oily, rich, thin, full-bodied, medium-bodied, light-bodied

FINISH DESCRIPTORS: short, medium, long, extended, lingering, persistent, warm, warming, spicy, sweet, dry, oaky, smooth, bold, complex, clean, rich, satisfying, fading, tannic

## PRODUCT TYPES (pick one):
American Whiskey, Scotch Whisky, Irish Whiskey, Japanese Whisky, World Whiskey, Rum, Brandy, Tequila, Wine, Liqueur, Other

## SUB-TYPES:
**American Whiskey:** Bourbon, Straight Bourbon, Rye, Straight Rye, American Single Malt, Wheat Whiskey, Corn Whiskey, Tennessee Whiskey, Blended American, Other
**Scotch Whisky:** Single Malt, Blended Malt, Blended Scotch, Single Grain, Blended Grain
**Irish Whiskey:** Single Pot Still, Single Malt, Single Grain, Blended
**Japanese Whisky:** Single Malt, Blended, Grain, Other
**Rum:** Agricole, Jamaican, Demerara, Spanish-style, Overproof, Spiced, Other
**Cognac:** VS, VSOP, XO, XXO, Hors d'Âge
**Tequila:** Blanco, Reposado, Añejo, Extra Añejo

## COUNTRIES (pick one):
USA, Scotland, Ireland, Japan, Canada, Taiwan, India, England, Wales, Israel, Australia, New Zealand, France, Sweden, Germany, Mexico, Caribbean (Rum), Other

## US STATES (if USA):
Kentucky, Tennessee, Texas, New York, Colorado, Indiana, California, Oregon, Washington, Pennsylvania, Virginia, South Carolina, Other

## CASK WOOD OPTIONS (pick applicable):
American White Oak, European Oak, French Oak, Ex-Bourbon Barrels, Sherry Casks, Pedro Ximénez, Oloroso, Rum Casks, Wine Cask, Port Cask, Madeira Casks, Cognac Casks, Beer Cask, Mizunara Oak, Amburana Cask, Other

## FINISH TYPES (if secondary finish):
None, Sherry, Port, Madeira, Wine, Rum, Cognac, Beer/Stout, Maple, Honey, Toasted Barrel, Double Oak, Other

## MASH_BILL CLASSIFICATION (REQUIRED for bourbons, EMPTY for everything else)
Pick exactly ONE token based on label + web research:
- "traditional_bourbon": 70–78% corn, ~10–15% rye, ~10–15% malted barley (e.g. Buffalo Trace, Wild Turkey, Heaven Hill standard mash).
- "high_rye_bourbon":    ≥18% rye in the mashbill (e.g. Bulleit, Four Roses high-rye recipes, Old Grand-Dad, Basil Hayden).
- "wheated_bourbon":     wheat replaces rye as the secondary grain (e.g. Maker's Mark, Weller, Pappy, Larceny, Old Fitzgerald).
- "four_grain":          corn + rye + wheat + malted barley (e.g. Woodford Four Grain, Bardstown Origin).
- "high_corn":           ≥80% corn (heritage corn bourbons such as Jimmy Red, or corn whiskeys).
- "" (empty string):     rye whiskey, scotch, Irish, Japanese, world whiskey, blended whiskey, or any bottle where the bourbon mash bill is not clearly identifiable.

## EVIDENCE RULES FOR BOOLEANS (do NOT set a boolean to true without label or web evidence)
- "single_barrel": only true if the label / web research mentions "Single Barrel", "Single Cask", "Barrel No.", or you can cite a specific barrel number. Otherwise false.
- "store_pick": only true if you see retail logos / stickers / "Store Pick" / "Private Selection" / "@whiskeylibrary" or equivalent. Otherwise false.
- "cask_strength": only true if the label says "Cask Strength" / "Barrel Proof" / "Barrel Strength" OR the ABV is ≥50%. Otherwise false.
- "finished": true ONLY if the bottle has a SECONDARY cask finish (e.g. sherry, port, madeira, rum). If true, "finish_type" MUST contain the actual finish (Sherry/Port/etc.). If false, "finish_type" MUST be the empty array [] — do NOT write "Traditional Oak Aging" or any made-up value.
- "bottled_in_bond": only true if "Bottled in Bond" / "BiB" is on the label.
- "limited_time_offer": true for "Limited Release", "Special Release", "Allocated", or known allocated lines (BTAC, ECBP, Stagg, Coy Hill, etc.).

Set the corresponding "evidence" array to the short label/web phrases that justified each true boolean.

${choicesBlock || "## SHOPIFY ALLOWED CHOICES (unavailable — use conservative defaults)"}

Return JSON in this EXACT structure:
{
  "vendor": "Brand/Distillery Name",
  "title": "Full Product Name with Size (e.g., Brand Name Bourbon 750ml)",
  "short_description": "One-sentence hook ≤140 chars (plain text).",
  "description": "<p>...</p><ul><li>...</li>...</ul>  // ≤700 chars total HTML, exact structure above",
  "product_type": "American Whiskey",
  "sub_type": "Straight Bourbon",
  "nose": ["Rich descriptive phrase 1", "descriptive phrase 2", "phrase 3"],
  "palate": ["Evocative phrase about mouthfeel and flavors", "phrase 2", "phrase 3"],
  "finish": ["Descriptive finish phrase with length and character", "additional notes"],
  "country": "USA",
  "region": "Kentucky",
  "distillery_name": "",
  "cask_wood": ["American White Oak"],
  "finish_type": [],
  "mash_bill": "",
  "age_statement": "NAS",
  "abv": "",
  "needs_abv": false,
  "volume_ml": 750,
  "awards": "",
  "batch_number": "",
  "barrel_number": "",
  "finished": false,
  "gift_pack": false,
  "store_pick": false,
  "cask_strength": false,
  "single_barrel": false,
  "bottled_in_bond": false,
  "limited_time_offer": false,
  "evidence": {
    "single_barrel": [],
    "store_pick": [],
    "cask_strength": [],
    "finished": [],
    "bottled_in_bond": [],
    "limited_time_offer": []
  }
}
`;

  let webContext = "";
  if (webResearch) {
    webContext = `

## WEB RESEARCH (ground facts; do NOT invent)
Query: ${webResearch?.query || ""}
Status: ${webResearch?.status || "unknown"}
${webResearch?.errorMessage ? `Error: ${webResearch.errorMessage}` : ""}

### Brand/spec context
${webResearch?.summary || "None"}

### Tasting-notes evidence (snippets)
${webResearch?.tastingNotesSummary || "None"}

Rules for tasting notes:
- Prefer the tasting-note evidence above. If it mentions flavors, map them into the allowed vocabulary terms.
- If evidence conflicts across sources, choose the most repeated/consistent notes.
- If there is no tasting-note evidence, infer cautiously from label facts (mashbill/finish/age/proof) and keep notes generic-but-accurate.
`;
  }

  let priorsContext = "";
  if (tastingPriors) {
    const p = tastingPriors;
    priorsContext = `

## TASTING PRIORS (use when web evidence is missing)
These are educated defaults based on category/finish/proof/producer patterns. Use them to avoid generic templates.
Nose priors: ${(p?.nose || []).join(", ")}
Palate priors: ${(p?.palate || []).join(", ")}
Finish priors: ${(p?.finish || []).join(", ")}
`;
  }

  const userPrompt = `
Optional notes from the user:
${notes || "No additional notes provided"}
${webContext}
${priorsContext}

TASTING MODE: ${tastingMode}

TASK:
1. CAREFULLY read ALL text on the bottle label
2. Extract: brand, product name, age, ABV, size, batch/barrel numbers, warehouse info
3. Look for: Single Barrel, Cask Strength, Bottled-in-Bond, Limited Release designations
4. Look for: Store Pick / Private Selection indicators (including retail logos or stickers). If present set store_pick=true. If it is a store pick, it is typically also a single barrel: set single_barrel=true unless the label clearly indicates otherwise.
5. If the bottle appears to be in a box or gift presentation, set gift_pack=true (otherwise false).
4. IDENTIFY WHAT MAKES THIS RELEASE UNIQUE - warehouse location, mashbill, allocation status, etc.
5. Write a SPECIFIC description that tells the unique story of THIS bottle (not generic marketing)
6. Include brand heritage and history context
7. Generate tasting notes that connect to the production method AND the web tasting-note evidence (if provided).
   - If TASTING MODE is web_grounded, prioritize the web snippets and choose the most consistent notes across sources.
   - If TASTING MODE is inferred, start from the tasting priors and label facts. Do not reuse a generic bourbon template.
   - If the user notes include tasting descriptors, treat them as high-priority evidence.
8. Set limited_time_offer to TRUE if this is an allocated or limited release
9. Include bottle size (750ml default) in the title

CRITICAL ABV RULE:
- If ABV / proof is NOT explicitly visible on the label AND not present in the notes/web research, DO NOT GUESS.
- Set "abv" to "" and set "needs_abv" to true.

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

  // #region agent log
  (()=>{const payload={sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H5',location:'ai.js:244',message:'AI parsed JSON top-level fields',data:{keys:Object.keys(data||{}).slice(0,40),vendor:data?.vendor||null,product_type:data?.product_type||null,sub_type:data?.sub_type||null,country:data?.country||null,region:data?.region||null,noseIsArray:Array.isArray(data?.nose),palateIsArray:Array.isArray(data?.palate),finishIsArray:Array.isArray(data?.finish),store_pick:data?.store_pick,single_barrel:data?.single_barrel},timestamp:Date.now()};console.log("AGENT_LOG",JSON.stringify(payload));globalThis.fetch?.('http://127.0.0.1:7242/ingest/5a136f99-0f58-49f0-8eb8-c368792b2230',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).catch(()=>{});})();
  // #endregion

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

  // If AI didn't return a vendor, leave it empty rather than guessing
  if (!data.vendor) {
    data.vendor = "";
  }

  // Build description if missing — emit the structured HTML skeleton so downstream consumers
  // never see a free-form fallback.
  if (!data.description && data.title) {
    data.description = buildFallbackDescriptionHtml(data);
  }

  // Short description is new; default to first sentence of the story paragraph (or title)
  if (!data.short_description || typeof data.short_description !== "string") {
    data.short_description = "";
  } else {
    data.short_description = data.short_description.trim().slice(0, 140);
  }
  if (!data.short_description) {
    const firstP = String(data.description || "").match(/<p>([\s\S]*?)<\/p>/i)?.[1] || "";
    data.short_description = stripTagsForShort(firstP).slice(0, 140) || data.title || "";
  }

  // Distillery name new
  data.distillery_name = String(data.distillery_name || "").trim();

  // Mash bill new
  data.mash_bill = String(data.mash_bill || "").trim();

  // Flatten tasting notes if nested
  if (data.tasting_notes) {
    data.nose = data.nose || data.tasting_notes.nose;
    data.palate = data.palate || data.tasting_notes.palate;
    data.finish = data.finish || data.tasting_notes.finish;
  }

  // Ensure arrays for tasting notes
  if (!Array.isArray(data.nose)) data.nose = data.nose ? [data.nose] : [];
  if (!Array.isArray(data.palate)) data.palate = data.palate ? [data.palate] : [];
  if (!Array.isArray(data.finish)) data.finish = data.finish ? [data.finish] : [];

  // If the model under-specifies tasting notes, enrich with priors (prevents generic templates).
  function mergeWithPriors(field, minLen, maxLen) {
    const current = Array.isArray(data[field]) ? data[field].map(v => String(v ?? "").trim()).filter(Boolean) : [];
    const pri = Array.isArray(tastingPriors?.[field]) ? tastingPriors[field].map(v => String(v ?? "").trim()).filter(Boolean) : [];
    const merged = [];
    const seen = new Set();
    for (const v of [...current, ...pri]) {
      if (!v || seen.has(v)) continue;
      seen.add(v);
      merged.push(v);
    }
    // If still short, add very safe category-neutral fillers.
    const fillers = field === "finish" ? ["warm", "medium"] : ["oak", "baking spice"];
    for (const f of fillers) {
      if (merged.length >= minLen) break;
      if (!seen.has(f)) {
        seen.add(f);
        merged.push(f);
      }
    }
    data[field] = merged.slice(0, maxLen);
  }

  mergeWithPriors("nose", 3, 5);
  mergeWithPriors("palate", 3, 5);
  mergeWithPriors("finish", 2, 4);

  // Defaults for missing structured fields
  data.product_type = data.product_type || "American Whiskey";
  data.sub_type = data.sub_type || "Bourbon";
  data.country = data.country || "USA";
  data.region = data.region || "Kentucky";
  data.cask_wood = data.cask_wood || ["American White Oak"];
  // finish_type is now an array (Shopify list.single_line_text_field).
  if (typeof data.finish_type === "string") {
    data.finish_type = data.finish_type.trim() && data.finish_type.trim().toLowerCase() !== "none"
      ? [data.finish_type.trim()]
      : [];
  }
  if (!Array.isArray(data.finish_type)) data.finish_type = [];
  data.age_statement = data.age_statement || "NAS";
  data.volume_ml = data.volume_ml || 750;
  data.awards = data.awards || "";
  data.needs_abv = Boolean(data.needs_abv);
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
  data.gift_pack = Boolean(data.gift_pack);
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
    "title",
    "description",
    "nose",
    "palate",
    "finish",
    "sub_type",
    "country",
    "region",
    "cask_wood",
    "age_statement"
  ];

  for (const field of requiredFields) {
    if (isBad(data[field])) {
      console.error("AI VALIDATION FAILED:", field, data[field]);
      throw new Error(`AI missing or invalid field: ${field}`);
    }
  }

  // Enforce tasting-note completeness (prevents empty arrays after anti-anchoring changes)
  if (!Array.isArray(data.nose) || data.nose.length < 3) {
    console.error("AI VALIDATION FAILED: nose", data.nose);
    throw new Error("AI missing or invalid field: nose");
  }
  if (!Array.isArray(data.palate) || data.palate.length < 3) {
    console.error("AI VALIDATION FAILED: palate", data.palate);
    throw new Error("AI missing or invalid field: palate");
  }
  if (!Array.isArray(data.finish) || data.finish.length < 2) {
    console.error("AI VALIDATION FAILED: finish", data.finish);
    throw new Error("AI missing or invalid field: finish");
  }

  // ABV is allowed to be blank only when the model explicitly signals it couldn't find it.
  if (isBad(data.abv) && !data.needs_abv) {
    console.error("AI VALIDATION FAILED: abv", data.abv);
    throw new Error("AI missing or invalid field: abv");
  }

  // Enforce description length and shape. If oversized, try one tighten-call before truncating.
  data.description = await enforceDescriptionShape(data.description, data);

  console.log("AI STEP COMPLETE: Product data generated");
  console.log("AI OUTPUT:", JSON.stringify(data, null, 2));

  return data;
}

const DESCRIPTION_HTML_MAX = 700;

function stripTagsForShort(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeStructuredHtml(html) {
  if (!html) return false;
  const h = String(html);
  return /<p>[\s\S]*?<\/p>/i.test(h) && /<ul>[\s\S]*?<\/ul>/i.test(h);
}

function buildFallbackDescriptionHtml(data) {
  const proof = (() => {
    const m = String(data.abv || "").match(/(\d+(?:\.\d+)?)/);
    if (!m) return "—";
    const abv = Number(m[1]);
    if (!Number.isFinite(abv)) return "—";
    return `${Math.round(abv * 2)} proof`;
  })();
  const mashLabel = data.mash_bill
    ? data.mash_bill.replace(/_/g, " ").replace(/\b(\w)/g, c => c.toUpperCase())
    : "—";
  const finish = Array.isArray(data.finish_type) && data.finish_type.length
    ? data.finish_type.join(", ")
    : "Traditional oak";
  const distillery = data.distillery_name
    ? `${data.distillery_name}${data.region ? `, ${data.region}` : ""}`
    : (data.vendor && data.region ? `${data.vendor}, ${data.region}` : (data.vendor || "—"));
  const allocation = data.limited_time_offer ? "Limited release" : "Year-round";
  const hook = data.short_description
    || `${data.title || "This bottle"} — a ${data.sub_type || "whiskey"} worth a place on the shelf.`;
  return [
    `<p>${escapeHtml(hook)}</p>`,
    "<ul>",
    `<li><strong>Age:</strong> ${escapeHtml(data.age_statement || "NAS")}</li>`,
    `<li><strong>Proof:</strong> ${escapeHtml(proof)}</li>`,
    `<li><strong>Mash Bill:</strong> ${escapeHtml(mashLabel)}</li>`,
    `<li><strong>Finish:</strong> ${escapeHtml(finish)}</li>`,
    `<li><strong>Distillery:</strong> ${escapeHtml(distillery)}</li>`,
    `<li><strong>Allocation:</strong> ${escapeHtml(allocation)}</li>`,
    "</ul>"
  ].join("");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncateHtmlToLimit(html, limit) {
  if (!html || html.length <= limit) return html;
  // Try cutting at the last </li> within budget; reattach </ul>.
  const closeUl = html.lastIndexOf("</ul>");
  const truncatable = closeUl > 0 ? html.slice(0, closeUl) : html;
  const lastLi = truncatable.lastIndexOf("</li>");
  if (lastLi > 0 && lastLi + 5 <= limit) {
    return truncatable.slice(0, lastLi + 5) + "</ul>";
  }
  // Fall back to brute truncation at the limit, then close any open tags conservatively.
  return html.slice(0, limit - 5) + "</ul>";
}

async function enforceDescriptionShape(html, data) {
  if (looksLikeStructuredHtml(html) && html.length <= DESCRIPTION_HTML_MAX) return html;

  if (looksLikeStructuredHtml(html) && html.length > DESCRIPTION_HTML_MAX) {
    // Single tighten retry, then hard truncate.
    try {
      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 350,
        messages: [
          {
            role: "system",
            content: `Tighten the HTML below to ≤${DESCRIPTION_HTML_MAX} characters total. Preserve the exact <p>...</p><ul><li>...</li>...</ul> structure and every <li> row. Return only the HTML.`
          },
          { role: "user", content: html }
        ]
      });
      const tightened = resp?.choices?.[0]?.message?.content?.trim() || "";
      if (looksLikeStructuredHtml(tightened) && tightened.length <= DESCRIPTION_HTML_MAX) {
        return tightened;
      }
      return truncateHtmlToLimit(tightened || html, DESCRIPTION_HTML_MAX);
    } catch (err) {
      console.warn("AI: tighten-description retry failed:", err?.message || String(err));
      return truncateHtmlToLimit(html, DESCRIPTION_HTML_MAX);
    }
  }

  // Not structured at all — synthesize a structured fallback from the data we have.
  return buildFallbackDescriptionHtml(data);
}

/**
 * Regenerate description + short_description for an EXISTING product using its
 * already-saved metafields and (optionally) fresh web research.
 * Does not call the vision model — we trust the saved tasting notes / metafields.
 */
export async function regenerateDescription({ title, factSheet, webResearch, userNotes, choicesBlock = "" } = {}) {
  if (!title) throw new Error("regenerateDescription requires title");

  const system = `
You are an expert whiskey copywriter for The Whiskey Library. Rewrite an existing product description using the supplied fact sheet.

## DESCRIPTION FORMAT (STRICT — short blurb + bullet highlights, ≤700 chars TOTAL)
Return JSON with TWO fields:

"short_description":  ONE plain-text sentence ≤140 chars, the hook.
"description":        HTML in this exact structure (≤700 chars total HTML):

<p>{2–3 sentence story paragraph. Specific facts only. No "crafted with care" or "exceptional quality".}</p>
<ul>
  <li><strong>Age:</strong> {age_statement or "NAS"}</li>
  <li><strong>Proof:</strong> {proof or "—"}</li>
  <li><strong>Mash Bill:</strong> {mash_bill description or "—"}</li>
  <li><strong>Finish:</strong> {finish or "Traditional oak"}</li>
  <li><strong>Distillery:</strong> {distillery + state or "—"}</li>
  <li><strong>Allocation:</strong> {"Limited release" if limited else "Year-round"}</li>
</ul>

Rules:
- Total HTML length ≤ 700 characters. Count whole HTML (tags included).
- The <p> must end on a complete sentence.
- Every <li> must be present even if "—". Keeps layout stable.
- Do NOT invent flavors or facts that aren't in the fact sheet or web research.
- Plain text in short_description; no HTML tags.

${choicesBlock || ""}
`;

  const factSheetText = JSON.stringify(factSheet || {}, null, 2);
  const webContext = webResearch?.summary || webResearch?.tastingNotesSummary
    ? `\n\n## WEB RESEARCH\n${webResearch.summary || ""}\n${webResearch.tastingNotesSummary || ""}`
    : "";
  const notesText = userNotes ? `\n\n## USER NOTES (override / extra facts)\n${userNotes}` : "";

  const user = `
Title: ${title}

Fact sheet (from saved Shopify metafields):
${factSheetText}
${webContext}
${notesText}

Return JSON: { "short_description": "...", "description": "<p>...</p><ul>...</ul>" }
`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.3,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    response_format: { type: "json_object" }
  });

  let parsed = {};
  try {
    parsed = JSON.parse(resp?.choices?.[0]?.message?.content || "{}");
  } catch {
    parsed = {};
  }

  let description = String(parsed.description || "").trim();
  let short = String(parsed.short_description || "").trim().slice(0, 140);

  if (!looksLikeStructuredHtml(description)) {
    description = buildFallbackDescriptionHtml({
      title,
      vendor: factSheet?.vendor,
      region: factSheet?.region,
      age_statement: factSheet?.age_statement,
      sub_type: factSheet?.sub_type,
      mash_bill: factSheet?.mash_bill,
      finish_type: factSheet?.finish_type,
      distillery_name: factSheet?.distillery_name,
      abv: factSheet?.abv,
      limited_time_offer: factSheet?.limited_time_offer,
      short_description: short
    });
  } else if (description.length > DESCRIPTION_HTML_MAX) {
    description = await enforceDescriptionShape(description, { title, ...factSheet, short_description: short });
  }

  if (!short) {
    short = stripTagsForShort((description.match(/<p>([\s\S]*?)<\/p>/i) || [, ""])[1]).slice(0, 140);
  }

  return { short_description: short, description };
}
