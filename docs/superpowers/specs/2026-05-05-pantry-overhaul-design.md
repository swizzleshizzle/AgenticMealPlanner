# Pantry Overhaul — Design Notes

**Date:** 2026-05-05
**Status:** Draft. Awaiting user review before implementation plan.
**Trigger:** The current Pantry page is a status display, not a manager.
One flat row per ingredient, single quantity / unit / expiration, no batches,
no edit-in-place beyond quantity, naive deduction with no unit awareness, and
no way to add anything that isn't already a known Ingredient. Receipts can
push items in, but once they're in there's no real way to manage them. The
overhaul turns Pantry into a managed inventory with per-batch tracking,
smarter units, custom items, active stock signals, and full edit affordances.

## Scope

- **In:** per-batch tracking under one card per ingredient, with a
  side-panel drawer for batch detail and edits.
- **In:** unit conversion engine ("B+") — same-type conversions always
  work; cross-type conversions work when the ingredient has a density
  (g/mL) or per-count weight set. Optional fields, fillable as needed.
- **In:** custom items added directly from the Pantry page. Default flow
  creates a real Ingredient row; opt-in toggle marks it `isOneOff` so it
  won't pollute receipt matching or recipe pickers.
- **In:** card-level edits (apply to all future batches: name, category,
  defaults, density, shelf-life, low-stock threshold) and batch-level
  edits (apply to one batch: qty, unit, location, expiration, purchase
  date, cost, tags).
- **In:** "running low" pill on the card and a nudge in the active week's
  shopping list when total drops below `lowStockThreshold`.
- **In:** soft-delete consumed batches with a 30-day retention window and
  a toast-with-Undo affordance for accidental deletes / wrong-meal-cooked.
- **In:** receipt commit creates one batch per receipt line, carrying
  `purchaseDate` and `costAtPurchase` from the receipt.
- **In:** unified-grid layout with filter chips (location, category),
  search, and sort (name, expiring-soonest, recently-added, low-stock).
- **Out (v1):** vetted ingredient density library. User fills densities
  in as needed; UI prompts when a cross-type conversion is needed and the
  density is missing.
- **Out (v1):** consumption analytics dashboards. The data model
  supports them (cost & purchase date on every batch, soft-delete
  history) but no charts ship in v1.
- **Out (v1):** barcode scanning, multi-pantry / multi-household, mobile
  app surfaces beyond responsive web.
- **Out (v1):** automatic shopping-list population (full-auto mode). The
  shopping list nudge is opt-in via a "running low" section with one-tap
  add; nothing appears on the list without user consent.
- **Out (v1):** category churn. Existing 9 `IngredientCategory` values
  stay as-is.

## Decisions log

Locked decisions from brainstorming. Each maps to a clarifying-question
choice; recording them here so future-me can remember why.

| # | Decision | Rationale |
|---|----------|-----------|
| Q1 | One card per ingredient, expand to batches (drawer) | Scannable as pantry grows; mirrors how the user thinks ("do I have milk?") |
| Q2 | B+ unit system: same-type free, cross-type via optional density | Same-type math is trivial; cross-type pays for itself when needed without upfront density curation |
| Q3 | Custom items default to creating real Ingredient; opt-in `isOneOff` flag | Most "custom" items should be reusable; one-off escape hatch for leftovers and gifts |
| Q4a | Card-level vs batch-level edit split (see data model) | Edits to "the ingredient itself" vs "this specific batch" are conceptually different |
| Q4b | Tags on batches, with presets + custom | Searchable, flexible, replaces a free-text notes field for most cases |
| Q5 | Two same-receipt + same-ingredient items create separate batches | Per-batch tracking is the whole point; merging silently undermines it |
| Q6a | Recipe deduction: FEFO with "use first" tag override | Honors the explicit tag, no invisible heuristics |
| Q6b | Soft-delete consumed batches; 30-day purge | Cheap insurance for "wrong meal cooked"; doesn't grow forever |
| Q7 | Unified grid with location-as-filter (not as layout dimension) | Pantry is a *manager* now; search/sort/filter are first-class |
| Q7b | Side-panel drawer for batch detail + edits | Forms have room; grid context preserved |
| Q8a | Keep existing 9 categories | Out of scope for this overhaul |
| Q8b | "Running low" → display pill + opt-in shopping-list nudge | Helpful without being bossy |
| Q8c | Carry `purchaseDate` and `costAtPurchase` from receipt to batch | Cheap to add now, expensive to backfill later |
| (added) | Toast with Undo, no delete confirmation modal | Modals are friction on every delete; undo handles the rare actual mistake |

