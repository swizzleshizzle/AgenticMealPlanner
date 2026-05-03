# Receipt Tracking for Pantry — Design Notes

**Date:** 2026-05-03
**Status:** Approved. Next step: implementation plan.
**Trigger:** Logging pantry items one-at-a-time via the existing "Add item"
form is the bottleneck that keeps the pantry feature from being used. Most
shopping trips produce a digital (Walmart) or paper (Aldi) receipt that
already has every item, quantity, and price on it. Letting the user copy in
the receipt and have an agent extract the line items turns a 20-row manual
chore into a one-shot review-and-confirm.

## Scope

- **In:** a new "Add from receipt" flow on the Pantry page. Accepts pasted
  text, uploaded photo (JPG/PNG/HEIC), or PDF. Uses Claude to extract the
  line items, store name, trip date, subtotal/tax/total. Fuzzy-matches each
  food line against the existing `Ingredient` table; falls back to a second
  Claude pass for difficult receipts. Shows a review modal where the user
  fixes anything wrong and commits the result to `PantryItem` rows.
- **In:** persistent `Receipt` + `ReceiptItem` records, with the original
  source file stored under `media/receipts/<id>/source.<ext>` (mirrors how
  meal PDFs work today).
- **In:** a small "Recent receipts" strip on Pantry (last 5) and a "This
  week: $X across N trips" spending strip above it. Click any receipt to
  re-open the same review modal in read-only/edit mode.
- **Out (v1):** a dedicated Receipts sidebar tab. The whole feature lives
  on Pantry + a modal.
- **Out (v1):** linking `PantryItem` rows back to the `ReceiptItem` that
  created them. Once committed, pantry rows have no memory of their
  receipt origin. Spending rolls up purely from the `Receipt` table.
- **Out (v1):** spending dashboards beyond the weekly strip. Schema is
  structured to allow them later (`SUM(total) GROUP BY date_trunc('week', ...)`).
- **Out (v1):** editing a committed receipt's line items. The detail view
  is read-only; deleting a receipt removes the `Receipt` + `ReceiptItem`
  rows but leaves Pantry untouched.
- **Out (v1):** duplicate-upload detection. If the user uploads the same
  Aldi photo twice, they get two receipts and two sets of pantry items;
  they can delete the duplicate.
- **Out (v1):** any spending currency other than USD; international
  receipts; multi-store rollups; tax-only or tip-only adjustments. Just
  capture `subtotal`, `tax`, `total` as numbers and move on.

## User flow

1. User is on `/pantry` and clicks **Add from receipt** (sits next to the
   existing **Add item** button).
2. Upload modal: drag/drop a file, click to browse, or paste text into a
   textarea. One affordance per input mode, all in the same modal.
3. Modal switches to a "Reading your receipt…" loading state. Server hits
   `POST /api/receipts/parse`:
   - Photo or HEIC → Claude vision with a structured prompt.
   - Pasted text → Claude with the same structured prompt, text input.
   - PDF → existing `pdfExtraction.ts` text path; if extraction is sparse
     (under N chars per page, threshold TBD during implementation),
     fall back to vision per-page.
4. Server parses Claude's response into a normalized structure:
   `{ store, tripDate, subtotal?, tax?, total, items: [{ rawName,
   parsedName, qty, unit, price?, kind, categoryGuess, locationGuess,
   defaultUnitGuess }] }`.
5. Server fuzzy-matches each food item's `parsedName` against existing
   `Ingredient.name` (case-insensitive contains + abbreviation expansion:
   `ORG` → organic, `WHL` → whole, `GV` → Great Value, `SPNCH` → spinach,
   `BNN` → banana, etc. — list grown over time, kept in code not config).
6. If more than **30%** of food items come back unmatched or low-confidence,
   the server fires a second Claude pass with the existing `Ingredient`
   list as context, asking it to map just the weak ones. Threshold is a
   constant (`PARSE_RESCUE_THRESHOLD`), easy to tune later.
7. Server stashes the parsed-and-matched result in an `importSessions`-
   style cache (15-min TTL) and returns a temp `parseId` plus the full
   structure to the client.
8. Modal renders the **review modal** body (see UX section).
9. User edits anything that's wrong and clicks **Commit X items to
   Pantry**. Client posts to `POST /api/receipts` with the temp `parseId`
   and the user's edits.
10. Server runs the commit transaction (see Commit semantics). On success,
    modal closes; the new receipt appears at the front of the "Recent
    receipts" strip; spending strip updates.
11. On parse failure: modal shows an inline error with "Try a clearer
    photo or paste the text instead."
