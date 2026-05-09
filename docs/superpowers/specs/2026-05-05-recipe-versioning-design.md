# Recipe Versioning, Variants, Archive, and Manual Create — Design

**Date:** 2026-05-05
**Status:** Draft for implementation.
**Trigger:** Recipes today are write-once: they can be imported (PDF / image
/ text) but not edited or created from scratch. The user wants the ability
to refine an imported recipe (e.g., swap homemade sauce for a premade jar)
without losing the original, fork meaningful variants (e.g., turkey vs.
pork), archive recipes that are no longer in rotation, and create recipes
manually with a full builder.

## Goals

1. Edit any recipe in-place, with explicit affordances to **save as a new
   version** (linear supersede) or **save as a variant** (sibling fork).
2. Archive recipes at three granularities: an individual variant, a single
   superseded version (auto on supersede), or an entire family.
3. Auto-archive the previous version on supersede so it stops appearing in
   the Recipes list and the auto-planner's candidate pool.
4. Preserve the historical accuracy of past `PlannedMeal` rows: a meal
   already cooked must always render as the version it was cooked from.
5. Apply recipe edits *forward only* to upcoming planned cooks: when a user
   re-runs the shopping list for a future week, future cooks pick up the
   new ingredients automatically. The shopping list does not auto-regen on
   edit; users regen explicitly.
6. Create new recipes from a blank editor surface (manual create), reusing
   the same editor component as the edit/variant flows.
7. An archive page lets users see archived families and variants and
   restore them.

## Non-goals (deferred to later branches)

- AI-assisted "build a recipe from an idea" generation.
- Diff visualization between versions (no v1↔v2 highlight UI).
- Per-version notes or changelog field.
- Cross-family merging or splitting (e.g., promoting a variant to its own
  family).
- Automatic shopping-list regen on supersede. The user explicitly chose
  explicit regen — supersede must not silently rewrite existing plans'
  shopping outputs.
- DB-level enforcement of the "exactly one default per family" invariant.
  Service-layer transactions enforce it; we do not add partial-unique
  indexes or check constraints in this branch.

## Decisions made during brainstorming

These are recorded so future readers don't relitigate them.

1. **Versioning model: hybrid (linear default + variant fork).** The
   common case is "edit, supersede" — that's a one-button action that
   archives the old version. The forking case ("turkey vs. pork") is
   expressed as a sibling variant under the same family.
2. **Past-plan resolution: split by status.** A `PlannedMeal` with status
   `cooked`, `skipped`, or `swapped` resolves to the exact version row it
   was made with (frozen — anything that already happened is history). A
   `PlannedMeal` with status `planned` resolves to the family's *current*
   default variant, so future cooks automatically pick up improvements.
3. **Edit semantics: edit-in-place by default; explicit "Save as new
   version" / "Save as variant".** Most edits are corrections (typo, unit
   fix, swap an ingredient) and should not pollute version history.
   Versioning is a deliberate act.
4. **List grouping: one card per family.** Default variant only. Variants
   live behind chips on the recipe detail page. Auto-planner picks the
   family's default variant.
5. **Data shape: extend `meals`, no new family table.** `PlannedMeal.mealId`
   already points at a row, and "cooked freezes / planned floats" needs
   exactly that. Adding columns to `meals` keeps existing FKs and read
   paths intact.

## Data model

### Schema change (`server/prisma/schema.prisma`)

Add five columns to the `Meal` model:

```prisma
model Meal {
  id Int @id @default(autoincrement())
  // ... existing fields unchanged ...

  recipeId      Int      @map("recipe_id")
  versionNumber Int      @default(1) @map("version_number")
  parentMealId  Int?     @map("parent_meal_id")
  isDefault     Boolean  @default(true) @map("is_default")
  archivedAt    DateTime? @map("archived_at")

  parent   Meal?  @relation("MealSupersede", fields: [parentMealId], references: [id])
  children Meal[] @relation("MealSupersede")

  @@index([recipeId])
  @@index([recipeId, archivedAt, isDefault])
  @@map("meals")
}
```

Field semantics:

- **`recipeId`** — family identifier. On first insert of a brand-new
  recipe family, set `recipe_id = id` (one post-insert update; no
  separate sequence). All versions and variants of that family share the
  same `recipe_id`.
- **`versionNumber`** — position within a supersede chain. Starts at 1.
  Increments by 1 on every "Save as new version" within the same chain.
  Each variant is its own chain and starts at 1.
