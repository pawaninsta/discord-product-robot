# Discord Product Robot 🤖🥃

A Discord bot that automates Shopify product creation for whiskey bottles. Upload an image, and the bot handles everything — from generating studio-quality photos to writing compelling product descriptions using AI.

## How It Works

```
Discord Command → Studio Image → AI Analysis → Shopify Draft → Discord Notification
```

1. **Upload** — User runs `/create-product` with a bottle image, cost, and price
2. **Image Processing** — Nano Banana AI generates a professional studio product photo
3. **AI Analysis** — GPT-4o reads the bottle label and generates product data (title, description, tasting notes, metadata)
4. **Shopify** — Creates a draft product with all metafields populated
5. **Notification** — Sends the Shopify admin link back to Discord

## Project Structure

```
discord-product-robot/
├── index.js              # Discord bot entry point
├── pipeline.js           # Main workflow orchestration
├── ai.js                 # OpenAI GPT-4o vision integration
├── image.js              # Nano Banana AI studio image generation
├── shopify.js            # Shopify Admin API integration
├── register-commands.js  # Discord slash command registration
├── package.json          # Dependencies
└── railway.json          # Railway deployment config
```

## Prerequisites

- Node.js 18+
- Discord Bot with application commands enabled
- OpenAI API key with GPT-4o access
- Shopify store with Admin API access
- Nano Banana API key (optional — falls back to original image)
- Discord Webhook URL for status notifications

## Environment Variables

Create these environment variables in your deployment platform or `.env` file:

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Discord bot token |
| `DISCORD_APP_ID` | Discord application ID |
| `DISCORD_WEBHOOK_URL` | Webhook URL for status updates |
| `OPENAI_API_KEY` | OpenAI API key |
| `SHOPIFY_STORE_DOMAIN` | Your Shopify store domain (e.g., `your-store.myshopify.com`) |
| `SHOPIFY_ADMIN_TOKEN` | Shopify Admin API access token |
| `NANOBANANA_API_KEY` | Nano Banana API key for image processing |

## Installation

```bash
# Install dependencies
npm install

# Register Discord slash commands (run once)
node register-commands.js

# Start the bot
npm start
```

## Discord Command

### `/create-product`

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `image` | Attachment | ✅ | Upload a bottle image |
| `cost` | Number | ✅ | Product cost |
| `price` | Number | ✅ | Selling price |
| `notes` | String | ❌ | Optional notes (store pick, proof, barrel info, etc.) |

## Shopify Metafields

The bot automatically populates these custom metafields:

**Text Fields:**
- `nose` — Aroma notes (list)
- `palate` — Taste notes (list)
- `finish` — Finish notes (list)
- `sub_type` — Whiskey type
- `country_of_origin` — Country
- `region` — Region
- `cask_wood` — Cask wood type (list)
- `finish_type` — Cask finish type
- `age_statement` — Age or "NAS"
- `alcohol_by_volume` — ABV

**Boolean Fields:**
- `finished` — Has a cask finish
- `store_pick` — Store/barrel pick
- `cask_strength` — Cask strength/barrel proof
- `single_barrel` — Single barrel
- `limited_time_offer` — Limited release

## Deployment

### Railway

The included `railway.json` is pre-configured. Just connect your repo and set environment variables.

```bash
# Deploy
railway up
```

### Other Platforms

Any Node.js hosting works. Make sure to:
1. Set all environment variables
2. Run `node register-commands.js` once to register the Discord command
3. Start with `npm start`

## Development

```bash
# Run locally
DISCORD_TOKEN=xxx DISCORD_APP_ID=xxx ... node index.js
```

## Troubleshooting

**Bot not responding to commands?**
- Make sure you've run `node register-commands.js`
- Check that `DISCORD_TOKEN` and `DISCORD_APP_ID` are correct
- Discord commands can take up to an hour to propagate globally

**Shopify errors?**
- Verify `SHOPIFY_STORE_DOMAIN` format (no `https://`, just the domain)
- Check Admin API token has `write_products` scope
- Ensure metafields exist in your Shopify admin

**AI returning bad data?**
- GPT-4o works best with clear, well-lit bottle photos
- Add context in the `notes` field for store picks or special info

## License

MIT



