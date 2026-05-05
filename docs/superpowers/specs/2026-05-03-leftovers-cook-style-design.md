# Leftovers Cook Style + Sunday-Start Week — Design

**Date:** 2026-05-03
**Status:** Draft for implementation.
**Trigger:** Today, batch-prepping a meal on Sunday and adding it to a later
day double-counts ingredients on the shopping list. The user asked for a
third cook-style option ("Leftovers") that excludes the occurrence from
shopping aggregation. Investigating that exposed a calendar-shape mismatch
— the prep day (Sunday) is currently the *last* day of the plan week, so
leftovers logically can't fit inside the same plan. This design ships
both fixes together as one coupled change.

## Goals

1. Add a third per-occurrence cook style: `leftovers`. Mutually exclusive
   with `cook_fresh` and `batch_prep`. Excluded from the shopping list.
2. Shift plan weeks from **Monday → Sunday** to **Sunday → Saturday** so
   Sunday becomes day 1 — the prep + shopping day — and leftovers from a
   Sunday batch can populate downstream slots in the same plan.
3. Make the auto-generator leftover-aware: when it picks a batch-prep
   recipe for Sunday, it may fill 1–2 downstream slots with that same
   recipe marked `leftovers`.
4. Backfill existing plans so the historical view still works after the
   shift.

## Non-goals

- Linking a leftover occurrence to a specific batch-prep occurrence
  (rejected: simpler unlinked flag chosen).
- Tracking remaining-servings of a batch as leftovers consume them
  (out of scope; would require the linkage above).
- Changing `Meal.canBatch` / `Meal.canFresh` recipe-level capabilities
  (those stay; this design is purely per-occurrence).
- Changing the calendar sync date math beyond updating the
  `dayOffsets` map (no re-sync of already-synced events).

## Data model

### Schema change (`server/prisma/schema.prisma`)

```prisma
enum CookStyle {
  cook_fresh
  batch_prep
  leftovers
}

model PlannedMeal {
  id        Int               @id @default(autoincrement())
  planId    Int               @map("plan_id")
  mealId    Int               @map("meal_id")
  day       DayOfWeek
  mealSlot  MealSlot          @map("meal_slot")
  servings  Int               @default(2)
  cookStyle CookStyle         @default(cook_fresh) @map("cook_style")
  status    PlannedMealStatus @default(planned)

  calendarEventId String? @map("calendar_event_id")

  plan WeeklyPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  meal Meal       @relation(fields: [mealId], references: [id])

  @@map("planned_meals")
}
```

`isPrep: Boolean` is removed. The three states were already mutually
exclusive in the user's mental model; promoting them to a real enum makes
bad states (`isPrep && isLeftover`) unrepresentable in the type system.
22 client-side references to `isPrep` across 5 files (`Planner.tsx`,
`AddToPlanModal.tsx`, `Dashboard.tsx`, `PlanDayColumn.tsx`, `plans.ts`)
update to read `cookStyle`.

### Migration (`server/prisma/migrations/003_leftovers_and_week_shift/migration.sql`)

```sql
-- 1. Cook style enum + column with backfill from is_prep
CREATE TYPE "CookStyle" AS ENUM ('cook_fresh', 'batch_prep', 'leftovers');

ALTER TABLE planned_meals
  ADD COLUMN cook_style "CookStyle" NOT NULL DEFAULT 'cook_fresh';

UPDATE planned_meals
SET cook_style = CASE
  WHEN is_prep THEN 'batch_prep'::"CookStyle"
  ELSE 'cook_fresh'::"CookStyle"
END;

ALTER TABLE planned_meals DROP COLUMN is_prep;

-- 2. Week shift: every existing Monday-start plan moves back one day
UPDATE weekly_plans
SET week_start_date = week_start_date - INTERVAL '1 day';
```

