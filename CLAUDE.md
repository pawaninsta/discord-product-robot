# Discord Product Robot

## Project
A Discord bot for Whiskey Library (a whiskey store). It automates product creation on Shopify and generates tasting cards.

## Stack
- **Runtime:** Node.js (ESM — all files use `import`/`export`, `"type": "module"` in package.json)
- **Bot framework:** discord.js v14
- **AI:** Google Gemini (`@google/generative-ai`), OpenAI
- **E-commerce:** Shopify Admin GraphQL API
- **Rendering:** Puppeteer (tasting card PNG generation)
- **Web server:** Express (serves tasting card HTML for Puppeteer)
- **Config:** All secrets via `process.env` (no dotenv — Railway injects env vars)

## File Layout
- `index.js` — Discord bot entry point, slash command routing (`create-product`, `update-product`, `tastingcard`, `dev*`)
- `register-commands.js` — Registers Discord slash commands
- `pipeline.js` — Product **creation** pipeline (orchestrator)
- `update-pipeline.js` — Product **update** pipeline: fills in / refreshes an EXISTING product from a bottle photo (never creates, never touches price/inventory)
- `ai.js` — AI integrations (Gemini, OpenAI)
- `shopify.js` — Shopify GraphQL API helpers (incl. `findProduct` / `updateProductListing` for the update flow)
- `image.js` — Studio-image generation (Gemini "Nano Banana Pro"); `image-test.js` is a CLI harness; see `IMAGE_GEN.md`
- `tasting-card.js` — Tasting card generation logic
- `tasting-card-server.js` — Express server for tasting card HTML
- `dev-command.js` — `/dev`, `/dev-revise`, `/dev-approve` command handlers (two-phase dev agent: plan then implement)
- `search.js` — Search utilities
- `slack-index.js` + `slack/` — Slack (Bolt) interface running alongside Discord, reusing the same pipelines; see `slack/README.md`

## Conventions
- ESM only — use `import`/`export`, never `require()`
- Config via `process.env` — no dotenv files
- Keep functions focused and files small
- Use `node-fetch` for HTTP requests (already a dependency)
- Discord slash commands defined in `register-commands.js`, handled in `index.js`
- Log threads: for long-running commands, create a Discord thread for status updates

## Environment Variables
Key env vars (set on Railway). NOTE: the running code reads these exact names:
- `DISCORD_TOKEN`, `DISCORD_APP_ID` — Discord bot credentials
- `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN` — Shopify Admin API access
- `OPENAI_API_KEY` — OpenAI (GPT-4o vision / copy)
- `GOOGLE_AI_API_KEY` — Google Gemini image generation; optional `GOOGLE_IMAGE_MODEL` (default `gemini-3-pro-image-preview`), `GOOGLE_IMAGE_SIZE`
- `GOOGLE_API_KEY`, `GOOGLE_CX` — (optional) Google Custom Search for web-grounded tasting notes
- `GITHUB_PAT` — GitHub Personal Access Token (for /dev command)
- Slack interface (only needed to run `slack-index.js`): `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` (Socket Mode), `SLACK_SIGNING_SECRET` (HTTP mode) — see `slack/README.md`

## Important Operational Note
The Shopify store currently connected for development is the **NY (Northport)** store, but production pushes to a **separate DC store**. The target store is determined entirely by `SHOPIFY_STORE_DOMAIN` / `SHOPIFY_ADMIN_TOKEN` — there is no hardcoded location. Inventory is set at the connected store's default location.
