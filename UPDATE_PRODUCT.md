# Update Product From Bottle Photo

This capability **updates an existing Shopify product** from a bottle photo via
image recognition. It does **not** create a new product and does **not** change
price, cost, or inventory.

## Why

The team creates a bare placeholder product (no description/metafields) before
stock arrives. When the physical bottle lands at the warehouse, someone
photographs it. This flow parses that photo and fills in / refreshes the
**existing** product's listing (title, description, tasting metafields, vendor,
product type, optional new image) — without creating a duplicate.

## Flow (`update-pipeline.js` → `runUpdatePipeline`)

1. **Resolve** the existing product via `findProduct(productRef)`.
   - 0 matches → returns `{ ok: false, error: "product_not_found" }` (never creates).
   - >1 matches → returns `{ ok: false, error: "ambiguous_match", matches }` (never guesses).
   - 1 match → proceeds.
2. **Recognize + research** the bottle photo using the same steps as the create
   pipeline: `extractLabelSignals` → `identifyBottleForSearch` →
   `searchWhiskeyInfo` / `searchTastingNotes` → `buildTastingPriors` →
   `generateProductData`.
3. **Build metafields** with the exact same `mf` / `mfList` / `mb` helpers and keys
   as `pipeline.js` (nose, palate, finish, sub_type, location_, state, cask_wood,
   finish_type, age_statement, alcohol_by_volume, awards, and the booleans).
   ABV is only set when confidently known (same rule as create).
4. **Vendor-match** via `searchVendors` / `matchVendor` exactly like the create flow.
   If the AI vendor doesn't match an existing Shopify vendor, the product's vendor
   is left unchanged and `needsVendor` is flagged.
5. **Write back** via `updateProductListing(productId, fields)` (core fields +
   metafields through `productUpdate`, with the same individual-retry fallback as
   the create flow). If `regenerateImage` is true, a studio image is generated
   from the photo and attached as a **new** product image.
6. **Preserve existing data**: new parsed values are preferred for the listing,
   but a non-empty existing field is **never** overwritten with an empty new value
   (applies to title/description/vendor/product_type and every text/list metafield;
   booleans always pass through since a parsed `false` is meaningful).

Returns:

```js
{ ok, productId, adminUrl, productTitle, needsAbv, needsVendor, unmatchedVendor, matchedBy }
```

## `productRef` matching options (how duplicates are avoided)

Pass **one** of the following in `productRef`. Matching is strict and
single-field, so the flow only acts on an unambiguous target:

| Field      | Meaning                          | Match type        |
|------------|----------------------------------|-------------------|
| `idOrGid`  | numeric id or `gid://shopify/...`| exact (1 product) |
| `handle`   | product handle                   | exact             |
| `sku`      | first variant SKU                | exact             |
| `barcode`  | first variant barcode / UPC      | exact             |
| `title`    | title search (fuzzy)             | may return many   |

- `idOrGid` is the most precise and recommended for automation.
- `title` is fuzzy: if multiple products match, the pipeline **refuses to guess**
  and asks for a more specific reference.
- When nothing matches, the pipeline reports "not found" rather than creating a
  product.

## Functions added to `shopify.js` (append-only)

```js
findProduct({ idOrGid, handle, sku, barcode, title })
// → product summary object | null (no match) | Array (multiple matches)
//   summary shape: { id, title, handle, descriptionHtml, vendor, productType,
//                    tags, imageUrl, price, variantId, sku, barcode, metafields }

updateProductListing(productId, {
  title, description, vendor, product_type, tags,
  metafields: [{ namespace, key, value, type }],
  imageUrl // optional NEW image; data: URLs are uploaded to Shopify Files first
})
// → updated product summary (never creates; never touches price/cost/inventory)
```

## Running the test harness

```bash
# Update by handle
node update-test.js --image <photoUrl> --handle <product-handle>

# Or by id / sku / barcode / title
node update-test.js --image <photoUrl> --id 1234567890
node update-test.js --image <photoUrl> --sku ABC-123
node update-test.js --image <photoUrl> --barcode 081234560013
node update-test.js --image <photoUrl> --title "Blanton's Single Barrel"

# Optional flags
#   --notes "<text>"        extra notes for the AI
#   --abv 47.5              known ABV (preferred over guessing)
#   --proof 95             known proof (converted to ABV)
#   --reference <url>       reference link
#   --regenerate-image      generate + attach a studio image
```

### Required environment variables

- `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN` — Shopify Admin API
- `OPENAI_API_KEY` — label recognition + listing generation

Optional:

- `GOOGLE_API_KEY`, `GOOGLE_CX` — web research (tasting notes / specs)
- `GOOGLE_AI_API_KEY` — studio image generation (`--regenerate-image`)

The harness exits non-zero and prints the missing variables if required
credentials are absent, so it fails gracefully.