The `PlannedMeal.day` enum (`monday | tuesday | ... | sunday`) is *not*
touched. A meal that was on `monday` in a Monday-anchored plan stays on
`monday` in the Sunday-anchored plan — it just renders in column 2
instead of column 1. The calendar date the meal maps to is unchanged
(see "Calendar sync invariance" below).

### API types (`client/src/api/plans.ts`)

```ts
export interface PlannedMeal {
  id: number;
  mealId: number;
  day: string;
  mealSlot: string;
  servings: number;
  cookStyle: "cook_fresh" | "batch_prep" | "leftovers";
  status: string;
  meal: Meal;
}
```

`isPrep` is removed.

## Week-shift mechanics

### Day order constants (two places)

- `client/src/pages/Planner.tsx:41` — `DAYS` becomes
  `["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]`.
- `server/src/routes/calendar.ts:28-31` — `dayOffsets` becomes
  `{ sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }`.

### Date helpers (`client/src/api/plans.ts`)

- `parseWeekParam`: the index calculation `(d.getDay() + 6) % 7`
  (Monday-anchored) becomes plain `d.getDay()` (Sunday-anchored). The
  function still returns the canonical `YYYY-MM-DD` for the URL.
- `getNextMonday` is renamed `getNextSunday`; the `(8 - day) % 7`
  computation becomes `(7 - day) % 7`. All callers updated.
- `localMidnightFromISO`, `formatLocalDate`, `planCoversToday`,
  `planNotPast`, `pickPlanForWeek`, `pickRelevantPlan` are
  day-of-week-agnostic and unchanged.

### Today index (`client/src/pages/Planner.tsx:47-49`)

`todayKey()` computes a Mon=0 index today. Becomes plain `new Date().getDay()`
indexed into the new Sunday-first `DAYS`.

### Calendar sync invariance

For any existing PlannedMeal:

- Old date math: `weekStartDate` (a Monday) + `dayOffsets[day]` where
  `monday=0, ..., sunday=6`.
- New date math: `weekStartDate` (a Sunday after backfill, i.e. one day
  earlier) + `dayOffsets[day]` where `sunday=0, monday=1, ..., saturday=6`.

Walking through `monday`: old = Monday + 0 = Monday. New = (Monday − 1) + 1 = Monday.
Walking through `sunday`: old = Monday + 6 = Sunday. New = (Monday − 1) + 0 = Sunday.

Every `day` enum value lands on the same calendar date. Plans with
already-synced calendar events do not need re-syncing.

## Cook-style UI

### Edit modal (`client/src/pages/Planner.tsx:765-788`)

The two-button row becomes three. Suggested icons (lucide):
- `Cook fresh` — `Leaf` (unchanged)
- `Batch prep` — `Flame` (unchanged)
- `Leftovers` — `Refrigerator` or `Recycle` (pick one during impl)

All three are mutually exclusive. Each writes `cookStyle` directly via
`onChange({ cookStyle: <value> })`.

### Day-card display

Two render sites display the cook style:

- `client/src/pages/Planner.tsx:391-394` — the small line under the meal
  name in the active planner view.
- `client/src/components/PlanDayColumn.tsx:30` — the badge in the older
  PlanDayColumn (used by Dashboard).

Both update to a three-way switch. The label and icon match the edit
modal.

### Picker auto-flag (`client/src/pages/Planner.tsx:140-152`)

```ts
const canBatchHere = picker.day === "sunday" && !!meal?.canBatch;
const planned = await addPlannedMeal(effectiveViewedPlan.id, {
  mealId,
  day: picker.day,
  mealSlot: picker.slot,
  servings: meal?.servings ?? 2,
  cookStyle: canBatchHere ? "batch_prep" : "cook_fresh",
});
```

Same trigger (Sunday + canBatch), now writing `cookStyle` instead of
`isPrep`. Sunday is now column 1, but the day name is unchanged, so this
keeps working.

## Shopping list

`server/src/services/shoppingService.ts:10-13`:

