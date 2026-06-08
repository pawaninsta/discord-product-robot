import { runPipeline } from "../pipeline.js";
import { runUpdatePipeline } from "../update-pipeline.js";
import { generateTastingCard } from "../tasting-card.js";
import { slackFileToImage } from "./slack-file.js";
import { makeSlackSender } from "./sender.js";

/**
 * Slack interface for the whiskey product robot.
 *
 * ── create-product UX (chosen approach) ───────────────────────────────────────
 * Slack slash commands CANNOT carry file attachments, so we cannot mirror Discord's
 * single `/create-product image:<file>` interaction directly. The most robust
 * Slack-native pattern that combines an image with structured params is a
 * **message shortcut**:
 *
 *   1. A teammate uploads the bottle photo to a channel the bot is in (one image
 *      per message).
 *   2. They open that message's "More actions" (⋯) menu and pick the
 *      "Create Product" message shortcut (callback_id: `create_product_shortcut`).
 *   3. A modal opens collecting cost, price, abv, proof, quantity, barcode,
 *      reference_link, notes — mirroring the Discord slash-command options.
 *   4. On submit we resolve the image attached to the originating message, download
 *      it (authenticated) into a data: URL, and run the SAME `runPipeline`.
 *
 * Why a message shortcut (not a plain slash command + modal): it deterministically
 * binds the run to a real uploaded file, and file plumbing is the whole technical
 * hurdle on Slack. We ALSO register `/create-product` as a friendly helper that
 * just tells the user how to use the shortcut, and an app_mention handler that
 * triggers a run when the bot is @-mentioned on a message that already has an image
 * (params parsed from the mention text, e.g. "cost=40 price=80 proof=107").
 *
 * The private-file problem is solved in slack-file.js: Slack files are private, but
 * pipeline.js re-fetches `image.url` without auth, so we pre-download (authed) and
 * pass a `data:` URL that any unauthenticated fetch / OpenAI vision call can read.
 * ──────────────────────────────────────────────────────────────────────────────
 */

const SHORTCUT_CALLBACK_ID = "create_product_shortcut";
const MODAL_CALLBACK_ID = "create_product_modal";
const UPDATE_SHORTCUT_CALLBACK_ID = "update_product_shortcut";
const UPDATE_MODAL_CALLBACK_ID = "update_product_modal";

function botToken() {
  return process.env.SLACK_BOT_TOKEN;
}

/* ────────────────────────── input parsing helpers ────────────────────────── */

function parseNumber(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseInteger(raw) {
  const n = parseNumber(raw);
  if (n == null) return null;
  return Number.isInteger(n) ? n : Math.trunc(n);
}

/**
 * Parse "key=value" style params out of free text (used by the app_mention flow).
 * Recognizes: cost, price, abv, proof, quantity, barcode, reference_link, notes.
 */
function parseParamsFromText(text) {
  const out = {};
  if (!text) return out;
  const re = /(\w+)\s*=\s*("([^"]*)"|'([^']*)'|(\S+))/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1].toLowerCase();
    const val = m[3] ?? m[4] ?? m[5] ?? "";
    out[key] = val;
  }
  return out;
}

/**
 * Find the first image file on a Slack message-like object.
 * Slack message events expose attached files under `files`.
 */
function firstImageFile(files) {
  if (!Array.isArray(files)) return null;
  return files.find(f => String(f?.mimetype || f?.filetype || "").startsWith("image/")) || null;
}

/* ───────────────────────────── modal definition ──────────────────────────── */