## Data model

### `Ingredient` — additive changes

```prisma
model Ingredient {
  // ...existing fields...
  defaultLocation        PantryLocation?  // routes receipts; nullable
  densityGPerMl          Float?           // nullable, B+ cross-type
  gramsPerCount          Float?           // nullable, e.g. egg ~50
  shelfLifeFridgeDays    Int?             // suggests expiration on add
  shelfLifeFreezerDays   Int?
  shelfLifePantryDays    Int?
  lowStockThreshold      Float?           // in lowStockUnit
  lowStockUnit           String?          // unit the threshold is in
  isOneOff               Boolean @default(false)
}
```

`isOneOff = true` rows still live in the Ingredient table (we need the
FK), but they're excluded from receipt fuzzy-matching, recipe ingredient
pickers, and any "browse ingredients" surface.

### `PantryItem` → conceptually `PantryBatch`

Keep table name `pantry_items` for migration ease; rename the Prisma
model to `PantryBatch` (and update all code references). Each row is one
batch of one ingredient.

```prisma
model PantryBatch {
  id              Int             @id @default(autoincrement())
  ingredientId    Int             @map("ingredient_id")
  quantity        Float
  unit            String
  location        PantryLocation
  expirationDate  DateTime?       @map("expiration_date")
  purchaseDate    DateTime?       @map("purchase_date")     // NEW
  costAtPurchase  Decimal?        @db.Decimal(10, 2) @map("cost_at_purchase")  // NEW
  tags            String[]        @default([])              // NEW
  receiptItemId   Int?            @map("receipt_item_id")   // NEW; optional link
  consumedAt      DateTime?       @map("consumed_at")       // NEW; soft-delete marker
  createdAt       DateTime        @default(now()) @map("created_at")
  updatedAt       DateTime        @updatedAt @map("updated_at")

  ingredient   Ingredient   @relation(fields: [ingredientId], references: [id])
  receiptItem  ReceiptItem? @relation(fields: [receiptItemId], references: [id])

  @@index([ingredientId, location, consumedAt])
  @@index([consumedAt])  // for the 30-day purge job
  @@map("pantry_items")
}
```

`ReceiptItem` gets a back-relation `pantryBatches PantryBatch[]` (one
receipt line can produce one batch — the relation is FK, not array — but
Prisma needs the back-side declared).

### Tag presets

Tag values are free strings; the UI offers a fixed set of preset chips
that map to canonical strings, plus a "custom tag" input.

| Preset chip | Stored value | Special behavior |
|-------------|--------------|------------------|
| Use first   | `use_first`  | Bumps batch to front of FEFO queue |
| Opened      | `opened`     | Display only |
| Thawing     | `thawing`    | Display only |

Custom tags are arbitrary lowercase strings, no special behavior.

### Unit conversion — code, not DB

A static `server/src/lib/units.ts` module:

- Canonical bases: `g` (mass), `mL` (volume), `count`.
- Conversion table within each type: `lb=453.592 g`, `oz=28.3495 g`,
  `cup=236.588 mL`, `tbsp=14.787 mL`, `tsp=4.929 mL`, `fl_oz=29.574 mL`,
  `mL=1 mL`, `L=1000 mL`, `g=1 g`, `kg=1000 g`, `count=1 count`.
- `convert(value, fromUnit, toUnit, ingredient?)`:
  - same-type: trivial scalar division.
  - cross-type mass↔volume: requires `ingredient.densityGPerMl`.
  - cross-type count↔mass: requires `ingredient.gramsPerCount`.
  - cross-type count↔volume: chain through mass (needs both fields).
  - missing data → throw `UnitConversionError` with the missing field name.

`UnitConversionError` is caught at the API layer and surfaced to the
client as a structured error with the conversion details, so the client
can prompt the user to fill in the missing density.

