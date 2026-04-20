# PDF Asset Pipeline — Design

**Date:** 2026-04-20
**Scope:** Persist uploaded recipe PDFs, extract card thumbnails for the recipe grid, and give the user manual overrides.
**Status:** Design approved by user; ready for implementation plan.

## Goal

Make two things possible in the UI:
1. **Recipe cards show real food imagery.** Today every card uses an SVG placeholder; we want the actual HelloFresh photo (or a rasterized page) so the grid looks like a recipe library and not a color swatch chart.
2. **The "Original PDF" button actually opens the PDF.** Today the button triggers a paper-style modal rendered from the meal's data — no actual PDF is loaded.

## Non-goals

- PDF editing or annotation.
- OCR-based re-parsing (the existing Claude-based parser stays as-is).
- Cloud storage (S3, etc.). Self-hosted, Tailscale-local.
- Image deduplication across meals (rare edge case; out of scope).
- Pagination / streaming of large image libraries. ~70 cards is tiny.

## User stories

- **As Mike,** when I import a HelloFresh PDF, I expect the recipe card in the library to show the food photo without me doing anything.
- **As Mike,** if the auto-extracted photo looks wrong, I can click "Replace photo" and drop in one I like.
- **As Mike,** some of my older recipes were imported without their PDFs. I can click "Upload PDF" on those recipes and attach the card after the fact.
- **As Mike,** if a photo extraction looks bad, I can click "Re-run extraction" to try again after I've updated the source PDF, without touching the DB.

## Architecture

Three entry points, one extraction pipeline, one data model.

### Entry points

1. **Import path** (`POST /api/meals/import` + `POST /api/meals`) — existing flow, extended to persist the PDF and run the thumbnail job after the meal row is created.
2. **Backfill path** (`scripts/backfill-pdfs.ts`) — one-shot script that walks `server/uploads/`, deduplicates by SHA-256, fuzzy-matches filenames to existing meal names, copies matched files into the new storage tree, and runs the thumbnail job.
3. **Manual override** — three buttons on the recipe detail page that reuse the extraction pipeline: Replace photo, Upload PDF, Re-run extraction.

### Extraction pipeline (`runThumbnailJob`)

Cascading, stops at first success:

1. `pdfimages -list <pdf>` → parse output → pick the largest embedded image → if ≥ 400×300 px **and** ≥ 20 KB after JPEG re-encode, use it. Tag `imageSource = "embedded"`.
2. `pdftoppm -jpeg -r 120 -f 1 -l 1 <pdf>` → rasterize page 1 at 120 DPI → trim whitespace margins via a simple alpha/edge detector → use it. Tag `imageSource = "rasterized"`.
3. Both fail → write nothing. `imagePath = null`, `imageSource = null`. UI falls back to the existing warm SVG `PhotoTile`.

Implemented as one `async function runThumbnailJob(pdfPath, destPath): Promise<"embedded" | "rasterized" | null>` in `server/src/services/pdfExtraction.ts`. `execFile` wrappers around poppler binaries (`pdfimages`, `pdftoppm`, `pdfinfo` if needed for page count). No Claude vision.

### Storage layout

Filesystem, under `server/storage/meals/{mealId}/`:

```
server/storage/
└── meals/
    └── 42/
        ├── source.pdf      # original
        └── thumb.jpg       # output of extraction
```

Served via a new Express route mounted at `/media/meals/:id/:asset` where `:asset` is `thumb.jpg` or `source.pdf`. Route validates the id + asset name, constructs the on-disk path, calls `res.sendFile`.

**Why filesystem over DB bytea:** ~70 PDFs × ~1 MB avg = ~70 MB; plus ~10 MB of thumbs. Postgres bytea would bloat row sizes, every image load would be a query + base64 hop, and we gain nothing since the whole stack is self-hosted on one box. Filesystem is `sendFile`-fast and backups are a `tar czf storage.tgz storage/` away.

### Schema diff

```prisma
model Meal {
  // existing fields untouched except imageUrl is deprecated (null for new rows)
  pdfPath     String?  @map("pdf_path")
  imagePath   String?  @map("image_path")
  imageSource String?  @map("image_source")   // "embedded" | "rasterized" | "manual"
}
```

Three nullable columns. One Prisma migration. No backfill SQL required — backfill script populates them.

`imageSource = "manual"` is sticky: the **Re-run extraction** button checks this flag and prompts "this was uploaded manually — overwrite?" before regenerating.

