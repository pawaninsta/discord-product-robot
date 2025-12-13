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
    const safeQuery = String(query || "").replace(/\s+/g, " ").trim().slice(0, 120);
    const searchQuery = encodeURIComponent(`${safeQuery} whiskey bourbon specs ABV age`);
    const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${searchQuery}&num=5`;

    const res = await fetch(url);
    
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      // 400 almost always means invalid cx/key/restrictions; don't break the pipeline.
      console.warn("SEARCH: Google API error:", res.status, bodyText ? `| ${bodyText.slice(0, 300)}` : "");
      if (res.status === 400) {
        console.warn("SEARCH: Hint: verify GOOGLE_CX is the CSE ID (not a full URL), Custom Search API is enabled, and the API key allows requests from Railway.");
      }
      return null;
    }

    const data = await res.json();
    
    if (!data.items || data.items.length === 0) {
      console.log("SEARCH: No results found");
      return null;
    }

    // Extract relevant info from search results
    const results = data.items.map(item => ({
      title: item.title,
      snippet: item.snippet,
      link: item.link
    }));

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
 * Extract product name from image for searching
 * Uses a quick AI call to identify the bottle
 */
export async function identifyBottle(imageUrl) {
  // This is a lightweight identification - the main AI call does the heavy lifting
  // We just need enough info to do a Google search
  return null; // Will be called from pipeline after initial AI identification
}


