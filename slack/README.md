# Slack Interface 🥃

A Slack app that runs the **same** whiskey product pipeline as the Discord bot
(`pipeline.js`) and the same tasting-card generator (`tasting-card.js`). Discord is
untouched — this is a parallel interface so the team can cut over.

Entry point: `slack-index.js` (run with `npm run start:slack`).
Handlers: `slack/handlers.js`. File download helper: `slack/slack-file.js`.
Threaded status sender: `slack/sender.js`.

---

## create-product UX (and why)

Slack slash commands **cannot carry file attachments**, so we can't mirror Discord's
`/create-product image:<file>` directly. The chosen approach is a **message
shortcut** (the most robust way to bind a real uploaded file to structured params):

1. Upload the bottle photo to a channel the bot is in (one image per message).
2. On that message, open **⋯ More actions → Create Product** (message shortcut,
   callback_id `create_product_shortcut`).
3. A **modal** opens collecting `cost`, `price`, `abv`, `proof`, `quantity`,
   `barcode`, `reference_link`, `notes` — mirroring the Discord slash-command
   options in `register-commands.js`.
4. On submit, the app resolves the image on the original message, downloads it
   (authenticated) into a `data:` URL, and runs `runPipeline(...)`. All status
   updates are posted as threaded replies under the original image message, and the
   completion summary (admin URL, product title, `needsAbv` / `needsVendor`
   warnings) is posted there too — matching Discord.

**Two extra conveniences:**

- `/create-product` slash command — a helper that just explains the shortcut flow
  (since it can't take a file itself).
- **@-mention flow** — `@ProductRobot cost=39.99 price=79.99 proof=107 quantity=6`
  on a message that has an image triggers a run directly. Params are parsed from the
  mention text (`key=value`, quotes allowed for `notes`). `cost` and `price` are
  required.

`/tastingcard <admin url>` generates the card and uploads the PNG to Slack via
`files.uploadV2` (threaded under an acknowledgement message).

**Update an existing product (image recognition):** upload the arrived bottle's
photo, then run **⋯ More actions → Update Product** (message shortcut, callback_id
`update_product_shortcut`). The modal asks how to identify the existing product
(handle / SKU / barcode / product ID-or-URL / title) and an optional "regenerate
studio image" checkbox, then calls `runUpdatePipeline`. It **never creates a new
product** and **never changes price or inventory**. `/update-product` is a helper
command that explains the flow.

---

## The private-file problem (important)

Slack-hosted files are **private**: you can only read the bytes by requesting
`url_private_download` with an `Authorization: Bearer ${SLACK_BOT_TOKEN}` header.
But `pipeline.js` later re-fetches `image.url` **without** auth (in `image.js` via
`generateStudioImage` → `fetch`, and again when OpenAI's vision API fetches the URL).
A raw Slack URL would 401/403 for those consumers.

**Solution (`slack/slack-file.js`):** download the Slack file once (authed) and hand
the pipeline a self-contained `data:<mime>;base64,...` URL shaped like a Discord
attachment (`{ url }`). `node-fetch` v3 resolves `data:` URLs natively and OpenAI's
vision API accepts data URLs, so every downstream unauthenticated `fetch(image.url)`
/ vision call works with no Slack credentials.

---

## Required Slack scopes

Configure as **Bot Token Scopes** in the app's OAuth settings:

| Scope | Why |
|-------|-----|
| `commands` | `/create-product`, `/tastingcard` slash commands |
| `chat:write` | Post status updates + completion summaries |
| `files:read` | Download the private bottle image (`url_private_download`) |
| `files:write` | Upload the generated tasting-card PNG |
| `app_mentions:read` | @-mention create-product flow |
| `channels:history` | Re-read the originating message to resolve the image (public channels) |
| `groups:history` | Same, for private channels (optional, if used in private channels) |
| `im:write` | DM the user a warning when a shortcut is run on a message with no image (optional) |

If you only use the message-shortcut + modal flow you can drop `app_mentions:read`;
if you only use @-mention you can drop `commands`. Keep `files:read`/`files:write`/
`chat:write` always.

---

## Event subscriptions / interactivity

Enable in the app config:

- **Interactivity & Shortcuts** — turn on, and add two **message shortcuts**:
  - Name: `Create Product` · Callback ID: `create_product_shortcut`
  - Name: `Update Product` · Callback ID: `update_product_shortcut`
- **Slash Commands** — create `/create-product`, `/update-product`, and `/tastingcard`.
- **Event Subscriptions** — subscribe to bot events: `app_mention`.
  (In Socket Mode you do not need a public Request URL.)

---

## Socket Mode setup (recommended — no public URL)

1. In **Settings → Socket Mode**, enable Socket Mode.
2. In **Settings → Basic Information → App-Level Tokens**, create a token with the
   `connections:write` scope. This is your `SLACK_APP_TOKEN` (starts with `xapp-`).
3. Install the app to the workspace to get the `SLACK_BOT_TOKEN` (starts with
   `xoxb-`).
4. Invite the bot to the channel(s) where products are created: `/invite @ProductRobot`.

To run in **HTTP mode** instead (public endpoint), set `SLACK_SOCKET_MODE=false` and
provide `SLACK_SIGNING_SECRET`; Slack will POST to your endpoint on `PORT`
(default 3001). Set each feature's Request URL to `https://<host>/slack/events`.

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_BOT_TOKEN` | ✅ | Bot token (`xoxb-…`); also used to authenticate file downloads |
| `SLACK_APP_TOKEN` | ✅ (Socket Mode) | App-level token (`xapp-…`) with `connections:write` |
| `SLACK_SIGNING_SECRET` | ✅ (HTTP mode) | Request signing secret (only if `SLACK_SOCKET_MODE=false`) |
| `SLACK_SOCKET_MODE` | ❌ | `true` (default) for Socket Mode, `false` for HTTP mode |
| `PORT` / `SLACK_PORT` | ❌ | HTTP-mode listen port (default `3001`) |

Plus all the **existing pipeline env vars** the core code already needs
(`OPENAI_API_KEY`, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN`, `GOOGLE_AI_API_KEY`,
optional `GOOGLE_API_KEY`/`GOOGLE_CX`, etc.). See the project README.

---

## Run

```bash
npm install        # installs @slack/bolt (added to package.json)
npm run start:slack
```

The Discord bot still runs independently via `npm start`.