- **`parentMealId`** — the row this row superseded. Null for v1 of any
  chain (including new variants and brand-new families).
- **`isDefault`** — exactly one row per family is the active default
  (where `archivedAt IS NULL`). The default is what the Recipes list
  shows, what the auto-planner picks, and what `planned` PlannedMeals
  resolve to.
- **`archivedAt`** — soft-archive timestamp. Archived rows are hidden
  from the Recipes list, the auto-planner candidate pool, and the
  "Add to plan" picker. They remain readable so past `PlannedMeal` rows
  continue to render correctly.

### Invariants (enforced in `mealService`)

These are transactional invariants enforced in the service layer, not
DB constraints:

- Within a `recipe_id`, **exactly one row** has `is_default = true AND
  archived_at IS NULL`.
- A **supersede** is one transaction: insert new row with the next
  `version_number` in the same chain, `parent_meal_id = old.id`,
  `is_default = true`, copies `recipe_id`; then `UPDATE old SET
  is_default = false, archived_at = now()`.
- A **variant** is one insert: `version_number = 1`, `parent_meal_id =
  null`, `is_default = false`, copies `recipe_id`. Existing default is
  not touched.
- **Family-archive** is `UPDATE meals SET archived_at = now() WHERE
  recipe_id = X AND archived_at IS NULL`.
- **Variant-archive** is `UPDATE meals SET archived_at = now() WHERE
  id = X`. If the archived row was the default and at least one other
  active variant exists in the family, the most-recently-updated active
  variant is promoted to default in the same transaction.
- **Unarchive** clears `archived_at`. Does not promote to default;
  user can explicitly set default afterwards.

### Indexes

- `meals(recipe_id)` — family fan-out lookups.
- `meals(recipe_id, archived_at, is_default)` — "give me each family's
  current default" composite.

## Read paths

### Recipes list (`mealService.getAllMeals`, `Recipes.tsx`)

Filter changes from "all meals" to "default variant of each family with
at least one active variant":

```sql
WHERE is_default = true AND archived_at IS NULL
ORDER BY name
```

Each card additionally exposes a `variantCount` (count of sibling rows
where `recipe_id = X AND archived_at IS NULL`). When > 1, the card shows
a small "N variants" pill.

### Recipe detail (`mealService.getMealById`, `RecipeDetail.tsx`)

`getMealById` returns the specific row asked for, **without** an archive
filter — past `PlannedMeal` rows depend on archived rows being readable.
The detail page additionally fetches the family siblings (active only) to
render the variant chips at the top.

New API: `GET /api/meals/:id/family` returns active variants of the
family of the given meal (used by detail-page chips and the editor's
variant pre-fill).

### Add-to-plan picker

Same filter as the Recipes list: only active default variants are
selectable.

### Archive page (`/recipes/archived`)

New API: `GET /api/meals/archived` returns archived rows grouped by
family. Two visible sections:

- **Archived recipes** — families where every active row is archived
  (or all rows are archived). One card per family, showing the most
  recently active default's name/photo.
- **Archived variants** — non-default variants archived under families
  that still have active variants. Listed under their family's name.

Each entry has an "Unarchive" action that clears `archived_at`. After
unarchiving an entire family, the most-recently-updated row in that
family that previously held `is_default = true` is restored to default.
Unarchiving a single variant does not promote it; user can set default
explicitly via the detail page.

## Editor

One `RecipeEditor` component, used by three URLs.

### Entry points

| URL | Mode | Save buttons |
|---|---|---|
| `/recipes/new` | Blank create | **Save** (creates new family) |
| `/recipes/:id/edit` | Edit existing | **Save** / **Save as new version** / **Save as variant** |
| `/recipes/:id/variant` | Pre-filled fork | **Save as variant** |

The variant URL deep-links into "create variant from this row" — the
editor loads with a copy of the source row's data and locks the save
mode. The dedicated URL keeps the back-button behavior natural and lets
the user cancel without leaving an in-flight edit on a different row.

### Save modes (in edit mode)

| Button | DB effect |
|---|---|
| **Save** | `UPDATE` the current row in place. `updated_at` bumps. No new row. |
| **Save as new version** | One transaction: insert new row in family with `version_number = old.version_number + 1`, `parent_meal_id = old.id`, `is_default = true`; `UPDATE old SET is_default = false, archived_at = now()`. |
| **Save as variant** | Insert new row in same family with `version_number = 1`, `parent_meal_id = null`, `is_default = false`. |