function buildCreateProductModal({ channel, message_ts, fileId }) {
  // private_metadata carries the binding back to the originating message/file so
  // the view_submission handler can resolve the image without re-querying state.
  const privateMetadata = JSON.stringify({ channel, message_ts, fileId });

  const input = (block_id, label, { optional = true, placeholder = "" } = {}) => ({
    type: "input",
    block_id,
    optional,
    label: { type: "plain_text", text: label },
    element: {
      type: "plain_text_input",
      action_id: "value",
      ...(placeholder ? { placeholder: { type: "plain_text", text: placeholder } } : {})
    }
  });

  return {
    type: "modal",
    callback_id: MODAL_CALLBACK_ID,
    private_metadata: privateMetadata,
    title: { type: "plain_text", text: "Create Product" },
    submit: { type: "plain_text", text: "Create" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Creating a Shopify draft from the bottle image on the selected message."
        }
      },
      input("cost", "Cost", { optional: false, placeholder: "e.g. 39.99" }),
      input("price", "Price", { optional: false, placeholder: "e.g. 79.99" }),
      input("abv", "ABV % (optional)", { placeholder: "e.g. 53.5" }),
      input("proof", "Proof (optional)", { placeholder: "e.g. 107 (ABV = proof/2)" }),
      input("quantity", "Quantity (optional)", { placeholder: "e.g. 6" }),
      input("barcode", "Barcode / UPC (optional)", { placeholder: "digits only" }),
      input("reference_link", "Reference link (optional)", { placeholder: "distillery / distributor URL" }),
      {
        type: "input",
        block_id: "notes",
        optional: true,
        label: { type: "plain_text", text: "Notes (optional)" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          multiline: true,
          placeholder: { type: "plain_text", text: "store pick, barrel #, etc." }
        }
      }
    ]
  };
}

function readModalValues(view) {
  const v = view?.state?.values || {};
  const get = (block) => v?.[block]?.value?.value ?? "";
  return {
    cost: parseNumber(get("cost")),
    price: parseNumber(get("price")),
    abv: parseNumber(get("abv")),
    proof: parseNumber(get("proof")),
    quantity: parseInteger(get("quantity")),
    barcode: (get("barcode") || "").trim() || null,
    referenceLink: (get("reference_link") || "").trim() || null,
    notes: (get("notes") || "").trim()
  };
}

/* ─────────────────────── shared run + completion logic ────────────────────── */

/**
 * Post the same completion summary Discord posts (adminUrl, productTitle,
 * needsAbv / needsVendor warnings), threaded under the run.
 */
async function postCompletion({ client, channel, thread_ts, userId, result }) {
  const mention = userId ? `<@${userId}>` : "";

  if (result?.ok) {
    const productTitle = String(result?.productTitle || "").trim();
    const lines = [
      `${mention} :white_check_mark: Product creation finished.`.trim(),
      productTitle ? `*Product:* ${productTitle}` : "",
      result.adminUrl ? `Draft: ${result.adminUrl}` : "",
      result.needsAbv
        ? ":warning: ABV/proof wasn't found with confidence, so *Alcohol by Volume* was left blank."
        : "",
      result.needsVendor
        ? `:warning: Vendor *"${result.unmatchedVendor}"* was not found in Shopify. Please verify the vendor on this product and correct if needed.`
        : ""
    ].filter(Boolean);

    await client.chat.postMessage({
      channel,
      thread_ts,
      text: lines.join("\n"),
      unfurl_links: false,
      unfurl_media: false
    });
  } else {
    const errText = result?.error ? String(result.error) : "Unknown error";
    await client.chat.postMessage({
      channel,
      thread_ts,
      text: `${mention} :x: Product creation failed: ${errText}`.trim()
    });
  }
}

/**
 * Resolve the bottle image, run the pipeline with a threaded Slack sender, and post
 * the completion summary. Shared by the modal-submit and app_mention flows.
 */
async function runCreateProduct({ client, channel, thread_ts, userId, file, params }) {
  const send = makeSlackSender({ client, channel, thread_ts });

  let image;
  try {
    image = await slackFileToImage(file, botToken());
  } catch (e) {
    await client.chat.postMessage({
      channel,
      thread_ts,
      text: `:x: Couldn't read the bottle image: ${e?.message || String(e)}`
    });
    return;
  }

  await send(":test_tube: Starting… logs for this run will appear in this thread.");

  const result = await runPipeline({
    image,
    cost: params.cost,
    price: params.price,
    abv: params.abv,
    proof: params.proof,
    quantity: params.quantity,
    barcode: params.barcode,
    referenceLink: params.referenceLink,
    notes: params.notes,
    send
  });

  await postCompletion({ client, channel, thread_ts, userId, result });
}

/* ───────────────────────────── tasting card flow ─────────────────────────── */