```ts
const plannedMeals = await prisma.plannedMeal.findMany({
  where: {
    planId,
    status: { in: ["planned", "cooked"] },
    cookStyle: { not: "leftovers" },
  },
  include: { meal: { include: { ingredients: true } } },
});
```

Single filter addition. Leftover occurrences contribute zero ingredients
to the aggregation, regardless of meal or servings. Pantry on-hand
subtraction is unchanged.

## Auto-generator

### Prompt (`server/src/claude/mealPlanner.ts`)

Updated rules block:

> - Generate a weekly meal plan (Sunday → Saturday) for 2 people.
> - Sunday is the prep day. Sunday slots may be `cook_fresh` or
>   `batch_prep`. Sunday has two slots (lunch + dinner); pick 1–2
>   meals with `canBatch=true` and `cookStyle: "batch_prep"` and
>   servings ≥ 4.
> - For each Sunday `batch_prep` meal, you MAY fill 1–2 downstream
>   slots (Mon–Wed) with the same `mealId`, `cookStyle: "leftovers"`,
>   servings 2. This reduces the shopping list and reuses the prep.
> - Every other slot is `cookStyle: "cook_fresh"` and the meal must
>   have `canFresh=true`.
> - Avoid meals used recently: ${recentMealIds}
> - Prefer meals that use ingredients already in the pantry.
> - Each day should have lunch and dinner planned.

Output schema replaces `isPrep: boolean` with
`cookStyle: "cook_fresh" | "batch_prep" | "leftovers"`.

### Validation (`server/src/claude/mealPlannerRules.ts`)

```ts
export interface PlannedMealCandidate {
  mealId: number;
  day: string;
  mealSlot: string;
  servings: number;
  cookStyle: "cook_fresh" | "batch_prep" | "leftovers";
}

export function filterValidPlannedMeals(
  planned: PlannedMealCandidate[],
  mealsById: Record<number, MealCapability>,
): PlannedMealCandidate[] {
  return planned.filter((pm) => {
    const meal = mealsById[pm.mealId];
    if (!meal) return false;
    switch (pm.cookStyle) {
      case "batch_prep": return pm.day === "sunday" && meal.canBatch;
      case "leftovers":  return true;
      case "cook_fresh": return meal.canFresh;
    }
  });
}
```

`leftovers` has no recipe-capability requirement — the user (or the
LLM) decides; we don't second-guess. Unknown `mealId` is still dropped.

### Servings on leftover occurrences

Auto-gen picks `servings: 2` for leftover slots (one household meal).
The user can edit. There is no bookkeeping to ensure
`Σ leftover_servings ≤ batch_servings − cook_day_servings`; the user
manages that mentally. This is the explicit trade-off from picking the
unlinked-flag option.

## Plan summary metric (`Planner.tsx:231-246`)

Today's `summary.prep` / `summary.fresh` counts remain meaningful but
exclude leftovers from both. Leftovers are tallied as a third counter:

```ts
const prep = plan.plannedMeals.filter((m) => m.cookStyle === "batch_prep" && m.status !== "skipped").length;
const fresh = plan.plannedMeals.filter((m) => m.cookStyle === "cook_fresh" && m.status !== "skipped").length;
const leftover = plan.plannedMeals.filter((m) => m.cookStyle === "leftovers" && m.status !== "skipped").length;
```