Save and Save-as-* enable only when the form is dirty (a real diff vs.
the loaded state). This prevents accidental no-op v2s.

### Form fields

The editor exposes everything `Meal` already stores:

- Name, description, optional source URL.
- Ingredients — typeahead against the existing `Ingredient` pool with a
  "Create new ingredient" fallback that upserts (same pattern as the
  import path: `prisma.ingredient.upsert` keyed by name).
- Instructions — ordered list with add / reorder / delete.
- Batch / fresh capability flags (`canBatch`, `canFresh`).
- Servings, prep time, cook time, tags (free-form chips).
- Optional nutrition (calories, protein, carbs, fat, fiber, sodium).
- Optional photo replacement — the existing `replaceMealPhoto` flow
  continues to work per-row.

### Asset inheritance

When **Save as new version** or **Save as variant** creates a new row,
the photo and PDF are **copied** to the new meal's storage directory.
This keeps the existing `mealService` storage layout (`storage/meals/:id/`)
uniform — no special "shared asset" mode — and avoids foot-guns where
deleting v1 would orphan v2's image. PDF and JPG copies are cheap.
Implementation: a new `mealService` helper (`copyAssetsToNewMeal(srcId,
dstId)`) runs inside the same transaction as the new-row insert, using
the existing `mealThumbPath` / `mealPdfPath` / `ensureMealDir` helpers.

If the user replaces the photo or PDF on the new row, only the new row
is affected (current behavior).

### Recipe detail affordances

- **Variant chips** at the top of the detail page when the family has
  > 1 active variant. Default chip first; siblings ordered by name.
  Switching chips swaps the visible variant in place (no full nav).