async function runTastingCard({ client, channel, thread_ts, userId, adminUrl }) {
  const mention = userId ? `<@${userId}>` : "";
  try {
    await client.chat.postMessage({
      channel,
      thread_ts,
      text: ":art: Generating tasting card…"
    });

    const result = await generateTastingCard({ adminUrl });

    if (!result.success) {
      await client.chat.postMessage({
        channel,
        thread_ts,
        text: `:x: Failed to generate tasting card: ${result.error}`
      });
      return;
    }

    // Puppeteer may return a Uint8Array; Slack's upload wants a Buffer.
    const pngAsBuffer = Buffer.isBuffer(result.pngBuffer)
      ? result.pngBuffer
      : Buffer.from(result.pngBuffer);

    const captionLines = [
      `${mention} :white_check_mark: Tasting card generated for *${result.productTitle}*`.trim(),
      result.cardImageUrl ? `:paperclip: Uploaded to Shopify Files and attached to product` : "",
      result.cardImageUrl ? `:link: ${result.cardImageUrl}` : ""
    ].filter(Boolean);

    await client.files.uploadV2({
      channel_id: channel,
      thread_ts,
      file: pngAsBuffer,
      filename: `tasting-card-${result.productHandle}.png`,
      initial_comment: captionLines.join("\n")
    });
  } catch (err) {
    console.error("SLACK TASTINGCARD ERROR:", err);
    await client.chat.postMessage({
      channel,
      thread_ts,
      text: `:x: Error: ${err?.message || String(err)}`
    });
  }
}

/* ───────────────────────────── update-product flow ───────────────────────── */

/**
 * Build a findProduct-style reference object from a (type, value) pair.
 * For the "id" type we tolerate a raw numeric id, a gid://, or an admin URL
 * like https://.../products/123456 and extract the numeric id.
 */
function buildProductRef(type, value) {
  const v = String(value ?? "").trim();
  if (!v) return {};
  switch (type) {
    case "id": {
      if (v.startsWith("gid://")) return { idOrGid: v };
      const fromUrl = v.match(/products\/(\d+)/);
      if (fromUrl) return { idOrGid: fromUrl[1] };
      const digits = v.match(/\d{3,}/);
      return { idOrGid: digits ? digits[0] : v };
    }
    case "sku": return { sku: v };
    case "barcode": return { barcode: v };
    case "title": return { title: v };
    case "handle":
    default: return { handle: v };
  }
}

function buildUpdateProductModal({ channel, message_ts, fileId }) {
  const privateMetadata = JSON.stringify({ channel, message_ts, fileId });

  return {
    type: "modal",
    callback_id: UPDATE_MODAL_CALLBACK_ID,
    private_metadata: privateMetadata,
    title: { type: "plain_text", text: "Update Product" },
    submit: { type: "plain_text", text: "Update" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Reading the bottle image on the selected message to fill in / refresh an *existing* product. No new product is created and price/inventory are untouched."
        }
      },
      {
        type: "input",
        block_id: "reference_type",
        label: { type: "plain_text", text: "Identify the existing product by" },
        element: {
          type: "static_select",
          action_id: "value",
          initial_option: { text: { type: "plain_text", text: "Handle" }, value: "handle" },
          options: [
            { text: { type: "plain_text", text: "Handle" }, value: "handle" },
            { text: { type: "plain_text", text: "SKU" }, value: "sku" },
            { text: { type: "plain_text", text: "Barcode / UPC" }, value: "barcode" },
            { text: { type: "plain_text", text: "Product ID or admin URL" }, value: "id" },
            { text: { type: "plain_text", text: "Title (may match multiple)" }, value: "title" }
          ]
        }
      },
      {
        type: "input",
        block_id: "reference",
        label: { type: "plain_text", text: "Reference value" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          placeholder: { type: "plain_text", text: "e.g. eagle-rare-17 or 088004021443" }
        }
      },
      {
        type: "input",
        block_id: "abv",
        optional: true,
        label: { type: "plain_text", text: "ABV % (optional)" },
        element: { type: "plain_text_input", action_id: "value", placeholder: { type: "plain_text", text: "e.g. 53.5" } }
      },
      {
        type: "input",
        block_id: "proof",
        optional: true,
        label: { type: "plain_text", text: "Proof (optional)" },
        element: { type: "plain_text_input", action_id: "value", placeholder: { type: "plain_text", text: "e.g. 107 (ABV = proof/2)" } }
      },
      {
        type: "input",
        block_id: "reference_link",
        optional: true,
        label: { type: "plain_text", text: "Reference link (optional)" },
        element: { type: "plain_text_input", action_id: "value", placeholder: { type: "plain_text", text: "distillery / distributor URL" } }
      },
      {
        type: "input",
        block_id: "notes",
        optional: true,
        label: { type: "plain_text", text: "Notes (optional)" },
        element: { type: "plain_text_input", action_id: "value", multiline: true, placeholder: { type: "plain_text", text: "store pick, barrel #, etc." } }
      },
      {
        type: "input",
        block_id: "regenerate_image",
        optional: true,
        label: { type: "plain_text", text: "Studio image" },
        element: {
          type: "checkboxes",
          action_id: "value",
          options: [
            { text: { type: "plain_text", text: "Also generate a studio image and attach it" }, value: "yes" }
          ]
        }
      }
    ]
  };
}