### Card aggregation — computed, not stored

The pantry endpoint groups active (`consumedAt IS NULL`) batches by
`ingredientId` and computes:

```
{
  ingredient: { ...full Ingredient row... },
  batches: PantryBatch[],            // sorted FEFO with use_first first
  totalsByUnit: { unit: string, qty: number }[],   // distinct units
  canonicalTotal: { qty: number, unit: string } | null,
                                     // sum in ingredient.defaultUnit
  partialTotal: boolean,             // true if any batch failed conversion
  soonestExpiration: string | null,
  nextExpirationDays: number | null,
  isLowStock: boolean,
  batchCount: number,
}
```

Never persisted; recomputed on every read. Cheap because pantry rows are
small numbers (hundreds at most).

### Migration

One additive Prisma migration:

1. Add new columns to `ingredients` (all nullable / defaulted).
2. Add new columns to `pantry_items` (all nullable / defaulted).
3. Add the two indexes on `pantry_items`.
4. Rename Prisma model `PantryItem` → `PantryBatch` (Prisma-level rename;
   table stays `pantry_items`).

No data destruction. Existing pantry rows become single-batch instances
of their ingredient automatically — every existing row already *is* a
batch of 1.

## API surface

Routes namespaced under `/api/pantry` (existing) and `/api/ingredients`
(existing).

### Ingredients (extended)

```
GET    /api/ingredients               # extended response: includes new fields
POST   /api/ingredients               # extended body: accepts new fields
PATCH  /api/ingredients/:id           # NEW: partial update for card-level edits
                                      #   (name, category, defaultUnit,
                                      #    defaultLocation, density*, shelfLife*,
                                      #    lowStock*, isOneOff)
```

Card-level edits hit `/api/ingredients`, not `/api/pantry` — they apply
to all future batches.

### Pantry — card-aggregated reads

```
GET    /api/pantry                    # CHANGED: returns aggregated cards
                                      # Query params:
                                      #   ?location=fridge|freezer|pantry
                                      #   ?category=<IngredientCategory>
                                      #   ?q=<search>
                                      #   ?sort=name|expiring|added|lowstock
                                      #   ?showConsumed=false   (default false)
                                      #   ?lowOnly=false
```

Server does the filtering and sorting; client doesn't refilter a flat
list.

### Pantry — batch-level writes

```
POST   /api/pantry/batches            # NEW: create a batch
                                      # body: {
                                      #   ingredientId? | newIngredient: { name, category,
                                      #     defaultUnit, isOneOff, density*, shelfLife*, ... },
                                      #   quantity, unit, location,
                                      #   expirationDate?, purchaseDate?,
                                      #   costAtPurchase?, tags?,
                                      #   receiptItemId?
                                      # }
                                      # If newIngredient: creates Ingredient first,
                                      # honoring isOneOff, then the batch.

PATCH  /api/pantry/batches/:id        # NEW: partial update of one batch

DELETE /api/pantry/batches/:id        # CHANGED: soft-delete (sets consumedAt = now())
                                      # Returns the (now-consumed) row so client
                                      # can show "undo" toast.

POST   /api/pantry/batches/:id/restore # NEW: clear consumedAt (undo soft-delete)
                                       # 404 if older than 30 days (already purged).
```

### Background job

Nightly cron job in the server: `DELETE FROM pantry_items WHERE consumed_at < NOW() - INTERVAL '30 days'`. Implemented with `node-cron` registered in `server/src/index.ts`. Runs at 03:00 local server time (low-traffic).

### Backwards compatibility

Legacy endpoints — `POST /api/pantry`, `PUT /api/pantry/:id`,
`DELETE /api/pantry/:id` — are removed. The only consumer is
`client/src/api/pantry.ts`, which is rewritten as part of this work. No
external API contract.

## UI

### Page layout (unified grid)

```
┌──────────────────────────────────────────────────────────────────┐
│  [12 items on hand]                                              │
│  Pantry              [Add from receipt]  [Add item]              │
│                                                                  │
│  [SpendingStrip]                                                 │
│  [RecentReceiptsStrip]                                           │
│                                                                  │
│  [search ⌕]  [All Locations ▾] [All Categories ▾] [Sort: name ▾] │
│  [Running low only □]                                            │
│                                                                  │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                     │
│  │ Card   │ │ Card   │ │ Card   │ │ Card   │  ...               │
│  └────────┘ └────────┘ └────────┘ └────────┘                     │
└──────────────────────────────────────────────────────────────────┘
```

