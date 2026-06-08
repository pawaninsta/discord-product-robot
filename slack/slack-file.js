import fetch from "node-fetch";

/**
 * Slack-hosted files are PRIVATE. To read the bytes you must request the file's
 * `url_private_download` with an `Authorization: Bearer ${SLACK_BOT_TOKEN}` header.
 *
 * The product pipeline (`pipeline.js`) later does `fetch(image.url)` WITHOUT any
 * auth header (image.js → generateStudioImage → fetch; ai.js vision calls → OpenAI
 * fetches the URL too). A raw Slack `url_private_download` would therefore 401/403
 * for those downstream consumers.
 *
 * Solution: download the Slack file ONCE here (authed) and hand the pipeline a
 * self-contained `data:<mime>;base64,...` URL. `node-fetch` v3 resolves `data:` URLs
 * natively, and OpenAI's vision API accepts data URLs for `image_url.url`, so every
 * downstream `fetch(image.url)` / vision call works with no Slack credentials.
 */

const MAX_IMAGE_BYTES = 24 * 1024 * 1024; // guardrail; Slack files can be large

/**
 * Download a Slack file (authenticated) and return a pipeline-compatible image
 * object shaped like a Discord attachment: `{ url }` where `url` is a data: URL.
 *
 * @param {Object} file - A Slack `file` object (from message/file_shared events).
 *   Expects `url_private_download` (preferred) or `url_private`, plus `mimetype`.
 * @param {string} token - SLACK_BOT_TOKEN used for the authed download.
 * @returns {Promise<{ url: string, mimetype: string, name: string }>}
 */
export async function slackFileToImage(file, token) {
  if (!file) throw new Error("slackFileToImage: missing file object");
  if (!token) throw new Error("slackFileToImage: missing SLACK_BOT_TOKEN");

  const downloadUrl = file.url_private_download || file.url_private;
  if (!downloadUrl) {
    throw new Error("slackFileToImage: file has no url_private_download/url_private");
  }

  const mimetype = file.mimetype || file.filetype || "image/png";
  if (!String(mimetype).startsWith("image/")) {
    throw new Error(`slackFileToImage: file is not an image (mimetype=${mimetype})`);
  }

  const res = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    throw new Error(`slackFileToImage: download failed (HTTP ${res.status})`);
  }

  // Detect Slack's "you were redirected to a login page" failure: a 200 with HTML
  // instead of image bytes (happens when the token lacks files:read or the file is
  // in a workspace the token can't access).
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("text/html")) {
    throw new Error(
      "slackFileToImage: got HTML instead of image bytes — check the bot token has files:read scope and access to the file's channel"
    );
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length === 0) {
    throw new Error("slackFileToImage: downloaded 0 bytes");
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(
      `slackFileToImage: image too large (${buffer.length} bytes > ${MAX_IMAGE_BYTES})`
    );
  }

  // Prefer the server-reported content-type when it is an image; otherwise use the
  // Slack metadata mimetype.
  const finalMime = contentType.startsWith("image/") ? contentType.split(";")[0].trim() : mimetype;
  const dataUrl = `data:${finalMime};base64,${buffer.toString("base64")}`;

  return { url: dataUrl, mimetype: finalMime, name: file.name || "bottle-image" };
}
