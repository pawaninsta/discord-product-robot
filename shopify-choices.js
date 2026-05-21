import fetch from "node-fetch";

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

const KEYS = ["finish_type", "cask_wood", "location_", "mash_bill"];

let cache = null;
let inflight = null;

async function fetchChoices() {
  const query = `
    query MetafieldChoices {
      metafieldDefinitions(first: 100, ownerType: PRODUCT, namespace: "custom") {
        edges {
          node {
            key
            validations { name value }
          }
        }
      }
    }
  `;

  const res = await fetch(`https://${SHOP}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query })
  });

  const data = await res.json();
  if (data.errors) {
    throw new Error(`metafieldDefinitions error: ${JSON.stringify(data.errors).slice(0, 300)}`);
  }

  const out = {};
  for (const key of KEYS) out[key] = [];

  for (const edge of data.data?.metafieldDefinitions?.edges || []) {
    const node = edge.node;
    if (!KEYS.includes(node.key)) continue;
    const v = (node.validations || []).find(x => x.name === "choices");
    if (!v) continue;
    try {
      const arr = JSON.parse(v.value);
      if (Array.isArray(arr)) out[node.key] = arr.map(s => String(s).trim()).filter(Boolean);
    } catch {}
  }

  return out;
}

export async function loadChoices() {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      cache = await fetchChoices();
      console.log("CHOICES: loaded", Object.fromEntries(Object.entries(cache).map(([k, v]) => [k, v.length])));
      return cache;
    } catch (err) {
      console.warn("CHOICES: failed to load Shopify choices, falling back to permissive mode:", err?.message || String(err));
      cache = { finish_type: [], cask_wood: [], location_: [], mash_bill: [] };
      return cache;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function validChoicesFor(key) {
  return (cache && cache[key]) || [];
}

function normalize(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function coerceToChoice(key, value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const choices = validChoicesFor(key);
  if (choices.length === 0) return raw;

  const target = normalize(raw);

  for (const c of choices) {
    if (normalize(c) === target) return c;
  }

  for (const c of choices) {
    const cn = normalize(c);
    if (cn.includes(target) || target.includes(cn)) return c;
  }

  const targetWords = new Set(target.split(" ").filter(w => w.length >= 3));
  let bestChoice = null;
  let bestScore = 0;
  for (const c of choices) {
    const cWords = new Set(normalize(c).split(" ").filter(w => w.length >= 3));
    if (cWords.size === 0) continue;
    let shared = 0;
    for (const w of targetWords) if (cWords.has(w)) shared++;
    const score = shared / Math.max(targetWords.size || 1, cWords.size || 1);
    if (score >= 0.5 && score > bestScore) {
      bestScore = score;
      bestChoice = c;
    }
  }
  return bestChoice || "";
}

export function choicesPromptBlock() {
  const c = cache || {};
  return [
    "## SHOPIFY ALLOWED CHOICES (you MUST pick from these exact strings — do NOT invent values)",
    `finish_type: ${(c.finish_type || []).join(" | ") || "(unknown)"}`,
    `cask_wood:   ${(c.cask_wood || []).join(" | ") || "(unknown)"}`,
    `location_:   ${(c.location_ || []).join(" | ") || "(unknown)"}`,
    `mash_bill:   ${(c.mash_bill || []).join(" | ") || "(unknown)"}`,
    "",
    'If no choice fits, use "Other" only if "Other" is in the list above; otherwise leave the field empty / use an empty array.'
  ].join("\n");
}
