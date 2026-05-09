# Cooked-Meal Validation Modal — Design

**Date:** 2026-05-08
**Status:** Draft for implementation plan.
**Trigger:** Marking a planned meal cooked currently triggers a silent
recipe-derived pantry deduction. Recipes are estimates; real cooks vary
(scaled portions, ingredient swaps, pre-made store-bought sauces). The
silent path made the pantry drift from reality. The user wants a
validation modal on every cook so what's deducted reflects what was
actually used.

## Goals

1. Open a "Cook Confirm" modal on every transition of a `PlannedMeal`
   to `cooked`, regardless of which UI surface triggered the transition.
2. Pre-fill the modal with the recipe's ingredients, scaled to the
   planned servings; let the user check/uncheck, edit qty/unit, and add
   ad-hoc ingredients before saving.
3. Replace the silent recipe-derived deduction with an explicit
   "what was actually used" deduction driven by the modal's contents.
4. Surface pantry context inline (per-unit native totals, no canonical
   conversions) so the user can see what they have while editing.
5. Surface shortfalls (over-deduction, missing density, missing
   ingredient in pantry) after save without blocking the cook.
6. Keep the modal single-purpose: it records this cook, nothing more.
   Substitution memory and history are deferred.

## Non-goals (deferred)

- **Save substitution for next time.** Deferred to the recipe-versioning
  plan: when that feature ships, the modal hands off to the recipe
  editor's "Save as new version" flow. This spec adds a tie-in note to
  the recipe-versioning plan; no UI for it now.
- **Per-cook history / "what was actually used" log.** No new table,
  no per-cook persistence of override lists. Each cook starts from
  recipe defaults. (Cost: re-opening the modal on a cooked meal cannot
  show what was actually deducted — addressed by closing that affordance
  entirely; see Decisions §6.)
- **Re-open modal on already-cooked meals.** Once cooked, cooked.
- **Auto-reverse pantry on uncook (status `cooked` → `planned`).**
  The pantry-overhaul branch's 30-day soft-delete Undo on consumed
  batches is the wrong-meal-cooked escape hatch.
- **Servings input field in the modal.** Modal scales by the planned
  meal's servings; per-row qty is the user's lever if they made
  something different.
- **Add-to-shopping-list button on the shortfall banner unless
  pantry-overhaul's one-tap-add mechanism is concretely available at
  implementation time.** Banner is otherwise informational only.

## Decisions made during brainstorming

These are recorded so future readers don't relitigate them.

1. **Default mode: edit-inline.** Every row shows qty + unit as
   editable inputs immediately, with a checkbox to skip. No
   tap-to-expand step. Maximum visibility into what's being deducted.
2. **Server payload: full final list.** `overrides` is the complete
   list the user confirmed; server does not consult recipe ingredients
   when `overrides` is present. Simpler API; modal is source of truth
   for this cook. Future "save substitution" feature lives in the
   recipe editor, not this modal.
3. **Pantry visibility: inline hint per row.** Per-unit native totals
   only — e.g. `"pantry: 240 ml"` or `"pantry: 480 g · 1 lb (2 batches)"`
   when multiple incompatible units exist. No canonical conversion
   math.
4. **Shortfall behavior: save anyway, post-save banner.** Server
   marks meal cooked, deducts what's available (no negatives), returns
   shortfall list. Banner shows the shortfalls and (if available) a
   one-tap "Add shortfalls to shopping list" action. Doesn't block.
5. **Ad-hoc add: inline `+ Add ingredient` row at bottom.** Tapping
   inserts an editable line with a typeahead against the existing
   `Ingredient` pool. Added rows look identical to recipe rows in the
   final payload.
6. **Re-cook: modal does not re-open; status changes don't reverse
   pantry.** Closing the per-cook escape hatch keeps the data model
   simple (no override persistence) and leans on pantry-overhaul's
   existing 30-day soft-delete Undo.
7. **Sequencing: lands after pantry overhaul.** Modal consumes the
   overhaul's per-batch totals, conversion engine, and structured
   shortfall response. Own PR off master, not bolted onto PR #9.

## Sequencing

