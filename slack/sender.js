/**
 * Slack status-update sender — the Slack equivalent of `makeDiscordSender` in index.js.
 *
 * Mirrors the Discord behavior: posts status strings to a single thread so a run's
 * logs stay together. Discord uses `thread_ts` semantics by posting into a created
 * thread; in Slack we pass `thread_ts` pointing at the originating message so all
 * updates render as threaded replies.
 *
 * Slack message text has a practical limit (~3000 chars for a single section/text
 * field; the message API allows more but blocks cap at 3000). We chunk
 * conservatively below that, matching the Discord 1900-char chunking style.
 */

const MAX = 2900; // stay safely under Slack's ~3000-char block/text limit

/**
 * @param {Object} opts
 * @param {Object} opts.client - Bolt `client` (a WebClient) for chat.postMessage.
 * @param {string} opts.channel - Channel ID to post into.
 * @param {string} opts.thread_ts - Thread timestamp so updates stay in one thread.
 * @returns {(message: string) => Promise<void>} async send callback for runPipeline.
 */
export function makeSlackSender({ client, channel, thread_ts }) {
  return async (message) => {
    const content = String(message ?? "").trim();
    if (!content) return;

    for (let i = 0; i < content.length; i += MAX) {
      const chunk = content.slice(i, i + MAX);
      await client.chat.postMessage({
        channel,
        thread_ts,
        text: chunk,
        // Avoid Slack auto-unfurling every Shopify/image link in status spam.
        unfurl_links: false,
        unfurl_media: false
      });
    }
  };
}
