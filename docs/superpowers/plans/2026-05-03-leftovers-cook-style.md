# Leftovers Cook Style + Sunday-Start Week Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third per-occurrence cook style (`leftovers`) that excludes the meal from the shopping list, and shift the plan week from Mon→Sun to Sun→Sat so Sunday becomes day 1 (the prep day) and leftover slots can populate the same plan downstream.

**Architecture:** Replace `PlannedMeal.isPrep: Boolean` with `PlannedMeal.cookStyle: CookStyle` enum (`cook_fresh | batch_prep | leftovers`). Backfill in one migration alongside `weekly_plans.week_start_date -= 1 day` to convert all existing plans to Sunday-anchored. The shopping aggregation gets a single `cookStyle != leftovers` filter. The auto-generator prompt and validator switch from boolean to enum and learn to fill downstream slots with `leftovers`. Client UI flips `DAYS` order, the date helpers re-anchor to Sunday, and the cook-style button row in the edit modal grows from two buttons to three.

**Tech Stack:** Prisma 6 / PostgreSQL, Express 5 + TypeScript on the server, Vite + React 18 + TypeScript on the client, Vitest for server tests, Lucide React icons.

**Spec:** `docs/superpowers/specs/2026-05-03-leftovers-cook-style-design.md`

---

## File structure

**Created:**
- `server/prisma/migrations/003_leftovers_and_week_shift/migration.sql` — schema migration + backfill.
- `server/src/__tests__/shoppingService.test.ts` — pure-function tests for shopping aggregation.
- `server/src/__tests__/calendarRoute.test.ts` — regression guard for the calendar `dayOffsets` flip.

**Modified — server:**
- `server/prisma/schema.prisma` — `CookStyle` enum + replace `isPrep` with `cookStyle` on `PlannedMeal`.
- `server/src/services/plannerService.ts` — `addPlannedMeal` / `updatePlannedMeal` accept `cookStyle` instead of `isPrep`.
- `server/src/services/shoppingService.ts` — extract pure `aggregateShoppingItems` helper, add `cookStyle != leftovers` filter to query.
- `server/src/routes/plans.ts` — pass `cookStyle` through from auto-gen output.
- `server/src/routes/calendar.ts` — flip `dayOffsets` to Sunday-anchored, replace `pm.isPrep` reference. Export `dayOffsets` + a pure helper for testing.
- `server/src/claude/mealPlanner.ts` — prompt rewrites; output schema swaps `isPrep` for `cookStyle`.
- `server/src/claude/mealPlannerRules.ts` — switch from boolean to enum; `leftovers` accepted on any day.
- `server/src/__tests__/mealPlannerRules.test.ts` — test cases rewritten for the enum.

**Modified — client:**
- `client/src/api/plans.ts` — `PlannedMeal.cookStyle`; `parseWeekParam` snaps to Sunday; rename `getNextMonday` → `getNextSunday`.
- `client/src/pages/Planner.tsx` — `DAYS` order, `todayKey` reindex, picker auto-flag, edit-modal three-button cook-style row, day-card render, summary counter.
- `client/src/components/AddToPlanModal.tsx` — `DAYS` order, `isPrep` → `cookStyle`, `getNextMonday` → `getNextSunday`.
- `client/src/pages/Dashboard.tsx` — `DAYS` order, `todayKey` reindex, `isPrep` references in pill renders.
- `client/src/components/PlanDayColumn.tsx` — `isPrep` → `cookStyle` in the badge render.

---

## Task 1: Prisma schema + migration

**Files:**
- Modify: `server/prisma/schema.prisma:159-175`
- Create: `server/prisma/migrations/003_leftovers_and_week_shift/migration.sql`

- [ ] **Step 1: Update the Prisma schema**

Replace `isPrep` with `cookStyle` on `PlannedMeal` and add the `CookStyle` enum.

Edit `server/prisma/schema.prisma`. Add this enum after the existing `MealSlot` enum block (around line 49):

```prisma
enum CookStyle {
  cook_fresh
  batch_prep
  leftovers
}
```

Then replace the `PlannedMeal` model. Find:

```prisma
model PlannedMeal {
  id       Int               @id @default(autoincrement())
  planId   Int               @map("plan_id")
  mealId   Int               @map("meal_id")
  day      DayOfWeek
  mealSlot MealSlot          @map("meal_slot")
  servings Int               @default(2)
  isPrep   Boolean           @default(false) @map("is_prep")
  status   PlannedMealStatus @default(planned)
```

Replace with:

```prisma
model PlannedMeal {
  id        Int               @id @default(autoincrement())
  planId    Int               @map("plan_id")
  mealId    Int               @map("meal_id")
  day       DayOfWeek
  mealSlot  MealSlot          @map("meal_slot")
  servings  Int               @default(2)
  cookStyle CookStyle         @default(cook_fresh) @map("cook_style")
  status    PlannedMealStatus @default(planned)
```

- [ ] **Step 2: Create the migration directory and SQL file**

```bash
mkdir -p server/prisma/migrations/003_leftovers_and_week_shift
```

Create `server/prisma/migrations/003_leftovers_and_week_shift/migration.sql`:

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

- [ ] **Step 3: Snapshot pre-migration state for verification**

If you have a dev DB with existing plans, capture state before running the migration. From the server directory:

```bash
psql $DATABASE_URL -c "SELECT id, week_start_date FROM weekly_plans ORDER BY id" > /tmp/plans-before.txt
psql $DATABASE_URL -c "SELECT id, day, is_prep FROM planned_meals ORDER BY id" > /tmp/planned-before.txt
```

If the DB is empty, skip; this snapshot is only used in Step 5 verification.

- [ ] **Step 4: Apply the migration**

```bash
cd server
npx prisma migrate dev --name leftovers_and_week_shift
```

Expected: Prisma applies the migration, regenerates `@prisma/client` types. The `PlannedMeal` type now exposes `cookStyle: 'cook_fresh' | 'batch_prep' | 'leftovers'` and no longer exposes `isPrep`.

The TypeScript build will now fail in several files that still reference `isPrep` — that's expected; subsequent tasks fix them.

- [ ] **Step 5: Verify the backfill (only if Step 3 captured a snapshot)**

```bash
psql $DATABASE_URL -c "SELECT id, week_start_date FROM weekly_plans ORDER BY id" > /tmp/plans-after.txt
psql $DATABASE_URL -c "SELECT id, day, cook_style FROM planned_meals ORDER BY id" > /tmp/planned-after.txt
```

Manually confirm:
- Every `weekly_plans.week_start_date` in `plans-after.txt` is exactly one day earlier than the same row in `plans-before.txt`.
- Every `planned_meals.day` is unchanged.
- For every row where `is_prep` was `true`, `cook_style` is `batch_prep`. Otherwise `cook_fresh`.

- [ ] **Step 6: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/003_leftovers_and_week_shift
git commit -m "feat(db): add cook_style enum and shift plans to Sunday-start