This feature ships as its own PR off master, *after* the pantry
overhaul (PR #9) merges. Reasons:

- Inline pantry hint reads from the overhaul's per-batch totals.
- Shortfall reasons (`insufficient` / `no_density` / `no_pantry`) and
  the conversion-engine-driven deduction come from the overhaul's
  rewritten `deductIngredientsForMeal`.
- Soft-delete-with-Undo is the wrong-meal-cooked escape hatch; the
  modal does not need to ship its own undo path.

The implementation plan starts only when pantry overhaul is on master.

## Trigger surfaces

The modal opens on every transition of a `PlannedMeal` to `cooked`.
Today's four entry points all route through it:

| # | Surface | File | Today's behavior |
|---|---|---|---|
| 1 | Dashboard hero **"Mark as cooked"** button | `client/src/pages/Dashboard.tsx` (around line 255) | `handleCooked(pm)` → `updatePlannedMeal({status:"cooked"})` + reload |
| 2 | Dashboard "today's other meals" cell click | `client/src/pages/Dashboard.tsx` (around line 302) | Same handler |
| 3 | PlanDayColumn small **"Cooked"** text link | `client/src/components/PlanDayColumn.tsx` (around line 37) | `onMarkCooked(pm.id)` prop |
| 4 | Planner edit-meal modal status change to cooked | `client/src/pages/Planner.tsx` (around line 467 area) | Status-pick handler in the existing edit modal |

**Implementation pattern:** a single `<CookConfirmModal>` component
mounts at the page root for Dashboard and Planner. A small client-side
hook `useCookConfirm()` exposes `openForMeal(plannedMealId)` and routes
through the modal. The four call sites all use the hook — no
duplicated wiring. Surface 4 closes its parent edit-modal before
opening the cook-confirm modal (no stacking).

**Cancel:** modal closes with no network call. Meal stays at its
previous status.

## Modal UX

```
╭─ Cook Confirm ──────────────────── ✕ ╮
│ Chicken Stir Fry · 2 servings        │
│ scaled from recipe (4 svgs)          │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ ☑ Chicken thighs   [200]  [ g ]  │ │
│ │   pantry: 480 g · 1 lb (2 batch) │ │
│ ├──────────────────────────────────┤ │
│ │ ☐ Soy sauce        [ 1 ] [tbsp]  │ │  ← unchecked = skipped
│ │   pantry: 240 ml                 │ │
│ ├──────────────────────────────────┤ │
│ │ ☐ Honey            [.5 ] [tbsp]  │ │
│ │   pantry: 100 ml                 │ │
│ ├──────────────────────────────────┤ │
│ │ ☐ Rice vinegar     [.5 ] [tbsp]  │ │
│ │   pantry: 50 ml                  │ │
│ ├──────────────────────────────────┤ │
│ │ ☑ Hoisin sauce ✕   [ 2 ] [tbsp]  │ │  ← ad-hoc, X removes
│ │   pantry: 180 ml                 │ │
│ ├──────────────────────────────────┤ │
│ │ +  Add ingredient                │ │  ← typeahead row
│ └──────────────────────────────────┘ │
│                                      │
│           [ Cancel ]   [ Mark cooked ]│
╰──────────────────────────────────────╯
```

### Per-row anatomy

- **Checkbox.** Default checked for recipe rows. Unchecked = excluded
  from the payload.
- **Ingredient name.** Read-only for recipe rows; typeahead for
  ad-hoc rows (same `Ingredient` pool used elsewhere in the app, with
  the existing "create new ingredient" upsert fallback).
- **Quantity input.** Number; accepts decimals and fractions.
- **Unit dropdown.** For recipe rows, pre-fills with the recipe's unit
  and offers same-family compatible units (volume, mass, count). For
  ad-hoc rows, all units. Cross-family conversion piggybacks on the
  pantry-overhaul conversion engine — if the ingredient lacks a
  density, save still works; if cross-family deduction fails, the
  failure surfaces in the shortfall banner.
- **Pantry hint** (small secondary text). Per-unit native totals.
  `"pantry: 240 ml"` or `"pantry: 480 g · 1 lb (2 batches)"` when
  incompatible units coexist. `"pantry: none"` if no active batches.
  `"pantry: 240 ml (no density set)"` when the row's selected unit
  is cross-family vs pantry units and the ingredient lacks density.
- **Remove (✕).** Ad-hoc rows only. Different from uncheck — uncheck
  keeps the row visible but skipped; ✕ deletes the row entirely.

### Pre-fill rules

- Quantities are scaled by `plannedMeal.servings / meal.servings`,
  rounded to 2 decimal places. `meal.servings` is assumed > 0 (today's
  schema enforces this; the existing recipe-derived deduction relies on
  the same assumption).
- All recipe rows checked by default; user opts out individually.
- No persisted memory — every cook starts from recipe defaults.
  (Per locked decision: substitutions are per-cook only.)

### Edge cases

- **All rows unchecked + zero ad-hocs.** Save still allowed; meal
  becomes cooked, no deduction. (User cooked something using only
  untracked items.)
- **Recipe ingredient with no PantryBatch.** Pantry hint reads
  `"pantry: none"`. Row remains editable; on save, server emits a
  `no_pantry` shortfall.
- **Unit edited to a cross-family unit without ingredient density.**
  Pantry hint reflects this (`"pantry: 240 ml (no density set)"`).
  Save proceeds; deduction surfaces a `no_density` shortfall.

### Servings

Not editable in the modal. The header shows the planned servings
("2 servings") and notes the recipe's serving count for context
("scaled from recipe (4 svgs)"). If the user actually cooked a
different number, they edit per-row qty.

## Server contract

### Endpoint

`PUT /api/plans/:planId/meals/:mealId` is extended. No new endpoint.

### Request body — cook transition

```json
{
  "status": "cooked",
  "overrides": [
    { "ingredientId": 12, "quantity": 200, "unit": "g" },
    { "ingredientId": 27, "quantity": 2,   "unit": "tbsp" }
  ]
}
```

- `overrides` is the **full final list** the user confirmed in the
  modal. Server does NOT consult recipe `MealIngredients` when
  `overrides` is present.
- `overrides` is **only honored when `status === "cooked"`**. Sent on
  any other status change → 400.
- Omitting `overrides` while setting `status: "cooked"` falls back to
  the **existing recipe-derived deduction path** — preserves the
  current API contract and supports backfill scripts, tests, and any
  hypothetical non-modal callers.

### Validation

- Each override row: `ingredientId` exists, `quantity > 0`, `unit` is
  a known unit string.
- Reject duplicate `ingredientId` rows in `overrides` with 400 — the
  modal collapses dupes before send (one row per ingredient). Forces
  the modal to be the source of truth for "what was used in total."

### Service signature

```ts
deductIngredientsForMeal(
  mealId: number,
  servingMultiplier: number,
  overrides?: { ingredientId: number; quantity: number; unit: string }[],
  tx?: Prisma.TransactionClient
): Promise<DeductResult>
```

When `overrides` is present, `mealId` and `servingMultiplier` are
ignored for the deduction list. The function iterates `overrides`
instead of `MealIngredient` rows. Each line goes through the
pantry-overhaul conversion engine + FEFO + use_first tag logic.

### Response shape (additive)

```ts
type DeductResult = {
  shortfalls: {
    ingredientId: number;
    ingredientName: string;
    requestedQuantity: number;
    requestedUnit: string;
    availableQuantity: number;     // in requested unit if convertible, else 0
    reason: "insufficient" | "no_density" | "no_pantry";
  }[];
};
```

The route handler attaches `shortfalls` to the response so the client
can render the banner without a follow-up call:

```json
{
  "...updated PlannedMeal fields": "...",
  "deduction": { "shortfalls": [...] }
}
```

### Transactional semantics

Status update + deduction happen in a single Prisma `$transaction`. If
deduction throws, the status update rolls back. Shortfalls are not
errors — they're data, not a failure.

This is a behavior change vs today (today's deduction runs outside a
transaction and after the status update). Pantry overhaul is likely to
move deduction inside a transaction already (status change should be
atomic with batch consumption); if so, this PR inherits that. Otherwise
this PR adds the wrapping.

## Data flow on Save

### Client (`useCookConfirm`)

1. Modal collects rows. Filter to checked rows with qty > 0. Collapse
   any duplicate `ingredientId` defensively (the typeahead should
   prevent duplicates from being added in the first place).
2. `PUT /api/plans/:planId/meals/:mealId` with `{ status: "cooked",
   overrides }`.
3. Server returns updated `PlannedMeal` + `deduction.shortfalls`.
4. Hook resolves modal, triggers parent reload (Dashboard or Planner
   refetches plan).
5. If `shortfalls.length > 0`, hook fires the banner with the list +
   (if available) the "Add to shopping list" action.
6. Cancel: no network call, modal closes, meal status unchanged.

### Server (`PUT /api/plans/:planId/meals/:mealId`)

```ts
const isCookTransition = req.body.status === "cooked"
                        && previous.status !== "cooked";

const result = await prisma.$transaction(async (tx) => {
  const updated = await plannerService.updatePlannedMeal(
    Number(req.params.mealId), req.body, tx
  );

  let deduction: DeductResult = { shortfalls: [] };
  if (isCookTransition) {
    const multiplier = updated.servings / updated.meal.servings;
    deduction = await pantryService.deductIngredientsForMeal(
      updated.mealId,
      multiplier,
      req.body.overrides,   // undefined for non-modal callers
      tx
    );
  }
  return { updated, deduction };
});

res.json({ ...result.updated, deduction: result.deduction });
```

Two new things vs today: the `isCookTransition` guard (no re-deduction
when an already-cooked meal is updated for some other reason) and
threading the Prisma transaction client into both service calls.

### Deduction loop body when `overrides` is present

```
for each override row:
  resolve unit -> ingredient.canonical via conversion engine
    if cross-family + no density: emit shortfall { reason: "no_density" }, skip row
  fetch active PantryBatches for ingredientId, FEFO order, use_first tag first
  if no batches: emit shortfall { reason: "no_pantry" }, skip row
  walk batches deducting until row qty satisfied
  if qty remains after last batch: emit shortfall {
    reason: "insufficient",
    availableQuantity: deductedSoFar
  }
return { shortfalls }
```

No partial deductions on errors mid-row — if a batch update throws,
the whole `$transaction` rolls back. Shortfalls are reported, not
raised.

## Shortfall banner & error handling

### Banner

```
┌─ Marked cooked — pantry came up short ──────────── ✕ ┐
│ • Soy sauce: needed 2 tbsp, had 1 tbsp              │
│ • Honey: couldn't deduct (no density set for tbsp)  │
│ • Hoisin sauce: not in pantry                       │
│                                                     │
│            [ Add shortfalls to shopping list ]      │
└─────────────────────────────────────────────────────┘
```

Component-level, near the top of the page that mounted the modal.
Dismissable. One banner per cook (replaces any prior dismissed one).

### Per-reason copy

| `reason` | Line text |
|---|---|
| `insufficient` | `{name}: needed {qty} {unit}, had {available} {unit}` |
| `no_density` | `{name}: couldn't deduct (no density set for {unit})` — clicking jumps to the ingredient density edit (pantry-overhaul affordance) |
| `no_pantry` | `{name}: not in pantry` |

### Add to shopping list button

- **Dependency:** pantry-overhaul's add-to-active-shopping-list
  mechanism (introduced via the "running low" nudge feature). If that
  mechanism is concretely available at implementation time, the
  banner uses it: a single bulk operation that adds each shortfall
  ingredient at its requested quantity to the active week's shopping
  list. If not yet available, the button is omitted in this PR —
  banner is informational only.
- **Active plan resolution:** the plan whose week range contains
  today's date. If no such plan exists, the button is hidden (banner
  still shows the shortfall list).