12. On commit failure: transaction rolls back, modal stays open with an
    error banner, user can retry without losing edits.

## Architecture

### New files

**Server:**
- `server/src/routes/receipts.ts` — REST routes.
- `server/src/services/receiptService.ts` — parse orchestration, fuzzy
  matching, second-pass trigger, commit transaction.
- `server/src/claude/receiptParser.ts` — Claude prompt + response
  schema for the first pass; second-pass prompt for rescue.
- `server/src/claude/ingredientMatcher.ts` — abbreviation expansion table
  + fuzzy match function (case-insensitive contains, scored). Pure, easy
  to unit-test.
- `server/src/__tests__/receiptParser.test.ts` — fuzzy matcher + merge
  logic + weekly aggregation tests.
- `server/prisma/migrations/005_receipts/migration.sql`.

**Client:**
- `client/src/api/receipts.ts` — API wrappers + types.
- `client/src/components/AddFromReceiptModal.tsx` — the upload + review
  modal (single component, two stages: upload, review).
- `client/src/components/RecentReceiptsStrip.tsx` — the horizontal strip
  on Pantry showing last 5 receipts.
- `client/src/components/SpendingStrip.tsx` — the "This week: $X"
  banner above the recent receipts.

### Modified files

**Server:**
- `server/prisma/schema.prisma` — add `Receipt` + `ReceiptItem` models;
  no change to `PantryItem` or `Ingredient`.
- `server/src/index.ts` — register the new `receipts` route.
- `server/src/services/importSessions.ts` — generalize the stash to
  hold an arbitrary parsed payload, not just a PDF path. Today it stores
  `{ pdfPath, expiresAt }`; receipts need to stash a full parsed structure
  plus the source file path. Either widen the stash to `{ payload: any,
  expiresAt }` or add a parallel `receiptParseSessions` map. Decide
  during implementation; simplest is the parallel map (less risk to the
  existing recipe import flow).

**Client:**
- `client/src/pages/Pantry.tsx` — add the **Add from receipt** button,
  mount `<SpendingStrip />` and `<RecentReceiptsStrip />` above the
  existing layout.

### Data model

Two new tables, no changes to existing.

```
Receipt
  id               int  pk
  source           enum ('paste' | 'photo' | 'pdf')
  source_path      string?  -- present for photo/pdf only; relative to media root
  raw_text         string?  -- present for paste; also for PDF after extraction
  store            string
  trip_date        date
  subtotal         decimal?
  tax              decimal?
  total            decimal
  created_at       datetime
  updated_at       datetime

ReceiptItem
  id               int  pk
  receipt_id       int  fk -> Receipt (cascade delete)
  raw_name         string         -- the receipt's literal text
  parsed_name      string         -- Claude's canonical guess
  ingredient_id    int? fk -> Ingredient  -- null until matched/created
  quantity         decimal
  unit             string
  price            decimal?
  kind             enum ('food' | 'non_food' | 'unknown')
  category_guess   IngredientCategory?
  location_guess   PantryLocation?
  is_committed     boolean   -- defaults true on commit; user can un-check rows
```

`PantryItem` stays exactly as it is. No `source_receipt_item_id`.

### Parser pipeline

```
Upload (file or text)
  ↓
POST /api/receipts/parse  ← stash-only, no DB write yet
  ↓
  · photo  → Claude vision with structured prompt
  · text   → Claude with same prompt
  · PDF    → pdfExtraction.ts text path; fallback to vision per-page if sparse
  ↓
Claude returns the normalized structure (above)
  ↓
Fuzzy-match each food item.parsedName against existing Ingredient
  ↓
If > 30% unmatched-or-low-confidence → second Claude pass with the existing
  Ingredient list as context, asking it to map just the weak ones
  ↓
Stash result in importSessions-style cache (15-min TTL), return temp
  parseId + full structure to client
  ↓
Client renders review modal
  ↓
POST /api/receipts  ← actual DB write: Receipt + ReceiptItems + Pantry merges,
                     all in one transaction
```

## Review modal UX

Two stages in one modal: **upload** and **review**.

**Upload stage:**
- Three affordances in one panel:
  - Drag/drop dropzone (file → photo or PDF).
  - "Or paste text from a digital order:" textarea below.
  - Click-to-browse fallback inside the dropzone.
- One submit; the server picks the input mode from what was provided.

**Review stage** (after parse):

- **Header:** store name (editable text input), trip date (editable date
  picker), running total (computed from rows on the fly so the user sees
  it shift if they un-check rows).