Cards arranged in a responsive grid (1 col mobile, 2 col md, 3–4 col lg+).
Spending and Recent Receipts strips stay at the top, unchanged.

### Card anatomy

```
┌────────────────────────────────┐
│ [icon]  Milk          [3 batch]│  ← name, batch count
│ Dairy                          │  ← category
│                                │
│ 1.5 gal               [Low]    │  ← canonical total (or partial),
│                                │     low-stock pill if applicable
│ Soonest: 4d           [Fridge] │  ← expiration warn pill,
│                                │     primary location badge
└────────────────────────────────┘
```

- Click card → side-panel drawer opens.
- "Low" pill appears when `isLowStock` is true.
- Expiration pill: ghost when >3d, warn when ≤3d, danger when ≤0d.
- Location badge shows the most-stocked location among active batches; if
  batches span multiple locations, badge says "Mixed" and tapping reveals
  the breakdown in the drawer.
- `partialTotal: true` shows the canonical total with a `~` prefix and a
  small info icon explaining one or more batches couldn't be converted.

### Side-panel drawer

Slides in from the right at 480px width on desktop, full-screen on mobile.

```
┌────────────────────────────────────────┐
│ Milk                              [×]  │
│ Dairy · default unit: gal              │
│                                        │
│ [Edit ingredient ⚙]                    │  ← opens card-level edit form
│                                        │
│ Total on hand: 1.5 gal                 │
│ Soonest expiration: 4d                 │
│ Running low: yes (threshold 1 gal)     │
│                                        │
│ ── Batches (3) ──                      │
│                                        │
│ ┌──────────────────────────────────┐   │
│ │ 1 gal · Fridge · expires 4d      │   │
│ │ [use first]                      │   │
│ │ Bought 4/30 · $4.29              │   │
│ │ [Edit] [Delete]                  │   │
│ └──────────────────────────────────┘   │
│ ... more batches ...                   │
│                                        │
│ [+ Add another batch of Milk]          │
└────────────────────────────────────────┘
```

- Batch card shows qty/unit, location, expiration, tags, purchase info.
- "Edit" inline-expands the batch row into a form (no nested drawer).
- "Delete" soft-deletes and triggers a toast at the page level with
  Undo (10s).
- "Edit ingredient" opens a separate inline form at the top of the
  drawer for card-level fields (defaults, density, shelf-life, threshold).
- "Add another batch" opens an inline form, pre-filled with the
  ingredient's defaults.

### Add item flow

Top-right "Add item" button opens a modal (not the drawer — drawer is
ingredient-specific). Modal has two paths:

1. **Existing ingredient** (default tab): typeahead/search the
   Ingredient table; selecting one shows a batch-add form pre-filled
   with that ingredient's defaults (location, unit, suggested
   expiration based on shelf-life).
2. **New ingredient**: free-text name; the form expands to include
   category, default unit, default location, optional shelf-life, and
   an "isOneOff" toggle. On submit, creates Ingredient + batch in one
   request (`POST /api/pantry/batches` with `newIngredient`).

### Receipt commit (existing flow, adjusted)

`AddFromReceiptModal` already exists. Changes:

- When committing, each receipt line creates one batch
  (`POST /api/pantry/batches` with `receiptItemId`).
- `purchaseDate` ← receipt's `tripDate`.
- `costAtPurchase` ← receipt item's `price`.
- `expirationDate` ← `tripDate + ingredient.shelfLifeXDays` for the
  chosen location, if shelf-life is set; otherwise null.
- The review modal shows the suggested expiration with a per-line
  override.

### Recipe deduction (existing service, adjusted)

`deductIngredientsForMeal` is rewritten to use the conversion engine and
batch ordering:

1. For each recipe ingredient `(ingredientId, quantityNeeded, unit)`:
2. Convert `quantityNeeded` to the ingredient's canonical base unit.
3. Find active batches for that ingredient, ordered by:
   - `tags` contains `use_first` (true first)
   - then `expirationDate` ASC NULLS LAST (FEFO)
