import fetch from "node-fetch";

const GOOGLE_API_KEY = (process.env.GOOGLE_API_KEY || "").trim();
const RAW_GOOGLE_CX = (process.env.GOOGLE_CX || "").trim(); // Custom Search Engine ID

function googleCseHint(statusCode, errorMessage) {
  const msg = String(errorMessage || "");
  const m = msg.toLowerCase();

  // Common actionable cases seen with Google Custom Search JSON API.
  if (statusCode === 403 && (m.includes("has not been used") || m.includes("it is disabled"))) {
    return "Enable the Custom Search API for the GCP project that owns this API key.";
  }
  if ((statusCode === 400 || statusCode === 403) && m.includes("api key not valid")) {
    return "GOOGLE_API_KEY is invalid (wrong key/project) or was deleted/rotated. Create a new key and update Railway.";
  }
  if ((statusCode === 403 || statusCode === 429) && (m.includes("quota") || m.includes("rate limit") || m.includes("daily limit"))) {
    return "Custom Search quota/rate limit exceeded. Check Quotas + billing for the GCP project.";
  }
  if (statusCode === 400 && (m.includes("invalid") || m.includes("cx")) && m.includes("cx")) {
    return "GOOGLE_CX looks invalid. Use the Programmable Search Engine 'Search engine ID' (cx=...).";
  }
  if (statusCode === 403 && m.includes("billing")) {
    return "Billing is required/disabled for this GCP project. Attach a billing account and retry.";
  }

  return "";
}

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
  const bodyText = await res.text().catch(() => "");

  if (!res.ok) {
    // Try to parse Google error message for actionable feedback.
    let parsed = null;
    try {
      parsed = bodyText ? JSON.parse(bodyText) : null;
    } catch {}

    const msg =
      parsed?.error?.message ||
      (typeof bodyText === "string" && bodyText.trim() ? bodyText.trim().slice(0, 500) : "") ||
      `Google CSE error (${res.status})`;

    const hint = googleCseHint(res.status, msg);
    console.warn("SEARCH: Google API error:", res.status, msg, hint ? `| Hint: ${hint}` : "");
    if (res.status === 400) {
      console.warn("SEARCH: Hint: verify GOOGLE_CX is the CSE ID (not a full URL), Custom Search API is enabled, and the API key allows requests from Railway.");
    }

    return {
      ok: false,
      statusCode: res.status,
      errorMessage: msg,
      errorStatus: parsed?.error?.status || "",
      errorHint: hint
    };
  }

  let data = null;
  try {
    data = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    data = null;
  }

  const items = data?.items || [];
  return {
    ok: true,
    statusCode: res.status,
    results: items.map(item => ({
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
    return { status: "disabled", results: [], summary: "", errorMessage: "" };
  }

  try {
    const safeQuery = String(query || "").replace(/\s+/g, " ").trim().slice(0, 140);
    const resp = await googleCseSearch({ q: `${safeQuery} whiskey bourbon specs ABV age`, num: 5 });
    if (!resp) return { status: "disabled", results: [], summary: "", errorMessage: "" };
    if (!resp.ok) {
      return {
        status: "error",
        statusCode: resp.statusCode,
        errorStatus: resp.errorStatus || "",
        errorHint: resp.errorHint || "",
        results: [],
        summary: "",
        errorMessage: resp.errorMessage || ""
      };
    }

    const results = resp.results || [];
    if (results.length === 0) return { status: "ok", results: [], summary: "", errorMessage: "" };

    console.log("SEARCH: Found", results.length, "results");
    
    // Combine snippets into a research summary
    const summary = results.map(r => `${r.title}: ${r.snippet}`).join("\n\n");
    
    return {
      status: "ok",
      results,
      summary,
      errorMessage: "",
      statusCode: resp.statusCode
    };
  } catch (err) {
    console.error("SEARCH: Error:", err.message);
    return {
      status: "error",
      results: [],
      summary: "",
      errorMessage: err?.message || String(err),
      statusCode: 0,
      errorStatus: "",
      errorHint: ""
    };
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
    return { status: "disabled", results: [], tastingNotesSummary: "", errorMessage: "" };
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
  let firstError = "";
  let firstStatusCode = 0;
  let firstHint = "";
  let firstErrorStatus = "";
  for (const p of probes) {
    try {
      const res = await googleCseSearch({ q: p.q, num: p.num });
      if (!res) continue;
      if (!res.ok) {
        if (!firstError) {
          firstError = res.errorMessage || "";
          firstStatusCode = Number(res.statusCode || 0);
          firstHint = String(res.errorHint || "");
          firstErrorStatus = String(res.errorStatus || "");
        }
        continue;
      }
      const results = (res.results || []).map(r => ({ ...r, source: p.source }));
      all.push(...results);
    } catch (e) {
      console.warn(`SEARCH(TASTING): probe failed (${p.source}):`, e?.message || String(e));
    }
  }

  if (all.length === 0) {
    // If every probe failed with an API error, keep the errorMessage for downstream UX.
    if (firstError) {
      return {
        status: "error",
        results: [],
        tastingNotesSummary: "",
        errorMessage: firstError,
        statusCode: firstStatusCode,
        errorStatus: firstErrorStatus,
        errorHint: firstHint
      };
    }
    return { status: "ok", results: [], tastingNotesSummary: "", errorMessage: "", statusCode: 200 };
  }

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
    status: "ok",
    results: deduped,
    tastingNotesSummary,
    errorMessage: "",
    statusCode: 200
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