The headline ("Plan looks balanced — N batch-prep sessions, M fresh
cooks, K leftover meals") gets a third clause when `leftover > 0`. Avg
protein-per-meal still includes leftover slots (you're still eating that
meal; the nutrition counts).

## Surfaces touched

Server:
- `server/prisma/schema.prisma` — enum + cookStyle column, drop isPrep.
- `server/prisma/migrations/003_leftovers_and_week_shift/migration.sql` — new file.
- `server/src/routes/plans.ts` — accept `cookStyle` on create/update.
- `server/src/routes/calendar.ts` — flip `dayOffsets`, replace `pm.isPrep` reference.
- `server/src/services/shoppingService.ts` — add `cookStyle: { not: "leftovers" }` filter.
- `server/src/claude/mealPlanner.ts` — prompt + output schema.
- `server/src/claude/mealPlannerRules.ts` — switch from boolean to enum.

Client:
- `client/src/api/plans.ts` — type, `parseWeekParam`, `getNextSunday` rename.
- `client/src/pages/Planner.tsx` — `DAYS` order, `todayKey`, picker auto-flag,
  edit-modal cook-style buttons, day-card render, summary counter.
- `client/src/components/PlanDayColumn.tsx` — badge render.
- `client/src/pages/Dashboard.tsx` — any reference to `isPrep` or `getNextMonday` updated.
- `client/src/components/AddToPlanModal.tsx` — same.
- `client/src/pages/RecipeDetail.tsx` and `client/src/components/MealCard.tsx`
  — verify; only update if they read `pm.isPrep` directly.

Tests:
- `server/src/__tests__/mealPlannerRules.test.ts` — extend.
- `server/src/__tests__/shoppingService.test.ts` — new.
- `server/src/__tests__/weekShift.test.ts` — new.

## Testing

### Unit tests

- `mealPlannerRules.test.ts`:
  - `cookStyle: 'leftovers'` accepted on any day, any meal capability.
  - `cookStyle: 'batch_prep'` requires `day === 'sunday'` and `canBatch`.
  - `cookStyle: 'cook_fresh'` requires `canFresh`.
  - Unknown `mealId` dropped regardless of cookStyle.

- `shoppingService.test.ts`:
  - Plan with three planned meals (cook_fresh + batch_prep + leftovers,
    same recipe). Aggregation reflects only the two non-leftover
    occurrences.
  - Pantry on-hand subtraction still applies to the included quantities.

- `weekShift.test.ts`:
  - `parseWeekParam` snaps mid-week dates to the prior Sunday.
  - `getNextSunday` returns today when invoked on a Sunday.
  - Calendar-route `dayOffsets` produce the same calendar date as the
    old (Monday-anchored) map for a meal with the same `day` enum after
    a one-day-earlier `weekStartDate` (regression guard for the
    backfill claim).

### Manual verification (in spec, not automated)

1. Run migration on a dev DB with at least one existing plan + at least
   one synced calendar event. Snapshot before/after.
2. Confirm: every `planned_meals.day` unchanged; every
   `weekly_plans.week_start_date` exactly one day earlier; every
   `cook_style` value matches the boolean-to-enum mapping.
3. Open Planner UI for an existing plan. Sunday is column 1. Meals
   appear on the same calendar dates as before.
4. Auto-generate a new plan. Verify Claude returns at least one
   batch_prep on Sunday and at least one leftovers slot Mon–Wed
   referencing the same `mealId`.
5. Generate the shopping list. Confirm leftover-flagged meals do not
   contribute their ingredients to the totals.
6. Edit a planned meal; cycle through all three cook-style buttons;
   refresh; verify `cookStyle` round-trips.
7. Calendar-sync the new plan; verify each event's date matches the
   meal's `day` column.

### Out of scope for tests

- E2E browser tests (no harness today).
- Claude prompt regression tests (non-deterministic responses; we
  validate via `filterValidPlannedMeals` instead).

## Open questions

- **Leftovers icon choice.** `Refrigerator` vs `Recycle` vs something
  else from lucide. Decide during impl.
- **Auto-gen servings policy.** Currently spec'd as `servings: 2` on
  leftover slots. If the household commonly eats different per-slot
  portions, this becomes a tunable. Defer until we have data.
- **Existing plans with `cookStyle: 'batch_prep'` on non-Sunday days
  after migration.** Shouldn't exist (the picker auto-flag only set
  `isPrep` on Sunday), but if a manual edit ever placed a batch-prep on
  a non-Sunday, it survives the migration. The validator would reject
  it on auto-regenerate but display fine. Acceptable.