### Distinct error paths (not shortfalls)

| Failure | Source | UX |
|---|---|---|
| Network / 500 | route handler throws | toast: "Couldn't mark cooked. Try again." Modal stays open, no state change. |
| Validation 400 (bad row, duplicate ingredient) | route validator | toast with the specific row issue. Modal stays open. |
| Transaction rollback (DB error during deduct) | Prisma | same as 500. Status update rolls back too — meal stays `planned`. |

All failures keep the modal open with the user's edits intact. Only
success closes the modal.

## Recipe-versioning tie-in

The "save substitution for next time" feature is deferred to the
recipe-versioning plan
(`docs/superpowers/plans/2026-05-05-recipe-versioning.md`). This spec
adds an "Implementation hooks" section to that plan referencing this
spec by path so the seam is not forgotten.

The seam, when it ships:

- **Modal affordance.** A small "Save these as the new default" link
  appears next to the Mark cooked button when the user has edited
  recipe rows. Clicking it (instead of Mark cooked) opens
  `/recipes/:id/edit` pre-loaded with the modal's edited ingredient
  list, with `Save as new version` highlighted.
- **Cooked flow proceeds independently.** Whether the user takes the
  save-as-new-version path or just Mark cooked, the per-cook
  deduction works the same way. Substitution memory and pantry
  deduction are independent.