- **Edit** button → `/recipes/:id/edit` for the currently-shown variant.
- **Create variant** button → `/recipes/:id/variant`.
- **Overflow menu**:
  - **Set as default** (variant-level) — flips `is_default`
    transactionally: clears the current default's flag, sets this row's.
    Disabled if this row is already the default.
  - **Archive variant** — sets `archived_at = now()` on this row. If it
    was the default and at least one other active variant exists, the
    most-recently-updated active sibling is promoted to default in the
    same transaction.
  - **Archive recipe** (family-level) — confirmation dialog ("Archive
    this recipe and all N variants?"); on confirm, archives every
    active row in the family.

## Auto-planner

`mealPlanner.ts` and `mealPlannerRules.ts` build their candidate pool
from the meals table. The candidate query gains the same filter as the
Recipes list:

```sql
WHERE is_default = true AND archived_at IS NULL
```

Effects:

- Archived families are invisible to auto-pick.
- Non-default variants are invisible to auto-pick. (To make a sibling
  variant pickable, the user sets it as default.)
- The `canBatch` / `canFresh` capability flags continue to filter the
  pool as today.

No other changes to the auto-planner — it operates on whatever default
variants exist, oblivious to the family structure.

## Shopping list

`shoppingService.ts` is the place the "split by status" rule pays off.
When a plan's shopping list is computed:

1. For each `PlannedMeal pm` in the plan:
   - If `pm.status` is `cooked`, `skipped`, or `swapped`: use `pm.mealId`
     directly. Frozen — already happened.
   - If `pm.status` is `planned`: resolve to the family's current default
     variant:
     ```sql
     SELECT * FROM meals
     WHERE recipe_id = (SELECT recipe_id FROM meals WHERE id = pm.meal_id)
       AND is_default = true
       AND archived_at IS NULL
     ```
     If no row matches (the entire family was archived since the meal
     was planned), fall back to `pm.mealId` and surface a small "stale"
     hint in the planner UI.
2. Sum ingredients off the resolved version, as today.

The shopping list **does not auto-regen** on supersede. Existing shopping
lists stay frozen until the user explicitly regens. (Per user: "we don't
just accidentally go grocery shopping.")

## Past planned-meal display (Planner UI)

A `PlannedMeal` referencing an archived row continues to render that
row's name / ingredients / photo. Add a small "archived" indicator pill
next to the meal name when the resolved version is archived, so the user
knows why this meal isn't in the active list anymore.

## Migration `007_recipe_versioning`

```sql
-- forward
ALTER TABLE meals
  ADD COLUMN recipe_id      int,
  ADD COLUMN version_number int NOT NULL DEFAULT 1,
  ADD COLUMN parent_meal_id int REFERENCES meals(id),
  ADD COLUMN is_default     boolean NOT NULL DEFAULT true,
  ADD COLUMN archived_at    timestamp;

UPDATE meals SET recipe_id = id;

ALTER TABLE meals ALTER COLUMN recipe_id SET NOT NULL;

CREATE INDEX meals_recipe_id_idx ON meals (recipe_id);
CREATE INDEX meals_recipe_lookup_idx
  ON meals (recipe_id, archived_at, is_default);
```

After this migration: every existing meal is its own family (recipe_id
= id), at v1, default, not archived. Existing `PlannedMeal` rows
continue to point at valid `meals.id` values, which now coincide with
their `recipe_id`.

## API surface (additions / changes)

- `POST /api/meals/:id/version` — Save as new version. Body: same shape
  as `PUT /api/meals/:id`. Returns the new meal row.
- `POST /api/meals/:id/variant` — Save as variant. Body: same shape.
  Returns the new meal row.
- `GET /api/meals/:id/family` — active variants of the family.
- `GET /api/meals/archived` — archived rows grouped by family.
- `POST /api/meals/:id/unarchive` — clears `archived_at`.
- `POST /api/meals/:id/set-default` — flips default within family.
- `POST /api/meals/:id/archive-family` — archives all active rows in the
  family. `:id` may be any row in the family; the server resolves to its
  `recipe_id` and cascades from there.

The existing `PUT /api/meals/:id` retains in-place edit semantics. The
existing `DELETE /api/meals/:id` retains hard-delete semantics for now,
but is no longer the primary archival path — UI affordances point at
archive/unarchive instead.

## UI surface (additions / changes)

- `Recipes.tsx` — header gains a **"+ New recipe"** button next to the
  existing **"Import recipe"** button. List query gains the
  default-and-active filter. Cards show a "N variants" pill when
  applicable. New nav link to `/recipes/archived`.
- `RecipeDetail.tsx` — variant chips at the top when family has > 1
  active variant; new **Edit**, **Create variant**, **Set as default**,
  **Archive variant**, **Archive recipe** affordances. Existing
  `Delete` button is removed in favor of archive (hard-delete is no
  longer reachable from the UI).
- `RecipeEditor.tsx` (new) — used by `/recipes/new`, `/recipes/:id/edit`,
  `/recipes/:id/variant`. The existing `MealForm.tsx` is the natural
  starting point; it gets extended to cover all `Meal` fields and to
  surface the three save modes.
- `ArchivePage.tsx` (new) at `/recipes/archived` — lists archived
  families and variants with unarchive actions.
- `Planner.tsx` / planned-meal cells — small "archived" pill next to
  meals whose resolved version is archived.

## Testing

### Service layer

- `mealService.supersede`: insert + flip-default + archive-old happen
  atomically; `version_number`, `parent_meal_id` set correctly; family
  invariant ("one active default") holds before and after.
- `mealService.createVariant`: inserts at `version_number = 1`,
  `parent_meal_id = null`, `is_default = false`; existing default
  unchanged.
- `mealService.archiveVariant`: when archived row was default and
  another active variant exists, default is promoted in same
  transaction.
- `mealService.archiveFamily`: archives every active row in family.
- `mealService.unarchive`: clears `archived_at`; does not promote to
  default.
- `mealService.setDefault`: flips default transactionally.

### Read paths

- `getAllMeals`: archived rows and non-default variants excluded;
  `variantCount` correct.
- `getMealById`: archived rows still readable.
- `getFamily`: returns active variants only.

### Shopping resolution (`shoppingService`)

- Plan with one cooked + one planned meal across a supersede: cooked
  resolves to old version's ingredients, planned resolves to new.
- Family fully archived: planned meal falls back to the row it pointed
  at, and the response includes a "stale" indicator.

### Auto-planner (`mealPlanner`)

- Candidate pool excludes archived families.
- Candidate pool excludes non-default variants.

### Frontend smoke

- Editor save modes round-trip (each button creates / updates the right
  rows).
- Variant chips render and switch in place.
- Archive page lists and unarchives correctly.
- "+ New recipe" navigates to a blank editor that creates a new family.

## Open questions

None at design time. The "stale" pill UX (when a planned meal's family
has been entirely archived) is a small visual detail that can be
finalized in implementation.
