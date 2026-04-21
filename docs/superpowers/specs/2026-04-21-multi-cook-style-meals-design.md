# Multi-Cook-Style Meals — Design Notes

**Date:** 2026-04-21
**Status:** Draft for discussion. Not implemented.
**Trigger:** User noted that some meals are reasonable to cook either fresh
or as batch-prep, but the current data model forces one. The per-plan
override (Cook style toggle in the planner edit modal) already lets the
user override on a single planned occurrence — the question here is how to
represent the underlying capability of the recipe itself.

## What works today (no change needed)

- `PlannedMeal.isPrep` is a boolean independent of the parent `Meal.mealType`.
- The edit modal added in `feat(planner): manual edit modal for planned meals`
  (commit `07ccf43`) lets the user flip a single planned meal between
  Cook fresh ↔ Batch prep with one click. So **per-plan-occurrence override
  is already supported**.
- The recipe library card and detail page both display `meal.mealType` as
  the default tag (Batch Prep / Cook Fresh pill), but planned meals on the
  Planner display `pm.isPrep` (the per-plan flag) — already correct.

## What this doc is about

The recipe LIBRARY view, the recipe DETAIL view, and the AI auto-generator
all key off `Meal.mealType` — a single enum value. There's no way to mark
a recipe as "works equally well either way" or to filter the library by
"recipes I could batch-cook this Sunday".

Concrete user stories that aren't currently expressible:

1. "Show me everything I could batch-cook for this week" — today, only
   `mealType = batch_prep` recipes show up; cook-fresh recipes that ARE
   actually batch-friendly are invisible.
2. "I tagged Chicken Penne al Limone as cook-fresh but tonight I want to
   make a double batch and stash leftovers" — works via the per-plan
   toggle, but the recipe library still presents it as cook-fresh-only.
3. "When auto-generating a plan, prefer batch-prep recipes for Sunday"
   — currently the generator picks from `mealType = batch_prep`. Recipes
   that are batch-capable but tagged fresh are excluded.

## Current schema

```prisma
enum MealType {
  batch_prep
  cook_fresh
}

model Meal {
  mealType MealType @map("meal_type")
  // ...
}

model PlannedMeal {
  isPrep Boolean @default(false) @map("is_prep")
  // ...
}
```

## Design options

### Option A — Replace `mealType` with two booleans

```prisma
model Meal {
  canBatch Boolean @default(false) @map("can_batch")
  canFresh Boolean @default(true)  @map("can_fresh")
  // mealType column dropped
}
```

A recipe asserts both capabilities independently. UI shows multiple pills
when both true. Auto-generator filters by `canBatch` or `canFresh` as the
slot demands.

**Pros:**
- Symmetric, no implicit "primary".
- Backfill is trivial: `canBatch = (mealType = 'batch_prep')`,
  `canFresh = (mealType = 'cook_fresh')`. Migration is two columns + a one-line
  UPDATE.
- Filtering becomes natural: `WHERE can_batch = true`.

**Cons:**
- Loses the "primary" affordance — when both are true, the UI must pick
  one to show by default. (Probably fine: show "Both" as a third pill state.)
- Existing code paths that read `meal.mealType` break — every consumer
  needs an update.

### Option B — Keep `mealType` as primary, add a `dualMode` boolean

```prisma
model Meal {
  mealType MealType @map("meal_type")        // primary tag
  dualMode Boolean  @default(false) @map("dual_mode")  // also works the other way
}
```