- **Body:** scrollable list of food items. Each row:
  - Matched ingredient pill, color-coded by confidence (green = high,
    amber = low). If unmatched, a `+ Create "Baby Spinach"` button that
    opens an inline mini-form pre-filled with the parsed name + category
    guess + default unit guess.
  - Quantity + unit (editable, defaulted from receipt → ingredient default
    unit if matched).
  - Location dropdown (auto-set from `location_guess`; fridge / freezer /
    pantry).
  - Expiration date (optional, blank ok).
  - Price (display only).
  - Per-row remove (×) — equivalent to `is_committed = false`.
- **Non-food section** collapsed by default: `12 non-food items hidden —
  show`. Items still tracked on the receipt (so the total reconciles), just
  not pushed to Pantry.
- **Footer:** Cancel | `Commit X items to Pantry` (X = count of food rows
  not unchecked).

The same modal opens in **read/edit mode** when the user clicks an old
receipt in the Recent strip — header fields editable, item list read-only
in v1 (no item-level edits post-commit).

## Commit semantics

`POST /api/receipts` runs in a single Prisma transaction.

For each `ReceiptItem` where `kind = 'food'` and `is_committed = true`:

1. **Resolve the Ingredient.**
   - If `ingredient_id` is set (matched in review), use it.
   - If not but `parsed_name + category_guess + default_unit_guess` are
     all set, create a new `Ingredient` and use that id. Store the new
     id back on the `ReceiptItem`.
2. **Resolve the PantryItem.** Look for an existing row with
   `(ingredient_id, unit, location)` all matching.
   - **Match found** → increment `quantity`. If the receipt row has an
     expiration earlier than the existing row's, update to the earlier
     date (FIFO bias — the soonest expiration should drive the warning).
   - **No match** → create a new `PantryItem` with the row's qty, unit,
     location, expiration.

The `Receipt` row itself is created in this same transaction (it does not
exist in the DB until commit succeeds — parse stages everything in the
in-memory stash). Non-food rows are persisted on the receipt (so the total
reconciles) but never touch Pantry.

## Error handling

- **Parse failure** → modal shows the error inline with "Try a clearer
  photo or paste the text instead." No DB rows created.
- **Server timeout (Claude slow)** → loading state says ~30s expected.
  Same pattern as recipe import.
- **Mid-commit failure** → transaction rolls back. No `Receipt` or
  `ReceiptItem` rows are created; the parse stash stays valid so the user
  can retry with the same edits.
- **Stash expired (>15 min review)** → modal shows "Parse expired,
  re-running" + auto re-parse from the stashed source file. Free for
  photo/PDF; for paste, the raw text is on the stash so it's still
  recoverable.
- **Duplicate uploads** → no detection in v1.

## Spending rollup

A single endpoint `GET /api/receipts/spending?range=current_week` returns
`{ total, tripCount, weekStart, weekEnd }`. Implementation is one Prisma
query: `SUM(total) WHERE trip_date BETWEEN <weekStart> AND <weekEnd>`.

Week boundaries: **Sunday 00:00 → Saturday 23:59** in the server's local
time zone for v1 (matches typical US grocery shopping cycles). Easy to
parameterize later if needed.

## Testing

**Server-side:**
- Unit: fuzzy matcher with realistic abbreviations (`ORG SPNCH`,
  `GV WHL MILK 1G`, `BNNS`, `BREAD WHEAT`, `2.45 LB BANANAS`).
- Unit: merge logic — same `(ingredient, unit, location)` increments;
  mismatched unit creates separate row; expiration FIFO update.
- Unit: weekly aggregation SQL with timezone edge cases (Sun 11:59 PM
  trip vs Mon 12:01 AM, daylight-saving boundaries).
- Unit: second-pass trigger — exactly at, above, and below the 30%
  threshold; verify the prompt only includes the weak items.
- Integration: parse fixture → commit → assert `PantryItem` rows +
  `Receipt` row in expected state.
- Fixtures: a real Walmart text dump, a real Aldi photo (or hand-typed
  approximation if photo isn't available), one with non-food mixed in.

**Client-side:** smoke-test only, matching the project's existing pattern.
No new test infrastructure.

## Open questions deferred to implementation

- Exact PDF-extraction sparseness threshold for the vision fallback.
- The full abbreviation expansion table starts small and grows as we hit
  real receipts. No need to enumerate it in the spec.
- Confidence scoring for the fuzzy matcher: simplest workable approach
  (e.g., normalized edit distance threshold) during implementation; the
  review UI just colors green vs amber based on a single boolean.
