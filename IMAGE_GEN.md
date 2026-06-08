# Studio Image Generation (`image.js`)

Turns a user-uploaded bottle photo into a clean e-commerce **studio packshot**
(single bottle, pure white background) using Google's Gemini image-editing model.
Called from `pipeline.js` as `generateStudioImage(image.url)`.

## Model choice

**Default: `gemini-3-pro-image-preview` (Nano Banana Pro), on `v1beta`.**

Why Pro and not the cheaper `gemini-3.1-flash-image-preview` (Nano Banana 2):
our output is a **final, client-facing e-commerce asset** whose value depends on the
bottle's **label text/logos staying readable** and the geometry staying true. Google's
guidance is to use Pro when "the image must carry readable text … a final deliverable",
because one garbled output costs manual repair time that outweighs the per-image savings.
Flash is the better default for low-risk, high-volume generation — so the model id is
overridable.

Override with `GOOGLE_IMAGE_MODEL` (e.g. set it to `gemini-3.1-flash-image-preview` or
`gemini-2.5-flash-image` to trade quality for cost). A leading `models/` prefix is stripped
automatically.

Docs:
- https://ai.google.dev/gemini-api/docs/image-generation
- https://ai.google.dev/gemini-api/docs/models/gemini-3-pro-image-preview
- https://ai.google.dev/gemini-api/docs/gemini-3 (`responseModalities`, `generateContent`)
- https://ai.google.dev/gemini-api/docs/thought-signatures (intermediate "thought" image parts)

## Environment variables

| Var | Required | Default | Purpose |
|-----|----------|---------|---------|
| `GOOGLE_AI_API_KEY` | yes | – | API key. If unset, `generateStudioImage` returns the original image unchanged. |
| `GOOGLE_IMAGE_MODEL` | no | `gemini-3-pro-image-preview` | Override the image model id. |
| `GOOGLE_IMAGE_API_VERSION` (or `GOOGLE_API_VERSION`) | no | `v1beta` | API version path segment. |
| `GOOGLE_IMAGE_SIZE` | no | `2K` | Requested output size: `1K`, `2K`, or `4K`. Falls back to smaller sizes if rejected. |

## Defects addressed & how

The prompt is plain imperative English (image models follow a clear scene description
better than a dumped JSON spec). Each constraint maps to a reported defect:

1. **Background not pure white / cast shadows** → an explicit `BACKGROUND` rule demands
   uniform `#FFFFFF` (RGB 255,255,255) with *no* off-white/cream/grey, *no*
   gradient/vignette/texture, and **no cast shadow, contact shadow, or reflection pool**.
   (Cast shadows were the main source of the "off-white" tint.)
2. **Missing bottle seal/closure** → a dedicated `CLOSURE` rule: the bottle is SEALED and
   unopened; preserve the exact cork/capsule/screw cap/wax seal/foil/neck tag in the same
   shape, color, and position; never render it open or uncapped.
3. **Wrong proportions** → a `GEOMETRY` rule forbidding stretch/squash/reslim/reshape and
   requiring the silhouette, neck, shoulder, and body to match the source.
4. **Insufficient grounding ("use its surroundings")** → the `IDENTITY` rule (stated as the
   most important) requires keeping the *exact* bottle — real label artwork, printed text,
   fonts, logos, colors, liquid color, fill level — and reconstructing **only** occluded
   areas (e.g. where a hand was). The model must not invent/translate/re-letter text.
   `productContext` is injected as a **read-only hint** to help read the label, explicitly
   *not* as license to fabricate.

### Other correctness fixes vs. the old code

- **`responseModalities: ["TEXT","IMAGE"]`** is now set. The old request omitted it, which
  for Gemini 3 image models can yield a text-only / no-image response.
- **Final-image extraction.** Gemini 3 Pro Image is a *thinking* model and can return 1–3
  image parts, including intermediate `thought: true` drafts. The old code grabbed the
  **first** `inlineData` part, which could be a rough draft. We now skip `thought:true`
  parts and take the **last** rendered image (`extractFinalImagePart`).
- **Dropped unverified fields.** The old `imageConfig.imageOutputOptions.mimeType` is not a
  documented REST field; removed it. Output mime is read from the response part instead.
- **Simplified retry loop.** Kept the size fallback (`2K → 1K`), the "unchanged output"
  heuristic, and the graceful fallback to the original image, but collapsed the duplicated
  strict/non-strict double-attempt machinery into one clear prompt + size loop.

## Running the test harness

```bash
# URL input
GOOGLE_AI_API_KEY=your_key node image-test.js https://example.com/bottle.jpg "Lagavulin 16 Year"

# Local file input (converted to a file:// URL internally)
GOOGLE_AI_API_KEY=your_key node image-test.js ./samples/bottle.jpg "Brand Name"
```

Output is written to `./out/studio-<timestamp>.png` (or `.jpg` if the model returns JPEG).
Without `GOOGLE_AI_API_KEY` the harness exits with a clear error. `productContext` is optional.

Static check (no network/key needed): `node --check image.js && node --check image-test.js`.

## Known limitations / needs live testing with real keys

- **Not validated against the live API** in this environment (no key). Verify with real
  bottle photos that closures/labels survive and the background is genuinely `#FFFFFF`.
- **Preview model id.** `gemini-3-pro-image-preview` is a preview name and may rename to a
  GA id; `GOOGLE_IMAGE_MODEL` exists so you can repoint without a code change.
- **`imageSize` may be ignored** by some routes/SDKs (known upstream issue); the code falls
  back gracefully but actual output resolution should be confirmed.
- **No pixel-level post-validation.** The "unchanged output" check is a byte heuristic, not a
  background-whiteness check. If you want a hard guarantee, add a post-step that samples
  corner pixels and forces them to pure white, or re-runs on failure.
- **Cost:** Pro bills thinking tokens even though only the final image is kept. Route to
  `GOOGLE_IMAGE_MODEL=gemini-3.1-flash-image-preview` for cheaper bulk runs if needed.