function readUpdateModalValues(view) {
  const v = view?.state?.values || {};
  const text = (block) => v?.[block]?.value?.value ?? "";
  const referenceType = v?.reference_type?.value?.selected_option?.value || "handle";
  const regenerateImage = Array.isArray(v?.regenerate_image?.value?.selected_options)
    && v.regenerate_image.value.selected_options.length > 0;
  return {
    referenceType,
    reference: (text("reference") || "").trim(),
    abv: parseNumber(text("abv")),
    proof: parseNumber(text("proof")),
    referenceLink: (text("reference_link") || "").trim() || null,
    notes: (text("notes") || "").trim(),
    regenerateImage
  };
}

/**
 * Post the update completion summary, threaded under the run. runUpdatePipeline
 * already streams detailed status (not-found / ambiguous candidate list) via the
 * sender, so on failure we just post the final ping.
 */
async function postUpdateCompletion({ client, channel, thread_ts, userId, result }) {
  const mention = userId ? `<@${userId}>` : "";
  if (result?.ok) {
    const productTitle = String(result?.productTitle || "").trim();
    const lines = [
      `${mention} :white_check_mark: Product update finished.`.trim(),
      productTitle ? `*Product:* ${productTitle}` : "",
      result.matchedBy ? `Matched by: ${result.matchedBy}` : "",
      result.adminUrl ? `Admin: ${result.adminUrl}` : "",
      result.needsAbv ? ":warning: ABV/proof wasn't found with confidence, so *Alcohol by Volume* was left unchanged." : "",
      result.needsVendor ? `:warning: Vendor *"${result.unmatchedVendor}"* was not found in Shopify; vendor left unchanged. Please verify.` : ""
    ].filter(Boolean);
    await client.chat.postMessage({ channel, thread_ts, text: lines.join("\n"), unfurl_links: false, unfurl_media: false });
  } else {
    const errText = result?.error ? String(result.error) : "Unknown error";
    await client.chat.postMessage({ channel, thread_ts, text: `${mention} :x: Product update failed: ${errText}`.trim() });
  }
}

async function runUpdateProduct({ client, channel, thread_ts, userId, file, values }) {
  const send = makeSlackSender({ client, channel, thread_ts });

  let image;
  try {
    image = await slackFileToImage(file, botToken());
  } catch (e) {
    await client.chat.postMessage({ channel, thread_ts, text: `:x: Couldn't read the bottle image: ${e?.message || String(e)}` });
    return;
  }

  const result = await runUpdatePipeline({
    productRef: buildProductRef(values.referenceType, values.reference),
    image,
    abv: values.abv,
    proof: values.proof,
    referenceLink: values.referenceLink,
    notes: values.notes,
    regenerateImage: values.regenerateImage,
    send
  });

  await postUpdateCompletion({ client, channel, thread_ts, userId, result });
}

/* ──────────────────────────── handler registration ───────────────────────── */

/**
 * Register all Slack handlers on a Bolt `app`.
 *
 * @param {import("@slack/bolt").App} app
 */
