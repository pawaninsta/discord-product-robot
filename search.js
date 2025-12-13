import fetch from "node-fetch";

const GOOGLE_API_KEY = (process.env.GOOGLE_API_KEY || "").trim();
const RAW_GOOGLE_CX = (process.env.GOOGLE_CX || "").trim(); // Custom Search Engine ID

function normalizeCx(raw) {
  if (!raw) return "";
  // If user pasted a full URL or querystring containing cx=..., extract it.
  try {
    if (raw.includes("cx=")) {
      const qs = raw.includes("?") ? raw.split("?")[1] : raw;
      const params = new URLSearchParams(qs);
      const cx = params.get("cx");
      if (cx) return cx.trim();
    }
  } catch {}
  return raw;
}

const GOOGLE_CX = normalizeCx(RAW_GOOGLE_CX);

async function googleCseSearch({ q, num = 5 }) {
  if (!GOOGLE_API_KEY || !GOOGLE_CX) return null;

  const safeQ = String(q || "").replace(/\s+/g, " ").trim().slice(0, 180);
  if (!safeQ) return null;

  const safeNum = Math.max(1, Math.min(10, Number(num) || 5));
  const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(safeQ)}&num=${safeNum}`;

  const res = await fetch(url);
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    console.warn("SEARCH: Google API error:", res.status, bodyText ? `| ${bodyText.slice(0, 300)}` : "");
    if (res.status === 400) {
      console.warn("SEARCH: Hint: verify GOOGLE_CX is the CSE ID (not a full URL), Custom Search API is enabled, and the API key allows requests from Railway.");
    }
    return null;
  }

  const data = await res.json();
  if (!data?.items?.length) return { results: [] };

  return {
    results: data.items.map(item => ({
      title: item.title,
      snippet: item.snippet,
      link: item.link
    }))
  };
}

/**
 * Search Google for whiskey product information
 * Returns relevant snippets to supplement AI vision
 */
export async function searchWhiskeyInfo(query) {
  console.log("SEARCH: Querying Google for:", query);

  if (!GOOGLE_API_KEY || !GOOGLE_CX) {
    console.log("SEARCH: Google API not configured, skipping web search");
    return null;
  }

  try {
    const safeQuery = String(query || "").replace(/\s+/g, " ").trim().slice(0, 140);
    const data = await googleCseSearch({ q: `${safeQuery} whiskey bourbon specs ABV age`, num: 5 });
    const results = data?.results || [];
    if (results.length === 0) {
      console.log("SEARCH: No results found");
      return null;
    }

    console.log("SEARCH: Found", results.length, "results");
    
    // Combine snippets into a research summary
    const summary = results.map(r => `${r.title}: ${r.snippet}`).join("\n\n");
    
    return {
      results,
      summary
    };
  } catch (err) {
    console.error("SEARCH: Error:", err.message);
    return null;
  }
}

/**
 * Search targeted sources for tasting notes and return compact evidence + links.
 * Uses Google CSE, so results depend on your CSE configuration and allowed sites.
 */
export async function searchTastingNotes(query) {
  console.log("SEARCH(TASTING): Querying sources for:", query);

  if (!GOOGLE_API_KEY || !GOOGLE_CX) {
    console.log("SEARCH(TASTING): Google API not configured, skipping web search");
    return null;
  }

  const base = String(query || "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (!base) return null;

  // Keep this small to avoid quota burn.
  const probes = [
    { source: "general", q: `${base} tasting notes nose palate finish`, num: 4 },
    { source: "distiller", q: `site:distiller.com ${base} tasting notes`, num: 3 },
    { source: "whisky.com", q: `site:whisky.com ${base} tasting notes`, num: 3 },
    { source: "reddit", q: `site:reddit.com ${base} tasting notes`, num: 3 },
    { source: "wine-searcher", q: `site:wine-searcher.com ${base} tasting notes`, num: 2 }
  ];

  const all = [];
  for (const p of probes) {
    try {
      const res = await googleCseSearch({ q: p.q, num: p.num });
      const results = (res?.results || []).map(r => ({ ...r, source: p.source }));
      all.push(...results);
    } catch (e) {
      console.warn(`SEARCH(TASTING): probe failed (${p.source}):`, e?.message || String(e));
    }
  }

  if (all.length === 0) return null;

  // De-dupe by link.
  const seen = new Set();
  const deduped = [];
  for (const r of all) {
    const link = String(r.link || "");
    if (!link || seen.has(link)) continue;
    seen.add(link);
    deduped.push(r);
  }

  // Compact summary: prioritize snippets; include source tags and links for traceability (internal only).
  const tastingNotesSummary = deduped
    .slice(0, 12)
    .map(r => `[${r.source}] ${r.title}: ${r.snippet} (${r.link})`)
    .join("\n");

  return {
    results: deduped,
    tastingNotesSummary
  };
}

/**
 * Extract product name from image for searching
 * Uses a quick AI call to identify the bottle
 */
export async function identifyBottle(imageUrl) {
  // This is a lightweight identification - the main AI call does the heavy lifting
  // We just need enough info to do a Google search
  return null; // Will be called from pipeline after initial AI identification
}