4. For each batch in order: convert the batch's quantity to canonical;
   subtract; if exhausted, set `consumedAt = now()` (soft-delete);
   continue to the next batch with the remainder. Cross-type
   conversion failures bubble up as a `UnitConversionError` and abort
   the deduction with a structured error so the cooked-meal flow can
   show the user what's missing.
5. If pantry runs out before the recipe is satisfied, mark the meal
   cooked anyway but flag the shortfall in the response (caller decides
   what to surface).

Soft-deleted batches reverse cleanly via `/restore` if the user
mismarks a meal.

## Error handling

- **Cross-type conversion missing density.** Server returns
  `409 Conflict` with `{ code: "DENSITY_MISSING", ingredientId, fromUnit,
  toUnit, missing: "densityGPerMl" | "gramsPerCount" }`. The client
  catches this on add-from-recipe-deduction or on manual
  unit-of-display change and shows an inline prompt to fill in the
  missing field on the Ingredient.
- **Restore past 30-day window.** `404 Not Found`. Client toast: "That
  batch is past the recovery window."
- **Soft-delete during deduction race.** Atomic via Prisma transaction
  in the deduction service; pantry endpoint reads with `consumedAt IS
  NULL` so a partially-failed deduction doesn't leak phantom batches.
- **One-off ingredient orphan.** When the last batch of an `isOneOff`
  Ingredient is purged (after 30 days post-soft-delete), the Ingredient
  row stays but is hidden from all UI surfaces. A future cleanup job
  can prune zero-batch one-offs but it's not v1.
- **Quantity goes negative on edit.** Server clamps to 0 and treats as
  soft-delete (sets `consumedAt`). UI prevents this via `min={0}` but
  belt-and-suspenders on the server.

## Testing

- **Unit conversion table:** unit tests for every same-type pair,
  plus golden cases for cross-type (1 cup flour @ 125 g/cup → grams,
  3 eggs @ 50 g/count → grams, etc.) and the missing-data error path.
- **Card aggregation:** test that a 3-batch ingredient produces correct
  `totalsByUnit`, `canonicalTotal`, `partialTotal=true` when one batch
  has incompatible units, and `soonestExpiration` from the min batch.
- **FEFO + use_first:** integration test of `deductIngredientsForMeal`
  with a use_first-tagged batch and an older non-tagged batch — tagged
  one drains first.
- **Soft-delete + restore:** delete → row hidden → restore → row
  visible. Past-window restore returns 404.
- **Receipt commit:** a 3-line receipt produces 3 separate batches with
  `purchaseDate=tripDate` and `costAtPurchase=price`.
- **Manual UI smoke:** add custom item (both ingredient-creating and
  isOneOff paths), edit ingredient defaults, edit a batch, soft-delete
  + Undo, deduct via cooked meal, search/sort/filter combinations.

## Out-of-scope cleanup tracked here

These show up as obvious adjacent improvements but stay out of v1:

- A vetted seed of common ingredient densities (flour, sugar, rice,
  oil, etc.). Worth a follow-up doc; not a blocker — user fills as
  needed.
- A "consumed history" view (showing the last 30 days of soft-deleted
  batches with their cost) for spending insight. Data is captured;
  surface is not.
- Auto-suggesting `lowStockThreshold` based on consumption history
  once the soft-delete log has enough data.
- Migrating `Meal.tags` and `PantryBatch.tags` to a shared tag table.
  Both are `String[]` today; consistency is fine.

## Open questions for review

- **Drawer width** (480px) and **mobile behavior** (full-screen) — set
  by convention; happy to adjust if you want different breakpoints.
- **Tag preset list** (`use_first`, `opened`, `thawing`) — easy to
  extend at any time. Want any others on day 1? `frozen` (the location
  exists but you might tag a fridge batch as "frozen by mistake")?
  `expired` for things you're not sure about?
- **Cron schedule** for the 30-day purge — picked 03:00 server time
  arbitrarily.
- **Display partial-total prefix** — used `~` (e.g. `~1.5 gal`). Could
  be a small icon instead.