export function registerHandlers(app) {
  /* /create-product — helper: explains the shortcut-based flow (Slack slash
     commands can't carry files). */
  app.command("/create-product", async ({ ack, respond }) => {
    await ack();
    await respond({
      response_type: "ephemeral",
      text: [
        "*Create a product from a bottle photo:*",
        "1. Upload the bottle image to this channel (one image per message).",
        "2. On that message, open the *⋯ More actions* menu and choose *Create Product*.",
        "3. Fill in cost, price, and any optional fields in the modal, then submit.",
        "",
        "_Tip:_ you can also @-mention me on a message that has an image, e.g.",
        "`@ProductRobot cost=39.99 price=79.99 proof=107 quantity=6`"
      ].join("\n")
    });
  });

  /* Message shortcut: opens the create-product modal bound to the message's image. */
  app.shortcut(SHORTCUT_CALLBACK_ID, async ({ shortcut, ack, client }) => {
    await ack();

    const channel = shortcut.channel?.id;
    const message = shortcut.message;
    const file = firstImageFile(message?.files);

    if (!file) {
      // Message shortcuts can't post ephemerally without a response_url; DM the user.
      try {
        await client.chat.postMessage({
          channel: shortcut.user?.id,
          text: ":warning: That message has no image. Upload a bottle photo, then run *Create Product* on the message with the image."
        });
      } catch {
        // best effort
      }
      return;
    }

    await client.views.open({
      trigger_id: shortcut.trigger_id,
      view: buildCreateProductModal({
        channel,
        message_ts: message?.ts,
        fileId: file.id
      })
    });
  });

  /* Modal submit: resolve the bound image and run the pipeline. */
  app.view(MODAL_CALLBACK_ID, async ({ ack, view, body, client }) => {
    // Ack immediately so Slack closes the modal; the run continues async.
    await ack();

    let meta = {};
    try {
      meta = JSON.parse(view.private_metadata || "{}");
    } catch {
      meta = {};
    }

    const channel = meta.channel;
    const thread_ts = meta.message_ts; // thread the run under the original image message
    const userId = body?.user?.id;
    const params = readModalValues(view);

    // Re-fetch the message to get the file's fresh url_private_download.
    let file = null;
    try {
      const history = await client.conversations.history({
        channel,
        latest: meta.message_ts,
        inclusive: true,
        limit: 1
      });
      const msg = history?.messages?.[0];
      file =
        (Array.isArray(msg?.files) && msg.files.find(f => f.id === meta.fileId)) ||
        firstImageFile(msg?.files);
    } catch (e) {
      console.warn("SLACK: conversations.history failed:", e?.message || String(e));
    }

    if (!file) {
      // Fall back to fetching the file object directly.
      try {
        const info = await client.files.info({ file: meta.fileId });
        file = info?.file || null;
      } catch (e) {
        console.warn("SLACK: files.info failed:", e?.message || String(e));
      }
    }

    if (!file) {
      await client.chat.postMessage({
        channel,
        thread_ts,
        text: ":x: Couldn't find the bottle image on the original message. Please re-upload and try again."
      });
      return;
    }

    await runCreateProduct({ client, channel, thread_ts, userId, file, params });
  });

  /* app_mention: @bot on a message with an image triggers a run; params from text. */
  app.event("app_mention", async ({ event, client }) => {
    const file = firstImageFile(event?.files);
    if (!file) {
      // Only respond when there's an image to act on; otherwise stay quiet.
      return;
    }

    const channel = event.channel;
    const thread_ts = event.thread_ts || event.ts;
    const userId = event.user;

    // Strip the leading "<@BOTID>" mention before parsing params.
    const text = String(event.text || "").replace(/<@[^>]+>/g, " ");
    const raw = parseParamsFromText(text);

    const params = {
      cost: parseNumber(raw.cost),
      price: parseNumber(raw.price),
      abv: parseNumber(raw.abv),
      proof: parseNumber(raw.proof),
      quantity: parseInteger(raw.quantity),
      barcode: (raw.barcode || "").trim() || null,
      referenceLink: (raw.reference_link || raw.referencelink || raw.link || "").trim() || null,
      notes: (raw.notes || "").trim()
    };

    if (params.cost == null || params.price == null) {
      await client.chat.postMessage({
        channel,
        thread_ts,
        text: ":warning: Please include at least `cost=` and `price=`, e.g. `@ProductRobot cost=39.99 price=79.99`."
      });
      return;
    }

    await runCreateProduct({ client, channel, thread_ts, userId, file, params });
  });

  /* /tastingcard <admin url> — generate + upload the PNG to Slack. */
  app.command("/tastingcard", async ({ command, ack, respond, client }) => {
    await ack();

    const adminUrl = String(command.text || "").trim();
    if (!adminUrl) {
      await respond({
        response_type: "ephemeral",
        text: "Usage: `/tastingcard <shopify admin product URL>`"
      });
      return;
    }

    // Acknowledge in-channel so the upload lands somewhere visible, then thread it.
    const posted = await client.chat.postMessage({
      channel: command.channel_id,
      text: `:art: Generating tasting card for ${adminUrl} …`,
      unfurl_links: false
    });

    await runTastingCard({
      client,
      channel: command.channel_id,
      thread_ts: posted.ts,
      userId: command.user_id,
      adminUrl
    });
  });

  /* /update-product — helper: explains the shortcut-based flow. */
  app.command("/update-product", async ({ ack, respond }) => {
    await ack();
    await respond({
      response_type: "ephemeral",
      text: [
        "*Fill in / refresh an existing product from a bottle photo:*",
        "1. Upload the bottle image to this channel (one image per message).",
        "2. On that message, open the *⋯ More actions* menu and choose *Update Product*.",
        "3. Tell me which existing product to update (handle / SKU / barcode / ID), then submit.",
        "",
        "_This never creates a new product and never changes price or inventory._"
      ].join("\n")
    });
  });

  /* Message shortcut: opens the update-product modal bound to the message's image. */
  app.shortcut(UPDATE_SHORTCUT_CALLBACK_ID, async ({ shortcut, ack, client }) => {
    await ack();

    const channel = shortcut.channel?.id;
    const message = shortcut.message;
    const file = firstImageFile(message?.files);

    if (!file) {
      try {
        await client.chat.postMessage({
          channel: shortcut.user?.id,
          text: ":warning: That message has no image. Upload a bottle photo, then run *Update Product* on the message with the image."
        });
      } catch {
        // best effort
      }
      return;
    }

    await client.views.open({
      trigger_id: shortcut.trigger_id,
      view: buildUpdateProductModal({
        channel,
        message_ts: message?.ts,
        fileId: file.id
      })
    });
  });

  /* Update modal submit: resolve the bound image and run the update pipeline. */
  app.view(UPDATE_MODAL_CALLBACK_ID, async ({ ack, view, body, client }) => {
    await ack();

    let meta = {};
    try {
      meta = JSON.parse(view.private_metadata || "{}");
    } catch {
      meta = {};
    }

    const channel = meta.channel;
    const thread_ts = meta.message_ts;
    const userId = body?.user?.id;
    const values = readUpdateModalValues(view);

    if (!values.reference) {
      await client.chat.postMessage({ channel, thread_ts, text: ":x: No product reference provided — tell me which existing product to update." });
      return;
    }

    // Re-fetch the message to get the file's fresh url_private_download.
    let file = null;
    try {
      const history = await client.conversations.history({
        channel,
        latest: meta.message_ts,
        inclusive: true,
        limit: 1
      });
      const msg = history?.messages?.[0];
      file =
        (Array.isArray(msg?.files) && msg.files.find(f => f.id === meta.fileId)) ||
        firstImageFile(msg?.files);
    } catch (e) {
      console.warn("SLACK: conversations.history failed:", e?.message || String(e));
    }

    if (!file) {
      try {
        const info = await client.files.info({ file: meta.fileId });
        file = info?.file || null;
      } catch (e) {
        console.warn("SLACK: files.info failed:", e?.message || String(e));
      }
    }

    if (!file) {
      await client.chat.postMessage({
        channel,
        thread_ts,
        text: ":x: Couldn't find the bottle image on the original message. Please re-upload and try again."
      });
      return;
    }

    await runUpdateProduct({ client, channel, thread_ts, userId, file, values });
  });
}