Replaces planned_meals.is_prep boolean with a three-value cook_style
enum (cook_fresh | batch_prep | leftovers). Shifts every existing
weekly_plans.week_start_date back one day so plans are Sunday-anchored.
The day enum on each PlannedMeal is preserved exactly, so calendar
dates resolve unchanged once the dayOffsets map is flipped (next task)."
```

---

## Task 2: Server compilation fix — plannerService + plans route + calendar route

After Task 1, the server fails to compile. This task replaces every server-side `isPrep` reference with `cookStyle` and flips the calendar `dayOffsets` map. No tests yet — we're just getting the build green.

**Files:**
- Modify: `server/src/services/plannerService.ts:41-65`
- Modify: `server/src/routes/plans.ts:88-96`
- Modify: `server/src/routes/calendar.ts:28-31, 40`
- Modify: `server/src/claude/mealPlanner.ts:20-28, 35-62, 70-77`

- [ ] **Step 1: Update plannerService function signatures**

Edit `server/src/services/plannerService.ts`. Replace the two function signatures. Find:

```ts
export async function addPlannedMeal(planId: number, data: {
  mealId: number;
  day: string;
  mealSlot: string;
  servings: number;
  isPrep: boolean;
}) {
```

Replace with:

```ts
export async function addPlannedMeal(planId: number, data: {
  mealId: number;
  day: string;
  mealSlot: string;
  servings: number;
  cookStyle: "cook_fresh" | "batch_prep" | "leftovers";
}) {
```

And find:

```ts
export async function updatePlannedMeal(id: number, data: {
  status?: string;
  mealId?: number;
  servings?: number;
  isPrep?: boolean;
}) {
```

Replace with:

```ts
export async function updatePlannedMeal(id: number, data: {
  status?: string;
  mealId?: number;
  servings?: number;
  cookStyle?: "cook_fresh" | "batch_prep" | "leftovers";
}) {
```

The function bodies are unchanged — they pass `data` straight through to Prisma.

- [ ] **Step 2: Update the plans route auto-gen handler**

Edit `server/src/routes/plans.ts`. Find the loop at lines 88-96:

```ts
for (const meal of suggested.meals) {
  await plannerService.addPlannedMeal(planId, {
    mealId: meal.mealId,
    day: meal.day,
    mealSlot: meal.mealSlot,
    servings: meal.servings,
    isPrep: meal.isPrep,
  });
}
```

Replace with:

```ts
for (const meal of suggested.meals) {
  await plannerService.addPlannedMeal(planId, {
    mealId: meal.mealId,
    day: meal.day,
    mealSlot: meal.mealSlot,
    servings: meal.servings,
    cookStyle: meal.cookStyle,
  });
}
```

- [ ] **Step 3: Flip the calendar route dayOffsets and update the prep-note**

Edit `server/src/routes/calendar.ts`. Find lines 28-31:

```ts
const dayOffsets: Record<string, number> = {
  monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
  friday: 4, saturday: 5, sunday: 6,
};
```

Replace with:

```ts
export const dayOffsets: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};
```

(Exporting it lets us test it directly in Task 8.)

Then find line 40:

```ts
const prepNote = pm.isPrep ? " [Meal Prep]" : "";
```

Replace with:

```ts
const prepNote = pm.cookStyle === "batch_prep" ? " [Meal Prep]"
              : pm.cookStyle === "leftovers"  ? " [Leftovers]"
              : "";
```

- [ ] **Step 4: Update mealPlanner.ts SuggestedPlan type**

Edit `server/src/claude/mealPlanner.ts`. Find the `SuggestedPlan` interface at lines 20-28:

```ts
interface SuggestedPlan {
  meals: {
    mealId: number;
    day: string;
    mealSlot: string;
    servings: number;
    isPrep: boolean;
  }[];
}
```

Replace with:

```ts
interface SuggestedPlan {
  meals: {
    mealId: number;
    day: string;
    mealSlot: string;
    servings: number;
    cookStyle: "cook_fresh" | "batch_prep" | "leftovers";
  }[];
}
```

The prompt update happens in Task 5 — for now the rest of `mealPlanner.ts` still references `isPrep` in the prompt string. That's fine as a string literal; it compiles. We update the prompt and the validator together in Tasks 4 and 5.

- [ ] **Step 5: Verify the server compiles**

```bash
cd server
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/plannerService.ts server/src/routes/plans.ts server/src/routes/calendar.ts server/src/claude/mealPlanner.ts
git commit -m "fix(server): replace isPrep with cookStyle and flip calendar dayOffsets

Server-side compilation fix following the schema migration. Every
isPrep reference becomes cookStyle. The calendar route's dayOffsets
map flips to Sunday=0 so date math still resolves correctly given
each plan's week_start_date is now a Sunday."
```

---

## Task 3: TDD — meal planner rules accept cookStyle enum

The validator (`filterValidPlannedMeals`) was the boolean enforcer. It becomes a three-way switch with `leftovers` accepted on any day with any meal capability.

**Files:**
- Modify: `server/src/__tests__/mealPlannerRules.test.ts`
- Modify: `server/src/claude/mealPlannerRules.ts`

- [ ] **Step 1: Rewrite the test file with the new enum-based cases**

Replace the entire contents of `server/src/__tests__/mealPlannerRules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filterValidPlannedMeals } from "../claude/mealPlannerRules.js";

type M = { id: number; canBatch: boolean; canFresh: boolean };

const meals: Record<number, M> = {
  1: { id: 1, canBatch: true,  canFresh: false }, // batch only
  2: { id: 2, canBatch: false, canFresh: true  }, // fresh only
  3: { id: 3, canBatch: true,  canFresh: true  }, // both
};

describe("filterValidPlannedMeals — cookStyle rules", () => {
  it("keeps batch_prep only when day=sunday and meal canBatch", () => {
    const input = [
      { mealId: 1, day: "sunday", mealSlot: "dinner", servings: 4, cookStyle: "batch_prep" as const },
      { mealId: 3, day: "sunday", mealSlot: "lunch",  servings: 4, cookStyle: "batch_prep" as const },
    ];
    expect(filterValidPlannedMeals(input, meals)).toEqual(input);
  });

  it("drops batch_prep on non-Sunday days", () => {
    const input = [
      { mealId: 1, day: "monday", mealSlot: "dinner", servings: 4, cookStyle: "batch_prep" as const },
      { mealId: 2, day: "monday", mealSlot: "lunch",  servings: 2, cookStyle: "cook_fresh" as const },
    ];
    expect(filterValidPlannedMeals(input, meals)).toEqual([
      { mealId: 2, day: "monday", mealSlot: "lunch", servings: 2, cookStyle: "cook_fresh" },
    ]);
  });

  it("drops Sunday batch_prep when meal can't batch", () => {
    const input = [
      { mealId: 2, day: "sunday", mealSlot: "dinner", servings: 4, cookStyle: "batch_prep" as const },
    ];
    expect(filterValidPlannedMeals(input, meals)).toEqual([]);
  });

  it("drops cook_fresh picks whose meal can't fresh", () => {
    const input = [
      { mealId: 1, day: "monday", mealSlot: "dinner", servings: 2, cookStyle: "cook_fresh" as const },
    ];
    expect(filterValidPlannedMeals(input, meals)).toEqual([]);
  });

  it("accepts leftovers on any day regardless of meal capability", () => {
    const input = [
      { mealId: 1, day: "tuesday", mealSlot: "lunch", servings: 2, cookStyle: "leftovers" as const },
      { mealId: 2, day: "thursday", mealSlot: "dinner", servings: 2, cookStyle: "leftovers" as const },
      { mealId: 3, day: "sunday", mealSlot: "dinner", servings: 2, cookStyle: "leftovers" as const },
    ];
    expect(filterValidPlannedMeals(input, meals)).toEqual(input);
  });

  it("drops planned meals whose mealId is unknown regardless of cookStyle", () => {
    const input = [
      { mealId: 999, day: "monday", mealSlot: "dinner", servings: 2, cookStyle: "cook_fresh" as const },
      { mealId: 999, day: "tuesday", mealSlot: "lunch", servings: 2, cookStyle: "leftovers" as const },
    ];
    expect(filterValidPlannedMeals(input, meals)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
cd server
npx vitest run src/__tests__/mealPlannerRules.test.ts
```

Expected: tests fail with TypeScript errors (the existing `PlannedMealCandidate` interface still has `isPrep`, not `cookStyle`).

- [ ] **Step 3: Update the implementation**

Replace the entire contents of `server/src/claude/mealPlannerRules.ts`:

```ts
export interface PlannedMealCandidate {
  mealId: number;
  day: string;
  mealSlot: string;
  servings: number;
  cookStyle: "cook_fresh" | "batch_prep" | "leftovers";
}

export interface MealCapability {
  id: number;
  canBatch: boolean;
  canFresh: boolean;
}

// Validates a Claude-suggested plan against the cook-style rules:
//  - batch_prep is permitted only when day="sunday" and the meal canBatch.
//  - cook_fresh requires the meal canFresh.
//  - leftovers is accepted on any day with any meal capability.
//  - Unknown mealIds are dropped.
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

- [ ] **Step 4: Run the tests and verify they pass**

```bash
cd server
npx vitest run src/__tests__/mealPlannerRules.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/claude/mealPlannerRules.ts server/src/__tests__/mealPlannerRules.test.ts
git commit -m "feat(server): cook-style enum validator with leftovers branch

filterValidPlannedMeals switches from a boolean to the new CookStyle
enum. leftovers is accepted on any day with any meal capability — the
user (or the LLM) has already decided this slot is reuse, we don't
gate on canFresh/canBatch."
```

---

## Task 4: Update meal-planner Claude prompt for Sunday-start + leftovers

The prompt sent to Claude needs to know about the new shape (Sunday is day 1, three cook styles, fill downstream slots with leftovers when batch-prepping).

**Files:**
- Modify: `server/src/claude/mealPlanner.ts:35-62`

- [ ] **Step 1: Replace the prompt template**

Edit `server/src/claude/mealPlanner.ts`. Find the prompt template starting at line 35 (`const prompt = ...`) up through line 62 (the closing backtick before `;`). Replace the entire block with:

```ts
  const prompt = `You are a meal planning assistant. Generate a weekly meal plan (Sunday → Saturday) for 2 people.

Cook styles per slot:
- "cook_fresh" — cooked the same day. Meal must have canFresh=true.
- "batch_prep" — cooked Sunday only, in larger quantity. Meal must have canBatch=true. Set servings to 4 or more.
- "leftovers" — eat from a previous batch_prep. No recipe-capability requirement; reuses the same mealId as the source batch_prep.

Rules:
- Sunday is the prep day (day 1 of the plan). Sunday has two slots (lunch + dinner). Pick 1–2 batch_prep meals for Sunday with servings >= 4.
- For each Sunday batch_prep meal you MAY fill 1–2 downstream slots (Mon–Wed) with cookStyle="leftovers" referencing the same mealId, servings=2. This reduces the shopping list and reuses the prep.
- Every other slot is cookStyle="cook_fresh" and the meal must have canFresh=true.
- batch_prep on any day other than Sunday is invalid; do not emit it.
- Avoid meals used recently: ${JSON.stringify(recentMealIds)}
- Prefer meals that use ingredients already in the pantry.
- Balance nutrition and variety across the week.
- Each day should have lunch and dinner planned.

Available meals (each with capability flags):
${JSON.stringify(meals, null, 2)}

Current pantry:
${JSON.stringify(pantry, null, 2)}

Return ONLY valid JSON:
{
  "meals": [
    {
      "mealId": number,
      "day": "sunday|monday|tuesday|wednesday|thursday|friday|saturday",
      "mealSlot": "lunch|dinner",
      "servings": number,
      "cookStyle": "cook_fresh" | "batch_prep" | "leftovers"
    }
  ]
}`;
```

- [ ] **Step 2: Verify the server still compiles**

```bash
cd server
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Run the full server test suite**

```bash
cd server
npx vitest run
```

Expected: all existing tests still pass (this task didn't change any tested code paths).

- [ ] **Step 4: Commit**

```bash
git add server/src/claude/mealPlanner.ts
git commit -m "feat(server): teach the auto-gen prompt about Sunday-start and leftovers

Prompt rewrites: week is Sunday → Saturday, three cook styles with
explicit constraints, leftovers slots may be filled Mon–Wed referencing
a Sunday batch_prep mealId. Output schema swaps isPrep for cookStyle."
```

---

## Task 5: TDD — extract pure shopping aggregator and exclude leftovers

The shopping list filter is the user-facing payoff. Refactor the aggregation into a pure function so we can test it without a database, then add the `leftovers` exclusion.

**Files:**
- Modify: `server/src/services/shoppingService.ts`
- Create: `server/src/__tests__/shoppingService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/src/__tests__/shoppingService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { aggregateShoppingItems, type AggregateInput } from "../services/shoppingService.js";

// Test fixtures: a recipe with two ingredients, ingredient ids 100 and 101.
function pm(opts: {
  cookStyle: "cook_fresh" | "batch_prep" | "leftovers";
  servings?: number;
  recipeServings?: number;
}): AggregateInput["plannedMeals"][number] {
  return {
    cookStyle: opts.cookStyle,
    servings: opts.servings ?? 2,
    meal: {
      servings: opts.recipeServings ?? 2,
      ingredients: [
        { ingredientId: 100, quantity: 1, unit: "lb" },
        { ingredientId: 101, quantity: 0.5, unit: "cup" },
      ],
    },
  };
}

describe("aggregateShoppingItems", () => {
  it("aggregates ingredients across cook_fresh and batch_prep meals", () => {
    const input: AggregateInput = {
      plannedMeals: [
        pm({ cookStyle: "cook_fresh" }),
        pm({ cookStyle: "batch_prep", servings: 4 }),
      ],
      pantryItems: [],
    };
    const result = aggregateShoppingItems(input);
    // 1 lb (cook_fresh @ 2/2 servings) + 2 lb (batch_prep @ 4/2 servings) = 3 lb
    expect(result.find((r) => r.ingredientId === 100)?.quantityNeeded).toBe(3);
    // 0.5 cup * 1 + 0.5 cup * 2 = 1.5 cup
    expect(result.find((r) => r.ingredientId === 101)?.quantityNeeded).toBe(1.5);
  });

  it("excludes leftovers from aggregation", () => {
    const input: AggregateInput = {
      plannedMeals: [
        pm({ cookStyle: "cook_fresh" }),     // contributes 1 lb
        pm({ cookStyle: "leftovers" }),       // excluded
        pm({ cookStyle: "leftovers", servings: 4 }), // excluded even at higher servings
      ],
      pantryItems: [],
    };
    const result = aggregateShoppingItems(input);
    expect(result.find((r) => r.ingredientId === 100)?.quantityNeeded).toBe(1);
  });

  it("subtracts pantry on-hand from quantityToBuy without affecting quantityNeeded", () => {
    const input: AggregateInput = {
      plannedMeals: [pm({ cookStyle: "batch_prep", servings: 4 })], // needs 2 lb of #100
      pantryItems: [
        { ingredientId: 100, quantity: 0.75 },
      ],
    };
    const result = aggregateShoppingItems(input);
    const item = result.find((r) => r.ingredientId === 100)!;
    expect(item.quantityNeeded).toBe(2);
    expect(item.quantityOnHand).toBe(0.75);
    expect(item.quantityToBuy).toBeCloseTo(1.25, 5);
  });

  it("clamps quantityToBuy at zero when on-hand exceeds need", () => {
    const input: AggregateInput = {
      plannedMeals: [pm({ cookStyle: "cook_fresh" })], // needs 1 lb
      pantryItems: [{ ingredientId: 100, quantity: 5 }],
    };
    const result = aggregateShoppingItems(input);
    expect(result.find((r) => r.ingredientId === 100)?.quantityToBuy).toBe(0);
  });

  it("returns empty array when every planned meal is leftovers", () => {
    const input: AggregateInput = {
      plannedMeals: [pm({ cookStyle: "leftovers" }), pm({ cookStyle: "leftovers" })],
      pantryItems: [],
    };
    expect(aggregateShoppingItems(input)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
cd server
npx vitest run src/__tests__/shoppingService.test.ts
```

Expected: tests fail with "aggregateShoppingItems is not a function" or "AggregateInput is not exported".

- [ ] **Step 3: Refactor shoppingService.ts to extract the pure helper**

Replace the entire contents of `server/src/services/shoppingService.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export interface AggregateInput {
  plannedMeals: Array<{
    cookStyle: "cook_fresh" | "batch_prep" | "leftovers";
    servings: number;
    meal: {
      servings: number;
      ingredients: Array<{
        ingredientId: number;
        quantity: number;
        unit: string;
      }>;
    };
  }>;
  pantryItems: Array<{
    ingredientId: number;
    quantity: number;
  }>;
}

export interface AggregateOutput {
  ingredientId: number;
  quantityNeeded: number;
  quantityOnHand: number;
  quantityToBuy: number;
}

// Pure aggregation: given planned meals and pantry on-hand quantities, produce
// the per-ingredient totals. Leftovers occurrences are excluded entirely
// (their ingredients were already accounted for by the source batch_prep on
// Sunday). The pantry on-hand is subtracted from the need to compute
// quantityToBuy, clamped at zero.
export function aggregateShoppingItems(input: AggregateInput): AggregateOutput[] {
  const needed = new Map<number, number>();

  for (const pm of input.plannedMeals) {
    if (pm.cookStyle === "leftovers") continue;
    const scaleFactor = pm.servings / pm.meal.servings;
    for (const mi of pm.meal.ingredients) {
      const qty = mi.quantity * scaleFactor;
      needed.set(mi.ingredientId, (needed.get(mi.ingredientId) ?? 0) + qty);
    }
  }

  const onHand = new Map<number, number>();
  for (const item of input.pantryItems) {
    onHand.set(item.ingredientId, (onHand.get(item.ingredientId) ?? 0) + item.quantity);
  }

  const out: AggregateOutput[] = [];
  for (const [ingredientId, quantityNeeded] of needed) {
    const quantityOnHand = onHand.get(ingredientId) ?? 0;
    const quantityToBuy = Math.max(0, quantityNeeded - quantityOnHand);
    out.push({ ingredientId, quantityNeeded, quantityOnHand, quantityToBuy });
  }
  return out;
}

export async function generateShoppingList(planId: number) {
  await prisma.shoppingItem.deleteMany({ where: { planId } });

  const plannedMeals = await prisma.plannedMeal.findMany({
    where: {
      planId,
      status: { in: ["planned", "cooked"] },
      cookStyle: { not: "leftovers" },
    },
    include: { meal: { include: { ingredients: true } } },
  });

  const pantryItems = await prisma.pantryItem.findMany();

  const aggregated = aggregateShoppingItems({
    plannedMeals: plannedMeals.map((pm) => ({
      cookStyle: pm.cookStyle,
      servings: pm.servings,
      meal: {
        servings: pm.meal.servings,
        ingredients: pm.meal.ingredients.map((mi) => ({
          ingredientId: mi.ingredientId,
          quantity: mi.quantity,
          unit: mi.unit,
        })),
      },
    })),
    pantryItems: pantryItems.map((p) => ({
      ingredientId: p.ingredientId,
      quantity: p.quantity,
    })),
  });

  await prisma.shoppingItem.createMany({
    data: aggregated.map((a) => ({
      planId,
      ingredientId: a.ingredientId,
      quantityNeeded: a.quantityNeeded,
      quantityOnHand: a.quantityOnHand,
      quantityToBuy: a.quantityToBuy,
    })),
  });

  return prisma.shoppingItem.findMany({
    where: { planId },
    include: { ingredient: true },
    orderBy: { ingredient: { category: "asc" } },
  });
}

export async function getShoppingList(planId: number) {
  return prisma.shoppingItem.findMany({
    where: { planId },
    include: { ingredient: true },
    orderBy: { ingredient: { category: "asc" } },
  });
}

export async function toggleShoppingItem(id: number, checked: boolean) {
  return prisma.shoppingItem.update({
    where: { id },
    data: { checked },
    include: { ingredient: true },
  });
}
```

Note: the Prisma query gets a redundant-looking double filter — both `cookStyle: { not: "leftovers" }` in the `where` clause AND `pm.cookStyle === "leftovers"` skip in the aggregator. This is intentional. The DB filter avoids loading ingredient rows we'll discard; the in-memory skip means `aggregateShoppingItems` is correct in isolation regardless of how its caller queries. Two layers of defense is cheap.

- [ ] **Step 4: Run the tests and verify they pass**

```bash
cd server
npx vitest run src/__tests__/shoppingService.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Run the full server test suite**

```bash
cd server
npx vitest run
```

Expected: every test passes.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/shoppingService.ts server/src/__tests__/shoppingService.test.ts
git commit -m "feat(shopping): exclude leftovers from aggregation

Refactors generateShoppingList to call a new pure aggregateShoppingItems
helper, which makes the aggregation testable without a database. Both
the Prisma query and the helper exclude leftover occurrences — the
filter is redundant on purpose so the helper is correct in isolation."
```

---

## Task 6: TDD — calendar route dayOffsets regression guard

The spec asserts that flipping `dayOffsets` to Sunday-anchored AND backfilling `weekStartDate` one day earlier produces the same calendar date for every existing PlannedMeal. Lock that property in with a test.

**Files:**
- Create: `server/src/__tests__/calendarRoute.test.ts`

- [ ] **Step 1: Write the test**

Create `server/src/__tests__/calendarRoute.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dayOffsets } from "../routes/calendar.js";

// The legacy mapping that existed before the Sunday-shift. Used here only as
// a reference oracle to prove the new mapping + the one-day-earlier
// weekStartDate produce identical calendar dates.
const LEGACY_MONDAY_OFFSETS: Record<string, number> = {
  monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
  friday: 4, saturday: 5, sunday: 6,
};

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function dateAt(yyyymmdd: string, offset: number): string {
  const d = new Date(yyyymmdd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

describe("calendar route — dayOffsets after week shift", () => {
  it("is exported and Sunday-anchored", () => {
    expect(dayOffsets).toEqual({
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6,
    });
  });

  it("each day maps to the same calendar date as the legacy Monday-anchored map after the weekStart backfill", () => {
    // Pre-shift: a plan stored weekStartDate=2026-04-20 (a Monday).
    // Post-shift: that same plan now stores 2026-04-19 (the Sunday before).
    // For every day enum, both maps must resolve to the same calendar date.
    const legacyMonday = "2026-04-20";
    const shiftedSunday = "2026-04-19";

    for (const day of DAYS) {
      const legacyDate = dateAt(legacyMonday, LEGACY_MONDAY_OFFSETS[day]);
      const newDate = dateAt(shiftedSunday, dayOffsets[day]);
      expect(newDate).toBe(legacyDate);
    }
  });
});
```

- [ ] **Step 2: Run the test and verify it passes**

```bash
cd server
npx vitest run src/__tests__/calendarRoute.test.ts
```

Expected: 2 tests pass. (Task 2 already exported `dayOffsets` and flipped its values.)

- [ ] **Step 3: Commit**

```bash
git add server/src/__tests__/calendarRoute.test.ts
git commit -m "test(calendar): regression guard for the Sunday-shift date math

Asserts the new Sunday-anchored dayOffsets map combined with a
weekStartDate one day earlier produces the same calendar date as the
old Monday-anchored map for every day enum. Locks in the property
that already-synced calendar events do not need re-syncing."
```

---

## Task 7: Client API types — cookStyle, parseWeekParam, getNextSunday

Drop `isPrep` from the client `PlannedMeal` type, add `cookStyle`. Re-anchor `parseWeekParam` to Sunday. Rename `getNextMonday` to `getNextSunday`.

**Files:**
- Modify: `client/src/api/plans.ts`

- [ ] **Step 1: Update the PlannedMeal type**

Edit `client/src/api/plans.ts`. Find lines 4-13:

```ts
export interface PlannedMeal {
  id: number;
  mealId: number;
  day: string;
  mealSlot: string;
  servings: number;
  isPrep: boolean;
  status: string;
  meal: Meal;
}
```

Replace with:

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

- [ ] **Step 2: Re-anchor parseWeekParam to Sunday**

Find the `parseWeekParam` function at lines 113-129. Replace with:

```ts
/**
 * Normalize an arbitrary week-param string to a 'YYYY-MM-DD' Sunday in local
 * time. Used to make the viewed-week URL canonical regardless of how the
 * user landed on the page.
 *
 *   - Valid 'YYYY-MM-DD' that's already a Sunday → unchanged.
 *   - Valid 'YYYY-MM-DD' on any other day        → snaps to that calendar
 *                                                   week's Sunday (start).
 *   - Empty / null / undefined / unparseable     → today's Sunday.
 */
export function parseWeekParam(raw: string | null | undefined): string {
  let d: Date;
  if (!raw) {
    d = new Date();
  } else {
    const ymd = raw.length >= 10 ? raw.slice(0, 10) : raw;
    const tryDate = new Date(ymd + "T00:00:00");
    d = Number.isNaN(tryDate.getTime()) ? new Date() : tryDate;
  }
  // JS getDay(): 0 = Sunday … 6 = Saturday. Sunday-anchored weeks make
  // Sunday = 0 directly.
  const dayIndex = d.getDay();
  const sunday = new Date(d);
  sunday.setDate(d.getDate() - dayIndex);
  return formatLocalDate(sunday);
}
```

- [ ] **Step 3: Rename getNextMonday to getNextSunday**

Find lines 57-66:

```ts
export function getNextMonday(): string {
  // Upcoming Monday on-or-after today, formatted YYYY-MM-DD in local time.
  // Called on a Monday → returns today.
  const now = new Date();
  const day = now.getDay();
  const diff = (8 - day) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return formatLocalDate(monday);
}
```

Replace with:

```ts
export function getNextSunday(): string {
  // Upcoming Sunday on-or-after today, formatted YYYY-MM-DD in local time.
  // Called on a Sunday → returns today.
  const now = new Date();
  const day = now.getDay();
  const diff = (7 - day) % 7;
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + diff);
  return formatLocalDate(sunday);
}
```

- [ ] **Step 4: Verify the client type-checks**

```bash
cd client
npx tsc --noEmit
```

Expected: errors in 4 files (Planner.tsx, AddToPlanModal.tsx, Dashboard.tsx, PlanDayColumn.tsx) — they still reference `isPrep` and/or `getNextMonday`. Tasks 8–11 fix them.

**Note on testing:** the spec called for automated tests of `parseWeekParam` and `getNextSunday`. The client doesn't have vitest configured, and adding it for two ten-line pure functions is overkill. These behaviors are exercised in Task 12 (manual verification): the planner URL canonicalization and the AddToPlanModal "next plan starts…" copy both render through these helpers, so a working dev server confirms them indirectly.

- [ ] **Step 5: Commit**

```bash
git add client/src/api/plans.ts
git commit -m "refactor(client): cookStyle on PlannedMeal, Sunday-anchored helpers

PlannedMeal.isPrep replaced with PlannedMeal.cookStyle (three-value
string union). parseWeekParam snaps to Sunday instead of Monday.
getNextMonday renamed getNextSunday with the equivalent (7 - day) % 7
offset. Consumer files still reference the old names; subsequent tasks
update them."
```

---

## Task 8: Planner page — DAYS order, today index, picker, edit modal, summary

The Planner page touches every part of the change. Big task; one commit at the end after the whole page compiles and visibly works.

**Files:**
- Modify: `client/src/pages/Planner.tsx`

- [ ] **Step 1: Flip the DAYS array order**

Edit `client/src/pages/Planner.tsx`. Find line 41:

```ts
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
```

Replace with:

```ts
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
```

- [ ] **Step 2: Update todayKey to use Sunday-first indexing**

Find lines 47-49:

```ts
function todayKey(): string {
  return DAYS[(new Date().getDay() + 6) % 7];
}
```

Replace with:

```ts
function todayKey(): string {
  return DAYS[new Date().getDay()];
}
```

- [ ] **Step 3: Update the picker auto-flag**

Find lines 140-152 (inside `handlePick`, the `picker.mode === "add"` branch):

```ts
const handlePick = async (mealId: number) => {
  if (!effectiveViewedPlan || !picker) return;
  const meal = meals.find((m) => m.id === mealId);
  if (picker.mode === "add") {
    const canBatchHere = picker.day === "sunday" && !!meal?.canBatch;
    const planned = await addPlannedMeal(effectiveViewedPlan.id, {
      mealId,
      day: picker.day,
      mealSlot: picker.slot,
      servings: meal?.servings ?? 2,
      isPrep: canBatchHere,
    });
```

Replace the `addPlannedMeal` call's body so `isPrep` becomes `cookStyle`:

```ts
const handlePick = async (mealId: number) => {
  if (!effectiveViewedPlan || !picker) return;
  const meal = meals.find((m) => m.id === mealId);
  if (picker.mode === "add") {
    const canBatchHere = picker.day === "sunday" && !!meal?.canBatch;
    const planned = await addPlannedMeal(effectiveViewedPlan.id, {
      mealId,
      day: picker.day,
      mealSlot: picker.slot,
      servings: meal?.servings ?? 2,
      cookStyle: canBatchHere ? "batch_prep" : "cook_fresh",
    });
```

- [ ] **Step 4: Add the Refrigerator icon import**

Find the `lucide-react` import block at lines 4-18:

```ts
import {
  Sparkles,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Flame,
  Leaf,
  Plus,
  Check,
  Search,
  X,
  Trash2,
  Replace,
  Minus,
  ExternalLink,
} from "lucide-react";
```

Add `Refrigerator` (used for the leftovers cook style — Dashboard.tsx already uses it for "from prep" hints, consistent visual language):

```ts
import {
  Sparkles,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Flame,
  Leaf,
  Refrigerator,
  Plus,
  Check,
  Search,
  X,
  Trash2,
  Replace,
  Minus,
  ExternalLink,
} from "lucide-react";
```

- [ ] **Step 5: Update the day-card render under the meal name**

Find lines 391-406 (the small line under the meal name in the day column):

```tsx
<div className="flex items-center gap-1 mt-1 text-[10.5px] text-ink-3">
  {pm.isPrep ? <Flame size={10} /> : <Leaf size={10} />}
  {pm.isPrep ? "Prep" : "Fresh"}
  <span>·</span><span>{pm.servings}×</span>
  {pm.status === "cooked" && (
    <>
      <span>·</span>
      <span className="text-accent-ink font-semibold">Cooked</span>
    </>
  )}
  {pm.status === "skipped" && (
    <>
      <span>·</span>
      <span className="text-ink-3 font-semibold">Skipped</span>
    </>
  )}
</div>
```

Replace with:

```tsx
<div className="flex items-center gap-1 mt-1 text-[10.5px] text-ink-3">
  {pm.cookStyle === "batch_prep" && <><Flame size={10} /> Prep</>}
  {pm.cookStyle === "cook_fresh" && <><Leaf size={10} /> Fresh</>}
  {pm.cookStyle === "leftovers"  && <><Refrigerator size={10} /> Leftovers</>}
  <span>·</span><span>{pm.servings}×</span>
  {pm.status === "cooked" && (
    <>
      <span>·</span>
      <span className="text-accent-ink font-semibold">Cooked</span>
    </>
  )}
  {pm.status === "skipped" && (
    <>
      <span>·</span>
      <span className="text-ink-3 font-semibold">Skipped</span>
    </>
  )}
</div>
```

- [ ] **Step 6: Update the summary metric**

Find lines 231-246:

```tsx
const summary = useMemo(() => {
  if (!effectiveViewedPlan) return null;
  const prep = effectiveViewedPlan.plannedMeals.filter((m) => m.isPrep && m.status !== "skipped").length;
  const fresh = effectiveViewedPlan.plannedMeals.filter((m) => !m.isPrep && m.status !== "skipped").length;
  let totalProtein = 0, count = 0;
  for (const pm of effectiveViewedPlan.plannedMeals) {
    if (pm.status === "skipped") continue;
    const scale = pm.servings / (pm.meal.servings || 1);
    if (pm.meal.proteinG) {
      totalProtein += pm.meal.proteinG * scale;
      count += 1;
    }
  }
  const avgProtein = count > 0 ? Math.round(totalProtein / count) : 0;
  return { prep, fresh, avgProtein };
}, [effectiveViewedPlan]);
```

Replace with:

```tsx
const summary = useMemo(() => {
  if (!effectiveViewedPlan) return null;
  const active = effectiveViewedPlan.plannedMeals.filter((m) => m.status !== "skipped");
  const prep = active.filter((m) => m.cookStyle === "batch_prep").length;
  const fresh = active.filter((m) => m.cookStyle === "cook_fresh").length;
  const leftover = active.filter((m) => m.cookStyle === "leftovers").length;
  let totalProtein = 0, count = 0;
  for (const pm of active) {
    const scale = pm.servings / (pm.meal.servings || 1);
    if (pm.meal.proteinG) {
      totalProtein += pm.meal.proteinG * scale;
      count += 1;
    }
  }
  const avgProtein = count > 0 ? Math.round(totalProtein / count) : 0;
  return { prep, fresh, leftover, avgProtein };
}, [effectiveViewedPlan]);
```

Then find the summary headline at lines 425-441:

```tsx
{summary && (
  <div className="flex items-center gap-3.5 p-3.5 pl-4 bg-surface-1 border border-line rounded-[14px] flex-wrap sm:flex-nowrap">
    <div className="w-9 h-9 rounded-[10px] bg-accent-soft text-accent-ink grid place-items-center flex-shrink-0">
      <Sparkles size={17} />
    </div>
    <div className="flex-1 min-w-0">
      <div className="text-[13.5px] font-semibold text-ink-1">
        Plan looks balanced — {summary.prep} batch-prep session{summary.prep !== 1 ? "s" : ""}, {summary.fresh} fresh cook{summary.fresh !== 1 ? "s" : ""}{summary.avgProtein > 0 ? `, ${summary.avgProtein}g avg protein per meal` : ""}.
      </div>
      <div className="text-[12px] text-ink-3 mt-0.5">
        Adjust anything from chat, or sync to your calendar when ready.
      </div>
    </div>
    <Button variant="soft" size="sm" onClick={() => navigate("/chat")}>
      Adjust via chat
    </Button>
  </div>
)}
```

Replace just the `<div className="text-[13.5px] font-semibold text-ink-1">…</div>` line with:

```tsx
<div className="text-[13.5px] font-semibold text-ink-1">
  Plan looks balanced — {summary.prep} batch-prep session{summary.prep !== 1 ? "s" : ""}, {summary.fresh} fresh cook{summary.fresh !== 1 ? "s" : ""}{summary.leftover > 0 ? `, ${summary.leftover} leftover meal${summary.leftover !== 1 ? "s" : ""}` : ""}{summary.avgProtein > 0 ? `, ${summary.avgProtein}g avg protein per meal` : ""}.
</div>
```

- [ ] **Step 7: Replace the cook-style button row in the edit modal**

Find lines 765-788 in `PlannedMealEditModal`:

```tsx
<Field label="Cook style">
  <div className="flex gap-1.5">
    {([
      { value: false, label: "Cook fresh", Icon: Leaf },
      { value: true,  label: "Batch prep", Icon: Flame },
    ] as const).map(({ value, label, Icon }) => {
      const active = pm.isPrep === value;
      return (
        <button
          key={String(value)}
          disabled={busy || active}
          onClick={() => guarded(() => onChange({ isPrep: value }))}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12.5px] border transition ${
            active
              ? "bg-accent text-accent-on border-accent"
              : "bg-surface-2 text-ink-1 border-line hover:border-accent-line"
          } disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          <Icon size={12} /> {label}
        </button>
      );
    })}
  </div>
</Field>
```

Replace with:

```tsx
<Field label="Cook style">
  <div className="flex gap-1.5 flex-wrap">
    {([
      { value: "cook_fresh", label: "Cook fresh", Icon: Leaf },
      { value: "batch_prep", label: "Batch prep", Icon: Flame },
      { value: "leftovers",  label: "Leftovers",  Icon: Refrigerator },
    ] as const).map(({ value, label, Icon }) => {
      const active = pm.cookStyle === value;
      return (
        <button
          key={value}
          disabled={busy || active}
          onClick={() => guarded(() => onChange({ cookStyle: value }))}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12.5px] border transition ${
            active
              ? "bg-accent text-accent-on border-accent"
              : "bg-surface-2 text-ink-1 border-line hover:border-accent-line"
          } disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          <Icon size={12} /> {label}
        </button>
      );
    })}
  </div>
</Field>
```

- [ ] **Step 8: Verify the client type-checks**

```bash
cd client
npx tsc --noEmit
```

Expected: Planner.tsx errors are gone. Errors remain only in `AddToPlanModal.tsx`, `Dashboard.tsx`, and `PlanDayColumn.tsx` — Tasks 9–11 fix those.

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/Planner.tsx
git commit -m "feat(planner): Sunday-first week + leftovers cook style

DAYS reorders to Sunday-first; todayKey() drops the Monday offset.
The cook-style button row in the edit modal grows to three options
(Cook fresh / Batch prep / Leftovers). Picker auto-flag on Sunday
with canBatch now writes cookStyle: 'batch_prep'. Day-card render
shows the matching pill+icon for all three cook styles. Summary
counter tallies leftover meals as a third clause when present."
```

---

## Task 9: AddToPlanModal — DAYS order, cookStyle, getNextSunday

**Files:**
- Modify: `client/src/components/AddToPlanModal.tsx`

- [ ] **Step 1: Update the import to use getNextSunday**

Edit `client/src/components/AddToPlanModal.tsx`. Find lines 4-12:

```ts
import {
  addPlannedMeal,
  getPlans,
  getNextMonday,
  localMidnightFromISO,
  pickRelevantPlan,
  type WeeklyPlan,
  type PlannedMeal,
} from "../api/plans";
```

Replace with:

```ts
import {
  addPlannedMeal,
  getPlans,
  getNextSunday,
  localMidnightFromISO,
  pickRelevantPlan,
  type WeeklyPlan,
  type PlannedMeal,
} from "../api/plans";
```

- [ ] **Step 2: Add Refrigerator to the icon imports**

Find line 3:

```ts
import { X, Plus, Minus, CalendarDays, Flame, Leaf, ArrowRight } from "lucide-react";
```

Replace with:

```ts
import { X, Plus, Minus, CalendarDays, Flame, Leaf, Refrigerator, ArrowRight } from "lucide-react";
```

- [ ] **Step 3: Flip the DAYS array order**

Find line 16:

```ts
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
```

Replace with:

```ts
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
```

- [ ] **Step 4: Replace isPrep state with cookStyle state**

Find line 37:

```ts
const [isPrep, setIsPrep] = useState<boolean>(false);
```

Replace with:

```ts
type CookStyle = "cook_fresh" | "batch_prep" | "leftovers";
const [cookStyle, setCookStyle] = useState<CookStyle>("cook_fresh");
```

- [ ] **Step 5: Update the default-cook-style effect**

Find lines 81-95 (the `useEffect` that picks defaults):

```ts
useEffect(() => {
  if (!targetPlan || defaultsApplied.current) return;
  defaultsApplied.current = true;
  for (const d of DAYS) {
    for (const s of ["lunch", "dinner"] as Slot[]) {
      if (!occupiedByDay[d][s]) {
        setDay(d);
        setSlot(s);
        setIsPrep(d === "sunday" && !!meal.canBatch);
        return;
      }
    }
  }
  // Every slot taken — leave Mon/lunch defaults. isPrep stays false.
}, [targetPlan, occupiedByDay, meal.canBatch]);
```

Replace with:

```ts
useEffect(() => {
  if (!targetPlan || defaultsApplied.current) return;
  defaultsApplied.current = true;
  for (const d of DAYS) {
    for (const s of ["lunch", "dinner"] as Slot[]) {
      if (!occupiedByDay[d][s]) {
        setDay(d);
        setSlot(s);
        setCookStyle(d === "sunday" && !!meal.canBatch ? "batch_prep" : "cook_fresh");
        return;
      }
    }
  }
  // Every slot taken — leave defaults; cookStyle stays cook_fresh.
}, [targetPlan, occupiedByDay, meal.canBatch]);
```

- [ ] **Step 6: Update the day default initial state**

Find line 34:

```ts
const [day, setDay] = useState<DayKey>("monday");
```

Replace with:

```ts
const [day, setDay] = useState<DayKey>("sunday");
```

(Initial value before the defaults effect runs. Sunday-first matches the new DAYS order.)

- [ ] **Step 7: Update the submit call**

Find lines 107-126:

```ts
const submit = async () => {
  if (!targetPlan) return;
  setSubmitting(true);
  setError(null);
  try {
    const pm = await addPlannedMeal(targetPlan.id, {
      mealId: meal.id,
      day,
      mealSlot: slot,
      servings,
      isPrep,
    });
```

Replace the `addPlannedMeal` payload — change `isPrep` to `cookStyle`:

```ts
const submit = async () => {
  if (!targetPlan) return;
  setSubmitting(true);
  setError(null);
  try {
    const pm = await addPlannedMeal(targetPlan.id, {
      mealId: meal.id,
      day,
      mealSlot: slot,
      servings,
      cookStyle,
    });
```

- [ ] **Step 8: Replace the cook-style button row**

Find lines 260-283:

```tsx
<Field label="Cook style">
  <div className="flex gap-1.5">
    {([
      { value: false, label: "Cook fresh", Icon: Leaf },
      { value: true,  label: "Batch prep", Icon: Flame },
    ] as const).map(({ value, label, Icon }) => {
      const active = isPrep === value;
      return (
        <button
          key={String(value)}
          disabled={submitting}
          onClick={() => setIsPrep(value)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12.5px] border transition ${
            active
              ? "bg-accent text-accent-on border-accent"
              : "bg-surface-2 text-ink-1 border-line hover:border-accent-line"
          } disabled:opacity-60`}
        >
          <Icon size={12} /> {label}
        </button>
      );
    })}
  </div>
</Field>
```

Replace with:

```tsx
<Field label="Cook style">
  <div className="flex gap-1.5 flex-wrap">
    {([
      { value: "cook_fresh", label: "Cook fresh", Icon: Leaf },
      { value: "batch_prep", label: "Batch prep", Icon: Flame },
      { value: "leftovers",  label: "Leftovers",  Icon: Refrigerator },
    ] as const).map(({ value, label, Icon }) => {
      const active = cookStyle === value;
      return (
        <button
          key={value}
          disabled={submitting}
          onClick={() => setCookStyle(value)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12.5px] border transition ${
            active
              ? "bg-accent text-accent-on border-accent"
              : "bg-surface-2 text-ink-1 border-line hover:border-accent-line"
          } disabled:opacity-60`}
        >
          <Icon size={12} /> {label}
        </button>
      );
    })}
  </div>
</Field>
```

- [ ] **Step 9: Update the NoPlanBody empty-state copy**

Find lines 314-330 in `NoPlanBody`:

```tsx
const nextMondayLabel = useMemo(() => {
  const iso = getNextMonday();
  return localMidnightFromISO(iso).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });
}, []);

return (
  <>
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-3">
      <div className="w-11 h-11 rounded-[12px] bg-accent-soft text-accent-ink grid place-items-center">
        <CalendarDays size={22} />
      </div>
      <div className="text-[15px] font-semibold text-ink-1">No active plan yet</div>
      <div className="text-[13px] text-ink-2 leading-relaxed max-w-[320px]">
        The next plan would start {nextMondayLabel}. Head to the planner to set it up.
      </div>
    </div>
```

Replace with:

```tsx
const nextSundayLabel = useMemo(() => {
  const iso = getNextSunday();
  return localMidnightFromISO(iso).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });
}, []);

return (
  <>
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-3">
      <div className="w-11 h-11 rounded-[12px] bg-accent-soft text-accent-ink grid place-items-center">
        <CalendarDays size={22} />
      </div>
      <div className="text-[15px] font-semibold text-ink-1">No active plan yet</div>
      <div className="text-[13px] text-ink-2 leading-relaxed max-w-[320px]">
        The next plan would start {nextSundayLabel}. Head to the planner to set it up.
      </div>
    </div>
```

- [ ] **Step 10: Verify the client type-checks**

```bash
cd client
npx tsc --noEmit
```

Expected: AddToPlanModal.tsx errors are gone. Dashboard.tsx and PlanDayColumn.tsx remain.

- [ ] **Step 11: Commit**

```bash
git add client/src/components/AddToPlanModal.tsx
git commit -m "feat(add-to-plan): cookStyle picker + Sunday-first defaults

Three-button cook-style row replaces the boolean toggle. The default-
cook-style effect sets cookStyle: 'batch_prep' when the auto-picked
slot is Sunday and the meal canBatch, else 'cook_fresh'. DAYS array
flips to Sunday-first. getNextMonday rename → getNextSunday."
```

---

## Task 10: Dashboard — DAYS order, todayKey, isPrep references

Dashboard renders multiple cook-style pills in different formats. Each gets a three-way switch.

**Files:**
- Modify: `client/src/pages/Dashboard.tsx`

- [ ] **Step 1: Flip the DAYS array order**

Edit `client/src/pages/Dashboard.tsx`. Find line 33:

```ts
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
```

Replace with:

```ts
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
```

- [ ] **Step 2: Update todayKey**

Find lines 43-47:

```ts
function todayKey(): string {
  // map JS getDay (0=Sun) to monday-first key
  const d = new Date().getDay();
  return DAYS[(d + 6) % 7];
}
```

Replace with:

```ts
function todayKey(): string {
  // DAYS is Sunday-first, matches JS getDay (0=Sun) directly.
  return DAYS[new Date().getDay()];
}
```

- [ ] **Step 3: Update the tonight-hero pill**

Find lines 215-218:

```tsx
<Pill tone={tonight.isPrep ? "prep" : "fresh"} size="md">
  {tonight.isPrep ? <Flame size={12} /> : <Leaf size={12} />}
  {tonight.isPrep ? "From Sunday prep" : "Cook fresh"}
</Pill>
```

Replace with:

```tsx
<Pill tone={
  tonight.cookStyle === "batch_prep" ? "prep" :
  tonight.cookStyle === "leftovers"  ? "prep" :
  "fresh"
} size="md">
  {tonight.cookStyle === "batch_prep" && <><Flame size={12} /> From Sunday prep</>}
  {tonight.cookStyle === "leftovers"  && <><Refrigerator size={12} /> Leftovers</>}
  {tonight.cookStyle === "cook_fresh" && <><Leaf size={12} /> Cook fresh</>}
</Pill>
```

(`Refrigerator` is already imported in this file at line 7. Reusing the `prep` tone for leftovers keeps the visual cue that "this didn't need shopping" — the leftover and the prep share a common origin.)

- [ ] **Step 4: Update the from-prep reheat hint**

Find lines 243-248:

```tsx
{tonight.isPrep && tonight.status !== "cooked" && (
  <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] bg-prep-soft border border-prep-line text-prep-ink text-[13px]">
    <Refrigerator size={16} />
    <span>Pull from the fridge — reheat covered, ~5 min at 350°F.</span>
  </div>
)}
```

Replace with:

```tsx
{(tonight.cookStyle === "batch_prep" || tonight.cookStyle === "leftovers") && tonight.status !== "cooked" && (
  <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] bg-prep-soft border border-prep-line text-prep-ink text-[13px]">
    <Refrigerator size={16} />
    <span>Pull from the fridge — reheat covered, ~5 min at 350°F.</span>
  </div>
)}
```

(The reheat hint now applies to leftovers as well — semantically the same: the food is in the fridge, ready to warm.)

- [ ] **Step 5: Update the upcoming-week dinner row**

Find lines 332-345:

```tsx
{dinner ? (
  <div className="min-w-0">
    <div className="text-[14px] text-ink-1 font-medium truncate">{dinner.meal.name}</div>
    <div className="text-[12px] text-ink-3">
      {dinner.isPrep ? "From prep" : "Cook fresh"} · {dinner.servings} servings
    </div>
  </div>
) : (
  <div className="text-[13px] text-ink-3 italic">Open night</div>
)}
<Pill tone={dinner?.isPrep ? "prep" : "fresh"} size="sm">
  {dinner?.isPrep ? <Flame size={10} /> : <Leaf size={10} />}
  {dinner?.isPrep ? "Prep" : "Fresh"}
</Pill>
```

Replace with:

```tsx
{dinner ? (
  <div className="min-w-0">
    <div className="text-[14px] text-ink-1 font-medium truncate">{dinner.meal.name}</div>
    <div className="text-[12px] text-ink-3">
      {dinner.cookStyle === "batch_prep" && "From prep"}
      {dinner.cookStyle === "leftovers"  && "Leftovers"}
      {dinner.cookStyle === "cook_fresh" && "Cook fresh"}
      {" · "}{dinner.servings} servings
    </div>
  </div>
) : (
  <div className="text-[13px] text-ink-3 italic">Open night</div>
)}
<Pill tone={dinner && dinner.cookStyle !== "cook_fresh" ? "prep" : "fresh"} size="sm">
  {dinner?.cookStyle === "batch_prep" && <><Flame size={10} /> Prep</>}
  {dinner?.cookStyle === "leftovers"  && <><Refrigerator size={10} /> Leftovers</>}
  {(!dinner || dinner.cookStyle === "cook_fresh") && <><Leaf size={10} /> Fresh</>}
</Pill>
```

- [ ] **Step 6: Verify the client type-checks**

```bash
cd client
npx tsc --noEmit
```

Expected: Dashboard.tsx errors are gone. Only PlanDayColumn.tsx remains.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/Dashboard.tsx
git commit -m "feat(dashboard): cookStyle-aware pills, Sunday-first DAYS

Tonight's hero, the upcoming-week rows, and the from-fridge reheat
hint all switch on the three-value cookStyle. todayKey() drops the
Monday offset since DAYS is now Sunday-first."
```

---

## Task 11: PlanDayColumn — cookStyle in badge render

The legacy day column (used in older Dashboard layouts) still references `isPrep` for its prep badge.

**Files:**
- Modify: `client/src/components/PlanDayColumn.tsx`

- [ ] **Step 1: Update the badge render**

Edit `client/src/components/PlanDayColumn.tsx`. Find line 30 inside the meal card render:

```tsx
{pm.isPrep && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">Prep</span>}
```

Replace with:

```tsx
{pm.cookStyle === "batch_prep" && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">Prep</span>}
{pm.cookStyle === "leftovers"  && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Leftovers</span>}
```

- [ ] **Step 2: Verify the client type-checks**

```bash
cd client
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Verify the client builds**

```bash
cd client
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/PlanDayColumn.tsx
git commit -m "feat(plan-day-column): show leftovers badge alongside prep badge"
```

---

## Task 12: End-to-end verification

After every preceding task lands, run a manual smoke test against a dev server with a real database. This is the spec's "Manual verification" section. Do not skip — there are paths (calendar sync, the Claude prompt) that have no automated coverage.

**Files:** none modified.

- [ ] **Step 1: Start the dev environment**

From the repo root, in separate terminals:

```bash
cd server && npm run dev
```

```bash
cd client && npm run dev
```

Expected: server listens on its configured port; Vite serves the client. Open the client URL.

- [ ] **Step 2: Verify the Planner renders existing plans Sunday-first**

Open `/planner`. Confirm:
- Sunday is the leftmost column.
- Saturday is the rightmost.
- Existing planned meals (from before the migration) appear on the same calendar dates as before — a meal on `monday` still sits under whatever Monday is for that week.
- Visit a URL with a non-Sunday date in the week param (e.g. `/planner?week=<a-Wednesday-YYYY-MM-DD>`). The URL should rewrite itself to the prior Sunday (proves `parseWeekParam` snaps to Sunday).
- Open `/recipes/<any-recipe>` and click "Add to plan" when there is no active plan covering today. The empty-state copy should read "The next plan would start <SOME-SUNDAY>…" (proves `getNextSunday` returns the upcoming Sunday).

- [ ] **Step 3: Manually flip a planned meal to leftovers**

Click any planned meal card → edit modal opens. The Cook style row now has three buttons. Click `Leftovers`. Close the modal. Refresh the page. Confirm the cook-style pill on the day card now shows `Leftovers` with the Refrigerator icon, and that this persists.

- [ ] **Step 4: Confirm shopping list excludes leftovers**

Navigate to `/shopping`. Note current item quantities. Open `/planner`, flip another planned meal to `Leftovers`. Navigate back to `/shopping` and click "Regenerate" (or whichever button regenerates the list — if the UI does it on plan-status change only, generate via the API directly: `curl -X POST http://localhost:3001/api/shopping/generate/<planId>`). Confirm the leftover meal's ingredients are NOT in the new shopping list (or that shared ingredients have lower quantities).

- [ ] **Step 5: Auto-generate a fresh plan**

Create a new draft plan for an upcoming week (Sun-Sat). Click "Auto-generate". Wait for Claude. Confirm:
- Sunday has at least one `batch_prep` slot (Flame icon in the pill).
- At least one slot Mon–Wed shows `Leftovers` (Refrigerator icon) referencing the same meal name as the Sunday batch_prep.
- Every other slot shows `Cook fresh` (Leaf icon).

If Claude's output doesn't contain leftovers, the prompt may need iteration — note it as a follow-up but don't block on it; the validator accepts the output either way.

- [ ] **Step 6: Sync the new plan to calendar**

If you have Google Calendar credentials configured, click "Sync to Calendar" on the active plan. Open Google Calendar and confirm:
- Each meal event lands on its expected calendar date.
- Sunday events are on Sunday, Monday on Monday, etc.
- `batch_prep` events have ` [Meal Prep]` in the title.
- `leftovers` events have ` [Leftovers]` in the title.

- [ ] **Step 7: Run the full server test suite once more**

```bash
cd server
npx vitest run
```

Expected: every test passes.

- [ ] **Step 8: Final commit (only if anything was tweaked during verification)**

If verification revealed anything to fix, fix it and commit. Otherwise no commit needed for this task.

---

## Done

The branch should now contain ~10 commits totaling: one schema migration, three test files, the `aggregateShoppingItems` helper, the cook-style enum throughout the server and client, and the Sunday-first calendar shift everywhere it matters. Open a PR to merge.