- **No schema change in this PR.** The modal's data shape is already
  the full final list; the editor consumes the same shape when the
  seam is added.

The deliverable in this PR's scope is the plan-doc edit (an appended
"Implementation hooks" section in the recipe-versioning plan), not
code.

## Testing

### Server

- `pantryService.deductIngredientsForMeal` with `overrides`:
  - Happy path: each override row deducted, FEFO honored, no
    shortfalls returned.
  - `insufficient`: row qty > pantry total → deducts what exists,
    consumes remaining batches, emits
    `{reason: "insufficient", availableQuantity}`.
  - `no_pantry`: no active batches → emits `{reason: "no_pantry"}`,
    no batch writes.
  - `no_density`: cross-family unit with no ingredient density →
    emits `{reason: "no_density"}`, no batch writes.
  - `overrides` omitted: function falls through to the existing
    recipe-derived path (regression guard for existing callers).
  - Mixed: 4-row override with one of each shortfall type returns 3
    shortfalls, 1 successful deduction.
  - When `overrides` present, `mealId`/`servingMultiplier` are
    ignored for the deduction list (verified by passing nonsense
    values).

- `PUT /api/plans/:planId/meals/:mealId`:
  - Status `cooked` + valid `overrides` → 200, response includes
    `deduction.shortfalls`, status updated, batches updated, all in
    one transaction.
  - Status not `cooked` + `overrides` present → 400.
  - Status `cooked` + duplicate `ingredientId` rows → 400.
  - Status `cooked` + invalid `ingredientId` (FK miss) → 400.
  - Status `cooked` on already-cooked meal (`isCookTransition` false)
    → 200, status update applied, no re-deduction (verified by
    snapshotting batch state).
  - Transaction rollback: simulated batch-update failure
    mid-deduction → status stays `planned`, no batches modified.