## Component map

### New backend files

- `server/src/services/pdfExtraction.ts`
  - `runThumbnailJob(pdfPath, destJpgPath): Promise<"embedded" | "rasterized" | null>`
  - `ensurePopplerAvailable(): Promise<void>` — checks binaries on boot, logs warning if missing.
- `server/src/services/mediaStorage.ts`
  - `mealDir(mealId): string` — `server/storage/meals/{id}/`, mkdirp on call.
  - `mealPdfPath(mealId): string`, `mealThumbPath(mealId): string`.
  - `hashFile(path): Promise<string>` — SHA-256 for dedupe.
- `server/src/routes/media.ts`
  - `GET /media/meals/:id/source.pdf`
  - `GET /media/meals/:id/thumb.jpg`
  - Returns 404 if file absent on disk (does not consult DB — filesystem is source of truth at serve time).
- `server/src/scripts/backfill-pdfs.ts`
  - Walks `server/uploads/`, dedupes by SHA-256, fuzzy-matches filename → `meal.name` using `fuse.js` (score threshold 0.4 — fuse.js is inverted, lower is better), copies matched PDFs into storage tree, runs extraction, reports CSV of matched/unmatched.
  - Flags: `--dry-run`, `--min-score <float>`, `--force <pdfName>=<mealId>`.

### New backend routes (additions to existing controllers)

- `POST /api/meals/:id/photo` — multer image upload → write to `storage/meals/{id}/thumb.jpg` → `UPDATE Meal SET imagePath, imageSource = 'manual'`.
- `POST /api/meals/:id/pdf` — multer pdf upload → write to `storage/meals/{id}/source.pdf` → run extraction unless `imageSource = 'manual'` → update row.
- `POST /api/meals/:id/extract-thumbnail` — re-run extraction on existing `pdfPath`. Returns 409 if `imageSource = 'manual'` unless `?force=true`.
- `POST /api/meals/import` (existing) — response extended with an opaque `importSessionId` string. Server stashes the parsed tmp PDF path keyed by that id in an in-memory Map with a 15-minute TTL. `POST /api/meals` accepts an optional `importSessionId` in its body; if present, the server moves the stashed PDF into `storage/meals/{newId}/source.pdf` and runs extraction after insert. No second upload from the client; session keys cleared on use or after TTL.

### Frontend changes

- `client/src/components/MealCard.tsx`
  - Image prop priority: `meal.imagePath → /media/meals/{id}/thumb.jpg` first; `<img onError>` falls back to `<PhotoTile>`.
- `client/src/pages/Dashboard.tsx`
  - Same fallback in the tonight's-dinner hero and the "other meals" row.
- `client/src/pages/RecipeDetail.tsx`
  - New action row below the existing Add-to-plan / Scale-servings row:
    - **Replace photo** (opens file picker, image only) → `POST /api/meals/:id/photo`.
    - **Upload PDF** (only visible when `pdfPath == null`) → `POST /api/meals/:id/pdf`.
    - **Re-run extraction** (only visible when `pdfPath != null`) → `POST /api/meals/:id/extract-thumbnail`. Confirm dialog if `imageSource === 'manual'`.
    - **Original PDF** (existing button, now opens the real PDF in a new tab via `/media/meals/:id/source.pdf` instead of the paper-style modal; modal stays as the fallback when `pdfPath == null`).
- `client/src/api/meals.ts`
  - Three new functions: `uploadMealPhoto(id, file)`, `uploadMealPdf(id, file)`, `extractMealThumbnail(id, force?)`.

### Infrastructure

- Install `poppler-utils` on the dev server: `sudo apt-get install poppler-utils`. One-time.
- Add `storage/` to the Express static config: `app.use("/media", mediaRouter)` (the router is lightweight — just two handlers).
- `.gitignore` gains `server/storage/`.

## Data flow diagrams

### Import

```
Client: RecipeImport.tsx
  │
  ├─ POST /api/meals/import  (multipart, pdf)
  │     ← 200 { parsed, ingredientMap, importSessionId }
  │       (server keeps tmp file at /tmp/mp-import-{sessionId}.pdf)
  │
  ├─ user fills form
  │
  └─ POST /api/meals  (body includes importSessionId)
        ← 200 { meal }
        server side:
          1. INSERT Meal → id
          2. mv /tmp/mp-import-{sessionId}.pdf → storage/meals/{id}/source.pdf
          3. runThumbnailJob → storage/meals/{id}/thumb.jpg (or null)
          4. UPDATE Meal SET pdfPath, imagePath, imageSource
```

