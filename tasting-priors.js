/**
 * Deterministic tasting-note priors used when web tasting-note evidence is missing.
 * These are NOT factual claims about a specific bottling; they are educated defaults
 * based on category/finish/proof and a small set of producer/expression patterns.
 *
 * Output vocabulary is constrained to the terms allowed in `ai.js` prompt.
 */

function uniq(arr) {
  const out = [];
  const seen = new Set();
  for (const x of arr) {
    const v = String(x || "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function parsePercent(abvLike) {
  const s = String(abvLike || "").trim();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseProof(proofLike) {
  const s = String(proofLike || "").trim();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function detectTypeHints(text) {
  const t = String(text || "").toLowerCase();
  const hints = {
    isRye: /\brye\b/.test(t),
    isCorn: /\bcorn\b/.test(t) || /\bjimmy red\b/.test(t),
    isWheated: /\bwheat(ed)?\b/.test(t) || /\bwheated\b/.test(t),
    isScotch: /\bscotch\b/.test(t) || /\bsingle malt\b/.test(t) || /\bpeat\b/.test(t),
    isFinished: /\bfinish(ed)?\b/.test(t) || /\bsherry\b|\bport\b|\bmadeira\b|\brum\b|\bcognac\b|\bwine\b|\bstout\b|\bbeer\b|\bamburana\b|\bmizunara\b/.test(t)
  };
  return hints;
}

function detectFinishType(text) {
  const t = String(text || "").toLowerCase();
  if (/\bpx\b|\bpedro xim(e|é)nez\b/.test(t)) return "Pedro Ximénez";
  if (/\boloroso\b/.test(t)) return "Oloroso";
  if (/\bsherry\b/.test(t)) return "Sherry";
  if (/\bport\b/.test(t)) return "Port";
  if (/\bmadeira\b/.test(t)) return "Madeira";
  if (/\bcognac\b/.test(t)) return "Cognac";
  if (/\brum\b/.test(t)) return "Rum";
  if (/\bstout\b|\bbeer\b/.test(t)) return "Beer/Stout";
  if (/\bwine\b/.test(t)) return "Wine";
  if (/\bamburana\b/.test(t)) return "Amburana";
  if (/\bmizunara\b/.test(t)) return "Mizunara";
  if (/\btoasted\b|\bdouble oak\b/.test(t)) return "Toasted Barrel";
  return "None";
}

function scoreIntensity({ abv, proof }) {
  const abvNum = parsePercent(abv);
  const proofNum = parseProof(proof);
  const computedAbv = abvNum ?? (proofNum ? proofNum / 2 : null);
  if (!computedAbv) return 0.5;
  // 40% -> 0.3, 50% -> 0.55, 60% -> 0.8
  return clamp((computedAbv - 35) / 40, 0.2, 0.95);
}

/**
 * Build tasting priors for nose/palate/finish.
 * @param {object} input
 * @param {string} input.query - search-friendly query (vendor + expression + age/finish)
 * @param {string} input.vendor
 * @param {string} input.title
 * @param {string} input.notes
 * @param {string} input.abv
 * @param {string|number} input.proof
 * @returns {{nose:string[], palate:string[], finish:string[], finish_type:string, rationale:string[]}}
 */
export function buildTastingPriors({
  query = "",
  vendor = "",
  title = "",
  notes = "",
  abv = "",
  proof = ""
} = {}) {
  const text = [query, vendor, title, notes].filter(Boolean).join(" | ");
  const hints = detectTypeHints(text);
  const finish_type = detectFinishType(text);
  const intensity = scoreIntensity({ abv, proof });
  const v = String(vendor || "").toLowerCase();
  const t = String(title || "").toLowerCase();
  const q = String(query || "").toLowerCase();

  const rationale = [];
  if (hints.isCorn) rationale.push("Detected corn whiskey / Jimmy Red-style cue");
  if (hints.isRye) rationale.push("Detected rye cue");
  if (hints.isWheated) rationale.push("Detected wheated cue");
  if (finish_type !== "None") rationale.push(`Detected finish cue: ${finish_type}`);
  if (parsePercent(abv) || parseProof(proof)) rationale.push(`Intensity adjusted by proof/ABV (${abv || proof || "unknown"})`);

  // Base palettes by category - using rich, descriptive phrases
  const baseBourbonNose = ["rich caramel and vanilla", "toasted oak with brown sugar", "warm baking spices", "butterscotch and maple sweetness", "hints of orange peel"];
  const baseBourbonPalate = ["honeyed toffee and brown sugar", "charred oak with cinnamon warmth", "black pepper and dark chocolate", "full-bodied and coating"];
  const baseRyeNose = ["fresh mint and eucalyptus", "bold pepper and baking spices", "toasted oak with citrus zest", "herbal undertones"];
  const baseRyePalate = ["spicy rye character with black pepper", "cinnamon and clove warmth", "hints of mint and honey", "medium-bodied with oak backbone"];
  const baseCornNose = ["sweet corn and grain", "light honey and butterscotch", "gentle baking spices", "subtle herbal notes"];
  const baseCornPalate = ["creamy corn sweetness", "honey and light toffee", "gentle pepper and oak", "citrus brightness"];
  const baseScotchNose = ["peat smoke and earthy notes", "malty sweetness with oak", "dried fruit and citrus", "maritime hints"];
  const baseScotchPalate = ["smoky and peppery", "rich malt with oak tannins", "dried fruit and dark chocolate", "complex and layered"];

  let nose = [];
  let palate = [];

  if (hints.isScotch) {
    nose = baseScotchNose.slice();
    palate = baseScotchPalate.slice();
  } else if (hints.isCorn) {
    nose = baseCornNose.slice();
    palate = baseCornPalate.slice();
  } else if (hints.isRye) {
    nose = baseRyeNose.slice();
    palate = baseRyePalate.slice();
  } else {
    nose = baseBourbonNose.slice();
    palate = baseBourbonPalate.slice();
  }

  // Producer/expression nudges (small, conservative)
  if (v.includes("heaven hill") || t.includes("heaven hill")) {
    nose.push("peanut brittle", "tobacco", "nutty");
    palate.push("peanut brittle", "tobacco");
    rationale.push("Applied conservative Heaven Hill profile nudges (nutty/peanut/tobacco)");
  }

  if (q.includes("parker") || t.includes("parker")) {
    nose.push("leather", "tobacco", "dried fruit");
    palate.push("leather", "dried fruit");
    rationale.push("Applied Parker's Heritage-style collector release nudges (oak/leather/dried fruit)");
  }

  if (q.includes("wild turkey") || t.includes("wild turkey")) {
    nose.push("orange peel", "cinnamon");
    palate.push("orange peel", "cinnamon");
    rationale.push("Applied Wild Turkey citrus/spice nudges");
  }

  // Finish-based nudges
  if (finish_type === "Sherry" || finish_type === "Pedro Ximénez" || finish_type === "Oloroso") {
    nose.push("raisin", "fig", "chocolate", "nutty");
    palate.push("raisin", "fig", "chocolate", "coffee");
  } else if (finish_type === "Port") {
    nose.push("red fruit", "cherry", "chocolate");
    palate.push("red fruit", "cherry", "chocolate");
  } else if (finish_type === "Madeira" || finish_type === "Wine") {
    nose.push("stone fruit", "orchard fruit", "citrus");
    palate.push("stone fruit", "orchard fruit", "citrus");
  } else if (finish_type === "Rum") {
    nose.push("brown sugar", "toffee", "tropical");
    palate.push("brown sugar", "toffee", "tropical");
  } else if (finish_type === "Cognac") {
    nose.push("dried fruit", "nutty", "chocolate");
    palate.push("dried fruit", "nutty", "chocolate");
  } else if (finish_type === "Beer/Stout") {
    nose.push("coffee", "cocoa", "chocolate");
    palate.push("coffee", "cocoa", "chocolate");
  } else if (finish_type === "Amburana") {
    // Keep conservative: amburana often reads as intense baking spice/cinnamon.
    nose.push("cinnamon", "nutmeg", "clove");
    palate.push("cinnamon", "nutmeg", "clove");
  } else if (finish_type === "Mizunara") {
    nose.push("cedar", "eucalyptus");
    palate.push("cedar", "herbal");
  }

  // Wheated tends to read softer/sweeter; rye tends to read spicier.
  if (hints.isWheated) {
    nose.push("honey", "toffee");
    palate.push("honey", "toffee");
  }

  // Finish adjectives
  const finish = [];
  finish.push(intensity >= 0.75 ? "bold" : "smooth");
  finish.push(intensity >= 0.65 ? "long" : "medium");
  finish.push(intensity >= 0.55 ? "warm" : "clean");
  if (hints.isRye || finish_type === "Amburana") finish.push("spicy");
  if (!hints.isRye && !hints.isCorn) finish.push("oaky");

  // Final selection & constraints
  nose = uniq(nose).slice(0, 5);
  palate = uniq(palate).slice(0, 5);
  const finishOut = uniq(finish).slice(0, 4);

  // Guarantee minimum lengths expected by validation.
  while (nose.length < 3) nose.push("oak");
  while (palate.length < 3) palate.push("oak");
  while (finishOut.length < 2) finishOut.push("warm");

  return {
    nose,
    palate,
    finish: finishOut,
    finish_type,
    rationale: rationale.slice(0, 8)
  };
}