`mealType` stays as the primary intent (what it's "designed" for); `dualMode`
opts in to the alternative. AI generator can pick a `cook_fresh` recipe for a
batch slot if `dualMode = true`.

**Pros:**
- Smallest schema delta — one new nullable column.
- Existing code that reads `meal.mealType` keeps working unchanged.
- Backwards compatible: `dualMode = false` is the current behavior.

**Cons:**
- Asymmetric — a meal that's truly equally good either way still has an
  arbitrary primary. UI tagging gets weird ("primarily Cook Fresh, also
  works as Batch Prep" is a mouthful).
- Doesn't generalize cleanly if a third mode ever appears.

### Option C — Drop `Meal.mealType` entirely

`mealType` becomes implicit from `PlannedMeal.isPrep` only. The recipe has
no canonical mode; it's just a recipe. The user (or AI) decides per
planned occurrence.

**Pros:**
- Simplest data model — one fewer concept.
- Maximally flexible.

**Cons:**
- Loses useful taxonomy in the recipe library. "Browse my batch-friendly
  recipes" requires re-deriving from past usage or guessing from the recipe
  itself.
- AI auto-generator has nothing to bias on, so plans become less coherent.
- User did the work to tag every recipe with `mealType` already; throwing it
  away is wasteful.

### Option D — Recommended: Option A with a "primary" hint kept derivable

Two booleans (`canBatch`, `canFresh`), with a derived UI rule:

- If `canBatch && !canFresh` → "Batch prep" pill
- If `canFresh && !canBatch` → "Cook fresh" pill
- If both → "Either" pill (or two pills — TBD)
- If neither → invalid state, treat as fresh

The "primary" question goes away; the UI just shows what's true. The AI
generator filters by capability.

## Recommendation

Go with **Option A (= Option D minus the bikeshed)**. Two booleans, default
`canFresh = true` (matches current behavior for new manual recipes),
backfill from existing `mealType` enum, then drop the enum.

### Migration sketch

```sql
ALTER TABLE meals
  ADD COLUMN can_batch BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN can_fresh BOOLEAN NOT NULL DEFAULT true;

UPDATE meals SET
  can_batch = (meal_type = 'batch_prep'),
  can_fresh = (meal_type = 'cook_fresh');

-- Defer enum drop to a follow-up migration after consumers are updated.
```

### Code surfaces that need updating

Roughly in order of how many lines each touches:

1. **Server: `mealService.ts`** — accept `canBatch` / `canFresh` on create/update.
2. **Server: `mealPlanner.ts` (Claude prompt)** — switch from "filter by mealType"
   to "include capability tags in the prompt context, ask Claude to pick
   batch-able recipes for batch slots".
3. **Server: `recipeParser.ts` (Claude PDF parser)** — Claude currently sets
   `mealType` from the PDF. Switch to setting `canBatch`/`canFresh` heuristically:
   meals with explicit "freezer-friendly" / "make-ahead" / "great for
   leftovers" cues → `canBatch = true`. Most are `canFresh = true` by default.
4. **Client: `Meal` type** — add the two booleans, drop `mealType` (eventually).
5. **Client: `MealCard.tsx`, `RecipeDetail.tsx`, `Planner.tsx` library views** —
   tag rendering becomes capability-driven. Filter chip on `/recipes` for
   "batch-able" / "fresh-cook" / "both".
6. **Client: `MealForm.tsx`** — replace radio with two checkboxes.
7. **Auto-generator integration** — when picking for a "batch slot" (e.g.
   Sunday dinner), require `canBatch`. When picking for a fresh slot, require
   `canFresh`. Recipes with both are eligible for either, biasing toward
   variety.

### What stays unchanged

- `PlannedMeal.isPrep` — already per-occurrence, independent of the recipe's
  capabilities. Keep as-is.
- The Cook style toggle in the Planner edit modal — already works.
- Existing `mealType` data (it's just the source for the backfill).

## Open questions

- **Default for new manual recipes:** `canFresh = true, canBatch = false` is
  the safer default. Easier to opt in than to discover a bad batch.
- **PDF parser heuristics:** does Claude reliably catch "freezer-friendly"
  cues? May need a prompt iteration. Could also defer and let the user
  toggle `canBatch` after import.
- **AI auto-generator behavior on dual-mode meals:** straight 50/50 random,
  or weighted by user's historical pick rate? Probably random until we have
  data.
- **UI:** "Either" as a single pill, or both pills shown together? Vote for
  both pills (clearer signal).

## Out of scope

- Macro/serving adjustments based on cook style. (Whether a batch portion
  is sized differently from a fresh portion is a separate concern; the
  `servings` field on PlannedMeal already covers it.)
- Per-week capability overrides on a recipe ("this week we're treating it
  as batch even though it's not normally"). The per-plan `isPrep` already
  handles that.
- Cooking instructions diverging by style. If a recipe truly cooks
  differently when batched vs fresh, that's a separate "method" field — not
  in this design.