If step 3 fails, imagePath stays null and the card renders the SVG placeholder — not an error.

### Backfill (one-shot)

```
$ npx tsx src/scripts/backfill-pdfs.ts --dry-run

Reading server/uploads ............ 54 PDFs
SHA-256 dedupe ....................  21 unique
Loading meals .....................  69 meals from DB
Fuzzy matching (fuse.js, ≤0.4) ....
  match:   1775798603205-creamy_dijon_dill_chicken.pdf → "Creamy Dijon Dill Chicken" (meal 2, score 0.08)
  match:   1775868508788-crispy_kickin_chicken.pdf    → "Crispy Kickin Chicken"     (meal 14, score 0.05)
  … 17 more
  no match: 1775868117596-canadas_great_gravy_cheeseburgers.pdf   (best: "Canada's Great Gravy Cheeseburgers", score 0.42)
  …
Unmatched: 2 files. Re-run with --force=<file>=<mealId> to override.

$ npx tsx src/scripts/backfill-pdfs.ts         # no --dry-run, does the work
```

After run:
- Matched meals gain `pdfPath`, `imagePath`, `imageSource`.
- `server/uploads/` is left in place; the script only copies, never deletes. Operator can `rm -rf server/uploads/` when satisfied.

### Manual override

Three buttons, three routes, each atomic:

```
Replace photo:   POST /api/meals/42/photo          → { imagePath, imageSource: "manual" }
Upload PDF:      POST /api/meals/42/pdf            → { pdfPath, imagePath?, imageSource? }
Re-run extract:  POST /api/meals/42/extract-thumbnail → { imagePath, imageSource }
```

All three return the updated `Meal`; the client simply replaces the meal in local state.

## Error handling

- **Poppler binaries missing.** `ensurePopplerAvailable()` logs a one-time warning on boot. Extraction short-circuits to null. Install instructions in README update.
- **All extraction paths fail.** Silent — `imagePath = null`. UI's `<img onError>` + `<PhotoTile>` fallback takes over.
- **Backfill fuzzy match ambiguous.** Logged to unmatched list. No mutation. Operator resolves with `--force`.
- **Manual upload wrong type.** Multer's fileFilter rejects before write. Client shows a toast.
- **DB says file exists, disk doesn't.** `/media/...` returns 404. `<img onError>` falls back to `<PhotoTile>`. Log at server for investigation — this should never happen under normal operation.
- **Concurrent re-run.** Not solved (single-user app). Two parallel extracts write the same file; last-writer-wins is fine.
- **Disk full.** Unhandled. ~70 MB total estimate makes this theoretical. Defer.

## Testing strategy

Manual verification, no automated harness for this phase (the broader test story is out of scope):

1. Import a fresh HelloFresh PDF via the UI → confirm card in library shows the food photo.
2. Import a PDF where the largest embedded image is a logo (rare; we'll construct one) → confirm rasterized fallback kicks in.
3. Import a .png "recipe card" → confirm extraction gracefully skips (pdfimages errors out) → SVG placeholder shows.
4. Click Replace photo with a JPEG → refresh → confirm card shows new image and `imageSource === 'manual'`.
5. Click Re-run extraction on a meal with `imageSource === 'manual'` → confirm confirm-dialog, then confirm overwrite works.
6. Run backfill script in `--dry-run` → eyeball matches → run for real → confirm DB rows updated and files in `storage/meals/{id}/`.
7. Hit `/media/meals/999/thumb.jpg` for a meal that doesn't exist → 404.
8. Manually `rm` a `thumb.jpg` whose path is still in the DB → confirm card falls back to `<PhotoTile>` without a console error.

## Rollout

1. Prisma migration (three new columns) — deployable on its own.
2. Backend services + routes — can ship without frontend; routes serve existing placeholder images until data exists.
3. Frontend card/detail updates — once 2 is live.
4. Run backfill script manually on the dev server after steps 1–3.
5. Import pipeline change (thread tmp pdf through to create) ships as its own commit.

Each step is independently deployable. No feature flags needed.

## Open questions (none blocking)

- After manual use for a few weeks, revisit whether the `imageSource` column is worth keeping or if the "manual" flag should be a boolean instead.
- If `pdfimages` picks logos too often, add a tier-1.5 Claude-vision crop. Not worth building until we have failure data.