### Client

- `useCookConfirm`:
  - Filters unchecked rows from the payload.
  - Collapses duplicate `ingredientId` rows defensively.
  - Surfaces shortfall banner when response includes shortfalls.
  - Cancel issues no network call.
  - Server error keeps modal open with form state intact.

- `<CookConfirmModal>`:
  - Pre-fills with recipe rows scaled by planned/recipe servings
    ratio (snapshot 4→2, 2→3, etc.).
  - Inline pantry hints render per-unit native totals; render
    `"pantry: none"` when no batches.
  - Add-ingredient typeahead inserts a new editable row at the
    bottom; `✕` removes it; uncheck does not.
  - Edge: zero rows checked + zero ad-hocs → Save still allowed.

- Trigger surface integration smoke (4 entry points):
  - Dashboard hero "Mark as cooked" → opens modal.
  - Dashboard "today's other meals" cell click → opens modal.
  - PlanDayColumn small "Cooked" link → opens modal.
  - Planner edit-modal status change to cooked → closes that modal,
    opens cook-confirm (no stacking).

### Out of scope for tests in this PR

- Pantry-overhaul conversion engine internals (covered by that
  branch).
- Shopping-list "Add shortfalls" button (only ships if
  pantry-overhaul's add-to-shopping mechanism is concretely
  available at implementation time; tested in that PR if so).

## Open questions

None at design time. The "Add shortfalls to shopping list" button is a
conditional surface decided at implementation time based on whether
the pantry-overhaul branch landed the add-to-active-shopping-list
mechanism.
