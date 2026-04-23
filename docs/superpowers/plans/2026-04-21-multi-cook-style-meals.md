# Multi-Cook-Style Meals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `Meal.mealType` (single enum) with two independent booleans (`canBatch`, `canFresh`) so a recipe can be tagged as batch-capable, fresh-capable, or both; update the auto-generator so Sunday is the only day that produces batch-prep planned meals.

**Architecture:** Staged DB migration — stage 1 adds two columns, backfills from the existing `meal_type` enum, and switches all consumers to read/write the new columns while keeping `meal_type` in sync for rollback safety; stage 2 (separate follow-up migration) drops `meal_type` and the enum. Auto-generator gains a hard post-processing rule that strips any `isPrep=true` planned meal whose day is not Sunday.

**Tech Stack:** Prisma 6 / PostgreSQL, Node 20 + Express, React 18 + Tailwind v4, Vitest, `lucide-react`, the repo's `callClaude` wrapper.

---

## Decisions locked in (from design discussion 2026-04-21)

- New manual recipes default to `canFresh=true`, `canBatch=false`.
- PDF parser does **not** infer `canBatch`; imported recipes get `canFresh=true`, `canBatch=false` and the user toggles after.
- Auto-generator: on Sunday, planned meals may have `isPrep=true` (and require `canBatch=true`); on every other day, `isPrep` must be `false` and the meal must have `canFresh=true`.
- UI shows two pills side-by-side when both capabilities are true; single pill when only one is true.
- Migration is staged — ship stage 1 (add + backfill + dual-write), verify in a running environment, then ship stage 2 (drop enum).

---

## File Structure

### Create

- `server/prisma/migrations/003_multi_cook_style/migration.sql` — add columns + backfill (stage 1).
- `server/prisma/migrations/004_drop_meal_type/migration.sql` — drop `meal_type` column + enum (stage 2, held until stage 1 verified).
- `server/src/claude/mealPlannerRules.ts` — pure Sunday-only batch validator used by the planner route.
- `server/src/__tests__/mealPlannerRules.test.ts` — unit tests for the validator.
- `server/src/__tests__/mealService.test.ts` — unit tests for the boolean defaults / write-through behavior (uses Prisma in a transaction, see setup).

### Modify

- `server/prisma/schema.prisma` — add `canBatch`, `canFresh` (stage 1); drop `mealType` + `MealType` enum (stage 2).
- `server/src/services/mealService.ts` — accept `canBatch` / `canFresh`; derive `mealType` from them while the column still exists.
- `server/src/services/chatService.ts` — select `canBatch`, `canFresh` on meals; stop selecting `mealType`.
- `server/src/claude/chatAgent.ts` — update context type; pass capability tags to Claude.
- `server/src/claude/mealPlanner.ts` — send capability flags; update prompt; use the validator on the returned plan.
- `server/src/claude/recipeParser.ts` — drop `mealType` from prompt & parsed type; parser returns `canBatch=false`, `canFresh=true` implicitly (fields set by the caller).
- `server/src/scripts/bulk-import.ts` — set `canBatch=false`, `canFresh=true` on creation; stop passing `mealType`.
- `server/src/routes/plans.ts` — change the meal select to include `canBatch`, `canFresh`; drop `mealType`.
- `client/src/api/meals.ts` — add `canBatch`, `canFresh` to `Meal`; drop `mealType` (stage 2).
- `client/src/components/MealCard.tsx` — render capability pills.
- `client/src/components/MealForm.tsx` — replace the "Meal Type" select with two checkboxes.
- `client/src/pages/RecipeDetail.tsx` — render capability pills.
- `client/src/pages/Recipes.tsx` — filter chips read from capability booleans.
- `client/src/pages/Planner.tsx` — picker modal renders capability pills; `isPrep` default when adding to a slot is derived from the day (Sunday → true if meal `canBatch`, else false).
- `client/src/theme/photoTone.ts` — remove the unused `mealType` field from the `toneForMeal` input type.

---

## Task 1: Stage 1 migration — add `can_batch` + `can_fresh`, backfill

**Files:**
- Create: `server/prisma/migrations/003_multi_cook_style/migration.sql`
- Modify: `server/prisma/schema.prisma`

- [ ] **Step 1: Edit `server/prisma/schema.prisma`**

Find the `Meal` model. Add two fields just below `mealType`:

```prisma
model Meal {
  id          Int       @id @default(autoincrement())
  name        String
  description String?
  source      MealSource @default(manual)
  sourceUrl   String?    @map("source_url")
  mealType    MealType   @map("meal_type")
  canBatch    Boolean    @default(false) @map("can_batch")
  canFresh    Boolean    @default(true)  @map("can_fresh")
  servings    Int        @default(2)
  // ... (rest unchanged)
}
```

Do **not** remove `mealType` or the `MealType` enum in this stage. They stay until stage 2.

- [ ] **Step 2: Create the migration folder and SQL**

Create `server/prisma/migrations/003_multi_cook_style/migration.sql`:

```sql
-- Migration 003: multi cook-style capability columns (stage 1)
-- Adds can_batch + can_fresh and backfills from the existing meal_type enum.
-- meal_type column is retained for rollback safety; stage 2 drops it.

ALTER TABLE "meals"
  ADD COLUMN "can_batch" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "can_fresh" BOOLEAN NOT NULL DEFAULT true;

UPDATE "meals"
SET can_batch = (meal_type = 'batch_prep'),
    can_fresh = (meal_type = 'cook_fresh');
```

- [ ] **Step 3: Run the migration**

```bash
cd server && npx prisma migrate deploy && npx prisma generate
```

Expected: `Applying migration 003_multi_cook_style` then `All migrations have been successfully applied.`

- [ ] **Step 4: Verify in psql**

```bash
docker compose exec -T db psql -U postgres -d mealplanner -c "SELECT meal_type, can_batch, can_fresh, COUNT(*) FROM meals GROUP BY 1,2,3 ORDER BY 1;"
```

Expected: every `batch_prep` row has `can_batch=t, can_fresh=f`; every `cook_fresh` row has `can_batch=f, can_fresh=t`. No `NULL`s. (If the project uses a different DB name or local psql, substitute.)

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/003_multi_cook_style/
git commit -m "feat(db): add can_batch/can_fresh columns, backfill from meal_type"
```

---

## Task 2: Server — `mealService` accepts capability booleans, mirrors to `mealType`

**Files:**
- Modify: `server/src/services/mealService.ts`
- Create: `server/src/__tests__/mealService.test.ts`

The existing tests in `server/src/__tests__/` are all pure (no DB). Keep that property by extracting a pure helper and TDD'ing it, then wire the helper into `createMeal`/`updateMeal` without adding DB-backed tests.

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/mealService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveCapabilityWrite } from "../services/mealService.js";

describe("resolveCapabilityWrite", () => {
  it("defaults to canFresh=true, canBatch=false when neither flag is passed and no existing row", () => {
    expect(resolveCapabilityWrite({}, null)).toEqual({
      canBatch: false,
      canFresh: true,
      mealType: "cook_fresh",
    });
  });

  it("batch-only input produces mealType=batch_prep", () => {
    expect(resolveCapabilityWrite({ canBatch: true, canFresh: false }, null)).toEqual({
      canBatch: true,
      canFresh: false,
      mealType: "batch_prep",
    });
  });

  it("both-capable input produces mealType=cook_fresh (historical primary)", () => {
    expect(resolveCapabilityWrite({ canBatch: true, canFresh: true }, null)).toEqual({
      canBatch: true,
      canFresh: true,
      mealType: "cook_fresh",
    });
  });

  it("partial update (canBatch only) falls back to existing canFresh", () => {
    const existing = { canBatch: false, canFresh: true };
    expect(resolveCapabilityWrite({ canBatch: true }, existing)).toEqual({
      canBatch: true,
      canFresh: true,
      mealType: "cook_fresh",
    });
  });

  it("flipping to batch-only via update recomputes mealType", () => {
    const existing = { canBatch: false, canFresh: true };
    expect(resolveCapabilityWrite({ canBatch: true, canFresh: false }, existing)).toEqual({
      canBatch: true,
      canFresh: false,
      mealType: "batch_prep",
    });
  });

  it("returns null when the update touches neither flag and no existing row is required", () => {
    expect(resolveCapabilityWrite({}, { canBatch: true, canFresh: false })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/mealService.test.ts`
Expected: FAIL — `resolveCapabilityWrite` is not exported.

- [ ] **Step 3: Update `mealService.ts`**

Replace the `CreateMealInput` interface, add the exported helper, and rewrite `createMeal` + `updateMeal`:

```ts
interface CreateMealInput {
  name: string;
  description?: string;
  source?: "hello_fresh" | "manual";
  sourceUrl?: string;
  canBatch?: boolean;
  canFresh?: boolean;
  servings: number;
  prepTime?: number;
  cookTime?: number;
  tags?: string[];
  instructions: string[];
  imageUrl?: string;
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  fiberG?: number;
  sodiumMg?: number;
  ingredients?: IngredientInput[];
}

interface CapabilityInput { canBatch?: boolean; canFresh?: boolean }
interface ExistingCapability { canBatch: boolean; canFresh: boolean }
interface ResolvedCapability {
  canBatch: boolean;
  canFresh: boolean;
  mealType: "batch_prep" | "cook_fresh";
}

/**
 * Resolves the capability write for create/update.
 *   - For create, pass `existing = null`; missing flags default to
 *     canFresh=true, canBatch=false.
 *   - For update, pass the current row; missing flags inherit from it, and
 *     if neither flag is present in the patch the function returns null
 *     (no write needed).
 * While the meal_type column exists (stage 1), this also returns a mirrored
 * mealType derived from the final booleans — primary is cook_fresh when both
 * are true.
 */
export function resolveCapabilityWrite(
  input: CapabilityInput,
  existing: ExistingCapability | null,
): ResolvedCapability | null {
  if (existing && input.canBatch === undefined && input.canFresh === undefined) {
    return null;
  }
  const canFresh = input.canFresh ?? existing?.canFresh ?? true;
  const canBatch = input.canBatch ?? existing?.canBatch ?? false;
  const mealType: "batch_prep" | "cook_fresh" =
    canBatch && !canFresh ? "batch_prep" : "cook_fresh";
  return { canBatch, canFresh, mealType };
}

export async function createMeal(data: CreateMealInput) {
  const { ingredients, instructions, canBatch, canFresh, ...rest } = data;
  const capability = resolveCapabilityWrite({ canBatch, canFresh }, null)!;

  return prisma.meal.create({
    data: {
      ...rest,
      ...capability,
      instructions: JSON.stringify(instructions),
      ingredients: ingredients
        ? {
            create: ingredients.map((ing) => ({
              ingredientId: ing.ingredientId,
              quantity: ing.quantity,
              unit: ing.unit,
              preparation: ing.preparation,
            })),
          }
        : undefined,
    },
    include: mealWithIngredients,
  });
}

export async function updateMeal(id: number, data: Partial<CreateMealInput>) {
  const { ingredients, instructions, canBatch, canFresh, ...rest } = data;

  const updateData: any = { ...rest };
  if (instructions) {
    updateData.instructions = JSON.stringify(instructions);
  }

  if (canBatch !== undefined || canFresh !== undefined) {
    const existing = await prisma.meal.findUniqueOrThrow({
      where: { id },
      select: { canBatch: true, canFresh: true },
    });
    const capability = resolveCapabilityWrite({ canBatch, canFresh }, existing);
    if (capability) Object.assign(updateData, capability);
  }

  if (ingredients) {
    await prisma.mealIngredient.deleteMany({ where: { mealId: id } });
    await prisma.mealIngredient.createMany({
      data: ingredients.map((ing) => ({
        mealId: id,
        ingredientId: ing.ingredientId,
        quantity: ing.quantity,
        unit: ing.unit,
        preparation: ing.preparation,
      })),
    });
  }

  return prisma.meal.update({
    where: { id },
    data: updateData,
    include: mealWithIngredients,
  });
}
```

Note: the `mealType` field was removed from `CreateMealInput`. Consumers that previously passed `mealType` will break — those are the caller updates in later tasks (bulk-import, recipeParser).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/mealService.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `cd server && npx vitest run`
Expected: all tests (existing + new) green.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/mealService.ts server/src/__tests__/mealService.test.ts
git commit -m "feat(server): mealService accepts canBatch/canFresh; mirrors mealType"
```

---

## Task 3: Server — recipe parser drops `mealType`; bulk-import sets defaults

**Files:**
- Modify: `server/src/claude/recipeParser.ts`
- Modify: `server/src/scripts/bulk-import.ts`

- [ ] **Step 1: Update `ParsedRecipe` interface in `recipeParser.ts`**

Remove the `mealType` field:

```ts
interface ParsedRecipe {
  name: string;
  description: string;
  servings: number;
  prepTime: number | null;
  cookTime: number | null;
  tags: string[];
  instructions: string[];
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
  ingredients: {
    name: string;
    quantity: number;
    unit: string;
    category: string;
    preparation: string | null;
  }[];
}
```

- [ ] **Step 2: Update the Claude prompt**

In the same file, in `parseRecipeFromFile`, remove the `"mealType": "cook_fresh",` line from the schema block shown to Claude. The resulting schema sent to Claude should be:

```
{
  "name": "string",
  "description": "string (1-2 sentence summary)",
  "servings": number,
  "prepTime": number_or_null (minutes),
  ...
}
```

No other prompt changes — the batch-capability decision is deferred to the user per the design doc.

- [ ] **Step 3: Update `bulk-import.ts` create call**

In `server/src/scripts/bulk-import.ts`, in `importOne`, replace the `prisma.meal.create` call's `data.mealType` field with the two boolean defaults:

```ts
  const meal = await prisma.meal.create({
    data: {
      name: parsed.name,
      description: parsed.description,
      source: "hello_fresh",
      canBatch: false,
      canFresh: true,
      mealType: "cook_fresh", // mirrored for back-compat while the column exists
      servings: parsed.servings,
      prepTime: parsed.prepTime ?? undefined,
      cookTime: parsed.cookTime ?? undefined,
      tags: parsed.tags,
      instructions: JSON.stringify(parsed.instructions),
      calories: parsed.calories ?? undefined,
      proteinG: parsed.proteinG ?? undefined,
      carbsG: parsed.carbsG ?? undefined,
      fatG: parsed.fatG ?? undefined,
      fiberG: parsed.fiberG ?? undefined,
      sodiumMg: parsed.sodiumMg ?? undefined,
      ingredients: {
        create: parsed.ingredients.map((ing) => ({
          ingredientId: ingredientMap.get(ing.name)!,
          quantity: ing.quantity,
          unit: ing.unit,
          preparation: ing.preparation,
        })),
      },
    },
  });
```

- [ ] **Step 4: Verify the server typechecks**

Run: `cd server && npx tsc --noEmit`
Expected: no errors. (If `ParsedRecipe.mealType` references linger elsewhere, fix them before moving on — most likely only here.)

- [ ] **Step 5: Commit**

```bash
git add server/src/claude/recipeParser.ts server/src/scripts/bulk-import.ts
git commit -m "feat(server): recipeParser drops mealType; bulk-import defaults canFresh=true"
```

---

## Task 4: Server — Sunday-only batch validator (pure function + tests)

**Files:**
- Create: `server/src/claude/mealPlannerRules.ts`
- Create: `server/src/__tests__/mealPlannerRules.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/mealPlannerRules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filterValidPlannedMeals } from "../claude/mealPlannerRules.js";

type M = { id: number; canBatch: boolean; canFresh: boolean };

const meals: Record<number, M> = {
  1: { id: 1, canBatch: true,  canFresh: false }, // batch only
  2: { id: 2, canBatch: false, canFresh: true  }, // fresh only
  3: { id: 3, canBatch: true,  canFresh: true  }, // both
};

describe("filterValidPlannedMeals — Sunday-only batch rule", () => {
  it("keeps isPrep=true only when day=sunday and meal canBatch", () => {
    const input = [
      { mealId: 1, day: "sunday",   mealSlot: "dinner", servings: 2, isPrep: true },
      { mealId: 3, day: "sunday",   mealSlot: "lunch",  servings: 2, isPrep: true },
    ];
    expect(filterValidPlannedMeals(input, meals)).toEqual(input);
  });

  it("drops isPrep=true on non-Sunday days", () => {
    const input = [
      { mealId: 1, day: "monday", mealSlot: "dinner", servings: 2, isPrep: true },
      { mealId: 2, day: "monday", mealSlot: "lunch",  servings: 2, isPrep: false },
    ];
    const out = filterValidPlannedMeals(input, meals);
    expect(out).toEqual([
      { mealId: 2, day: "monday", mealSlot: "lunch", servings: 2, isPrep: false },
    ]);
  });

  it("drops Sunday isPrep=true when meal can't batch", () => {
    const input = [
      { mealId: 2, day: "sunday", mealSlot: "dinner", servings: 2, isPrep: true },
    ];
    expect(filterValidPlannedMeals(input, meals)).toEqual([]);
  });

  it("drops fresh picks whose meal can't fresh", () => {
    const input = [
      { mealId: 1, day: "monday", mealSlot: "dinner", servings: 2, isPrep: false },
    ];
    expect(filterValidPlannedMeals(input, meals)).toEqual([]);
  });

  it("drops planned meals whose mealId is unknown", () => {
    const input = [
      { mealId: 999, day: "monday", mealSlot: "dinner", servings: 2, isPrep: false },
    ];
    expect(filterValidPlannedMeals(input, meals)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/mealPlannerRules.test.ts`
Expected: FAIL — `filterValidPlannedMeals` not found.

- [ ] **Step 3: Implement the validator**

Create `server/src/claude/mealPlannerRules.ts`:

```ts
export interface PlannedMealCandidate {
  mealId: number;
  day: string;
  mealSlot: string;
  servings: number;
  isPrep: boolean;
}

export interface MealCapability {
  id: number;
  canBatch: boolean;
  canFresh: boolean;
}

// Enforces the Sunday-only batch rule after Claude returns a suggested plan:
//  - isPrep=true is permitted only when day="sunday" and the meal canBatch.
//  - isPrep=false requires the meal canFresh.
//  - Unknown mealIds are dropped.
export function filterValidPlannedMeals(
  planned: PlannedMealCandidate[],
  mealsById: Record<number, MealCapability>,
): PlannedMealCandidate[] {
  return planned.filter((pm) => {
    const meal = mealsById[pm.mealId];
    if (!meal) return false;
    if (pm.isPrep) {
      return pm.day === "sunday" && meal.canBatch;
    }
    return meal.canFresh;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/mealPlannerRules.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add server/src/claude/mealPlannerRules.ts server/src/__tests__/mealPlannerRules.test.ts
git commit -m "feat(server): Sunday-only batch validator for generated plans"
```

---

## Task 5: Server — auto-generator uses capability flags + validator

**Files:**
- Modify: `server/src/claude/mealPlanner.ts`
- Modify: `server/src/routes/plans.ts`

- [ ] **Step 1: Rewrite `mealPlanner.ts` to use capability flags**

Replace the file contents:

```ts
import { callClaude } from "./cli.js";
import { filterValidPlannedMeals, type MealCapability } from "./mealPlannerRules.js";

interface MealSummary {
  id: number;
  name: string;
  canBatch: boolean;
  canFresh: boolean;
  tags: string[];
  servings: number;
  calories: number | null;
}

interface PantryOverview {
  name: string;
  quantity: number;
  unit: string;
}

interface SuggestedPlan {
  meals: {
    mealId: number;
    day: string;
    mealSlot: string;
    servings: number;
    isPrep: boolean;
  }[];
}

export async function generateWeeklyPlan(
  meals: MealSummary[],
  pantry: PantryOverview[],
  recentMealIds: number[],
): Promise<SuggestedPlan> {
  const prompt = `You are a meal planning assistant. Generate a weekly meal plan (Monday-Sunday) for 2 people.

Rules:
- Sunday is the ONLY day that may contain batch-prep planned meals. Pick 2-3 meals with canBatch=true for Sunday (lunch and dinner slots), with isPrep=true.
- Every other day (Monday-Saturday) must have isPrep=false and the meal must have canFresh=true.
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
      "day": "monday|tuesday|wednesday|thursday|friday|saturday|sunday",
      "mealSlot": "lunch|dinner",
      "servings": number,
      "isPrep": boolean
    }
  ]
}`;

  const raw = await callClaude(prompt, { timeout: 180_000 });
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to extract JSON from Claude response");
  }

  const suggested: SuggestedPlan = JSON.parse(jsonMatch[0]);

  // Enforce the Sunday-only batch rule even if Claude slips.
  const capabilityMap: Record<number, MealCapability> = {};
  for (const m of meals) {
    capabilityMap[m.id] = { id: m.id, canBatch: m.canBatch, canFresh: m.canFresh };
  }
  return { meals: filterValidPlannedMeals(suggested.meals, capabilityMap) };
}
```

- [ ] **Step 2: Update the meal select in `plans.ts`**

In `server/src/routes/plans.ts`, find the `prisma.meal.findMany` call in the `POST /:id/generate` handler (around line 64). Change the `select`:

```ts
  const allMeals = await prisma.meal.findMany({
    select: { id: true, name: true, canBatch: true, canFresh: true, tags: true, servings: true, calories: true },
  });
```

- [ ] **Step 3: Verify server typechecks**

Run: `cd server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full server test suite**

Run: `cd server && npx vitest run`
Expected: all prior tests still pass; new tests from Task 4 pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/claude/mealPlanner.ts server/src/routes/plans.ts
git commit -m "feat(planner): auto-generator reads capability flags; Sunday-only batch rule enforced"
```

---

## Task 6: Server — chat agent/service consume capability flags

**Files:**
- Modify: `server/src/services/chatService.ts`
- Modify: `server/src/claude/chatAgent.ts`

- [ ] **Step 1: Update the select in `chatService.ts`**

In `handleChatMessage`, swap `mealType` for the capability flags:

```ts
  const meals = await prisma.meal.findMany({
    select: { id: true, name: true, tags: true, canBatch: true, canFresh: true },
  });
```

- [ ] **Step 2: Update the context type in `chatAgent.ts`**

In `ChatContext.meals`, drop `mealType`, add `canBatch` + `canFresh`:

```ts
interface ChatContext {
  meals: { id: number; name: string; tags: string[]; canBatch: boolean; canFresh: boolean }[];
  pantry: { name: string; quantity: number; unit: string }[];
  currentPlan: {
    id: number;
    meals: { id: number; mealName: string; day: string; mealSlot: string; servings: number; status: string }[];
  } | null;
}
```

No prompt rewrite is required — the prompt serializes `context.meals` as JSON, so Claude receives the new field names automatically. The existing `swap_meal`/`skip_meal` actions don't need capability awareness because the user is making the judgment call.

- [ ] **Step 3: Verify typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/chatService.ts server/src/claude/chatAgent.ts
git commit -m "feat(chat): surface canBatch/canFresh in chat context"
```

---

## Task 7: Client — `Meal` type gains capability flags

**Files:**
- Modify: `client/src/api/meals.ts`

- [ ] **Step 1: Update the `Meal` interface**

Add `canBatch` and `canFresh` after `source`:

```ts
export interface Meal {
  id: number;
  name: string;
  description: string | null;
  source: string;
  canBatch: boolean;
  canFresh: boolean;
  mealType: string; // kept for the duration of stage 1; removed in Task 14
  servings: number;
  // ... rest unchanged
}
```

- [ ] **Step 2: Verify client typechecks**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/api/meals.ts
git commit -m "feat(client): Meal gains canBatch/canFresh"
```

---

## Task 8: Client — `MealCard` renders capability pills

**Files:**
- Modify: `client/src/components/MealCard.tsx`

- [ ] **Step 1: Replace the single-pill block**

Replace the `isPrep`-derived pill section (currently lines 17 and 34–38) with a capability-driven block:

```tsx
export default function MealCard({ meal, photos = true, compact = false, to }: Props) {
  const tone = toneForMeal(meal);
  const totalTime = (meal.prepTime || 0) + (meal.cookTime || 0);

  return (
    <Link
      to={to ?? `/recipes/${meal.id}`}
      className="flex flex-col bg-surface-1 border border-line rounded-[14px] overflow-hidden text-left shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] hover:-translate-y-[2px] transition motion-reduce:transition-none"
    >
      {photos && (
        meal.imagePath ? (
          <MealCardImage mealId={meal.id} alt={meal.name} tone={tone} />
        ) : (
          <PhotoTile tone={tone} label={meal.name.toLowerCase()} aspect="16 / 10" round={0} />
        )
      )}
      <div className={`flex flex-col gap-2 ${compact ? "p-3.5" : "p-4"}`}>
        <div className="flex items-center gap-1.5 flex-wrap">
          {meal.canBatch && (
            <Pill tone="prep" size="sm">
              <Flame size={11} />
              Batch Prep
            </Pill>
          )}
          {meal.canFresh && (
            <Pill tone="fresh" size="sm">
              <Leaf size={11} />
              Cook Fresh
            </Pill>
          )}
          {!photos && meal.tags.slice(0, 1).map((t) => (
            <Pill key={t} size="sm" tone="ghost">{t}</Pill>
          ))}
        </div>
```

(The rest of the component is unchanged.)

- [ ] **Step 2: Verify client typechecks**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Smoke-test in the browser**

Run the dev servers (`cd server && npm run dev` and `cd client && npm run dev`), open the recipe library, and confirm:
- A batch-only meal shows a single "Batch Prep" pill.
- A fresh-only meal shows a single "Cook Fresh" pill.
- If you haven't got a dual-capable recipe yet, mark one via psql temporarily:
  ```bash
  docker compose exec -T db psql -U postgres -d mealplanner -c "UPDATE meals SET can_batch=true, can_fresh=true WHERE id = <your_recipe_id>;"
  ```
  then reload the page and confirm both pills appear side-by-side.
- Revert the manual update when done:
  ```bash
  docker compose exec -T db psql -U postgres -d mealplanner -c "UPDATE meals SET can_batch=false, can_fresh=true WHERE id = <your_recipe_id>;"
  ```

- [ ] **Step 4: Commit**

```bash
git add client/src/components/MealCard.tsx
git commit -m "feat(client): MealCard renders capability pills"
```

---

## Task 9: Client — `RecipeDetail` renders capability pills

**Files:**
- Modify: `client/src/pages/RecipeDetail.tsx`

- [ ] **Step 1: Replace the isPrep-derived pill**

Find lines 47 and 80–86 (the `isPrep` line and the `<Pill>` block inside the header). Replace with:

```tsx
  const tone = toneForMeal(meal);
  const instructions = parseInstructions(meal.instructions);
  const hasNutrition = meal.calories != null;
  const hasPdf = !!meal.pdfPath;
```

(i.e. remove the `isPrep` line.)

Then in the header pills section:

```tsx
          <div className="flex gap-1.5 flex-wrap">
            {meal.canBatch && (
              <Pill tone="prep" size="md">
                <Flame size={12} />
                Batch Prep
              </Pill>
            )}
            {meal.canFresh && (
              <Pill tone="fresh" size="md">
                <Leaf size={12} />
                Cook Fresh
              </Pill>
            )}
            {meal.tags.map((t) => <Pill key={t} size="md" tone="ghost">{t}</Pill>)}
          </div>
```

- [ ] **Step 2: Verify client typechecks**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Smoke-test in the browser**

Open `/recipes/<id>` for a meal; confirm both pills are rendered when both capabilities are true.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/RecipeDetail.tsx
git commit -m "feat(client): RecipeDetail renders capability pills"
```

---

## Task 10: Client — `MealForm` uses two checkboxes instead of the select

**Files:**
- Modify: `client/src/components/MealForm.tsx`

- [ ] **Step 1: Replace the Meal Type select**

In `MealForm.tsx`, update the initial form state and replace the "Meal Type" block (the `<div>` starting with `<label className={LABEL}>Meal Type</label>`):

```tsx
  const [form, setForm] = useState(
    initialData || {
      name: "", description: "", canBatch: false, canFresh: true, servings: 2,
      prepTime: null, cookTime: null, tags: [], instructions: [],
      calories: null, proteinG: null, carbsG: null, fatG: null, ingredients: [],
    },
  );
```

Replace the `grid grid-cols-2 gap-3` block that holds the select + servings with:

```tsx
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Cook Styles</label>
          <div className="flex flex-col gap-1.5 pt-1">
            <label className="inline-flex items-center gap-2 text-[13.5px] text-ink-1">
              <input
                type="checkbox"
                checked={!!form.canFresh}
                onChange={(e) => update("canFresh", e.target.checked)}
              />
              Cook Fresh
            </label>
            <label className="inline-flex items-center gap-2 text-[13.5px] text-ink-1">
              <input
                type="checkbox"
                checked={!!form.canBatch}
                onChange={(e) => update("canBatch", e.target.checked)}
              />
              Batch Prep
            </label>
          </div>
        </div>
        <div>
          <label className={LABEL}>Servings</label>
          <input type="number" value={form.servings} onChange={(e) => update("servings", Number(e.target.value))} className={`${FIELD} tabular-nums`} min={1} />
        </div>
      </div>
```

- [ ] **Step 2: Verify client typechecks**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Smoke-test in the browser**

In the import flow (which uses `MealForm` after parsing), toggle the checkboxes and submit. Verify via psql:
```bash
docker compose exec -T db psql -U postgres -d mealplanner -c "SELECT name, can_batch, can_fresh, meal_type FROM meals ORDER BY id DESC LIMIT 1;"
```
Expected: the row reflects whatever combination you selected; `meal_type` is mirrored (`batch_prep` if batch-only, else `cook_fresh`).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/MealForm.tsx
git commit -m "feat(client): MealForm uses capability checkboxes"
```

---

## Task 11: Client — `Recipes` filter chips read from capability flags

**Files:**
- Modify: `client/src/pages/Recipes.tsx`

- [ ] **Step 1: Retarget the filter**

Change the filter values and predicate. Replace the top-of-file `FILTERS` constant and the `.filter` call:

```tsx
const FILTERS = [
  { k: "all", label: "All", icon: null as null | typeof Flame },
  { k: "canBatch", label: "Batch-able", icon: Flame },
  { k: "canFresh", label: "Fresh-able", icon: Leaf },
] as const;
```

And in `filtered`:

```tsx
  const filtered = meals.filter((m) => {
    if (filter === "canBatch" && !m.canBatch) return false;
    if (filter === "canFresh" && !m.canFresh) return false;
    if (tag && !m.tags.includes(tag)) return false;
    const s = search.toLowerCase().trim();
    if (s && !m.name.toLowerCase().includes(s) && !m.tags.some((t) => t.toLowerCase().includes(s))) return false;
    return true;
  });
```

- [ ] **Step 2: Smoke-test in the browser**

At `/recipes`, click "Batch-able" — only `canBatch=true` meals remain. Click "Fresh-able" — only `canFresh=true` meals remain. Dual-capable meals appear in both.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/Recipes.tsx
git commit -m "feat(client): recipe library filter uses capability flags"
```

---

## Task 12: Client — `Planner` picker shows capability pills; Sunday defaults `isPrep`

**Files:**
- Modify: `client/src/pages/Planner.tsx`
- Modify: `client/src/theme/photoTone.ts`

- [ ] **Step 1: Fix the `isPrep` default when adding to a slot**

In `handlePick` (`Planner.tsx` around line 126), replace the `isPrep: meal?.mealType === "batch_prep"` line. The Sunday-only rule should apply to manual adds too:

```tsx
  const handlePick = async (mealId: number) => {
    if (!plan || !picker) return;
    const meal = meals.find((m) => m.id === mealId);
    if (picker.mode === "add") {
      const canBatchHere = picker.day === "sunday" && !!meal?.canBatch;
      const planned = await addPlannedMeal(plan.id, {
        mealId,
        day: picker.day,
        mealSlot: picker.slot,
        servings: meal?.servings ?? 2,
        isPrep: canBatchHere,
      });
      setPlan({ ...plan, plannedMeals: [...plan.plannedMeals, planned as PlannedMeal] });
    } else {
      // swap: keep the existing isPrep untouched
      const updated = await updatePlannedMeal(plan.id, picker.plannedId, { mealId });
      setPlan({
        ...plan,
        plannedMeals: plan.plannedMeals.map((pm) => (pm.id === updated.id ? updated : pm)),
      });
      if (editing?.id === updated.id) setEditing(updated);
    }
    setPicker(null);
  };
```

- [ ] **Step 2: Update the picker list row**

Inside `MealPickerModal` (`Planner.tsx` around line 480), replace the `isPrep` / single-pill block with capability-aware rendering:

```tsx
              {filtered.map((m) => {
                const tone = toneForMeal(m);
                const busy = busyId === m.id;
                return (
                  <li key={m.id}>
                    <button
                      disabled={busy || busyId !== null}
                      onClick={async () => {
                        setBusyId(m.id);
                        try { await onPick(m.id); } catch (e: any) { alert(e.message); }
                        finally { setBusyId(null); }
                      }}
                      className="w-full flex items-center gap-3 p-2 rounded-[10px] text-left hover:bg-surface-2 disabled:opacity-60 disabled:cursor-wait transition border border-transparent hover:border-line-soft"
                    >
                      <div className="w-12 h-12 rounded-[8px] overflow-hidden flex-shrink-0">
                        {m.imagePath ? (
                          <img
                            src={`/media/meals/${m.id}/thumb.jpg`}
                            alt={m.name}
                            className="w-full h-full object-cover"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                          />
                        ) : (
                          <PhotoTile tone={tone} aspect="1 / 1" round={8} compact />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] font-semibold text-ink-1 leading-tight truncate">{m.name}</div>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-ink-3 flex-wrap">
                          {m.canBatch && (
                            <span className="inline-flex items-center gap-1"><Flame size={10} /> Batch</span>
                          )}
                          {m.canFresh && (
                            <span className="inline-flex items-center gap-1"><Leaf size={10} /> Fresh</span>
                          )}
                          {m.calories && <><span>·</span><span>{m.calories} cal</span></>}
                        </div>
                      </div>
                      {busy && <div className="text-[11px] text-ink-3">Adding…</div>}
                    </button>
                  </li>
                );
              })}
```

- [ ] **Step 3: Drop the unused `mealType` from `toneForMeal` input**

In `client/src/theme/photoTone.ts`, change the parameter type:

```ts
export function toneForMeal(input: { id?: number; name?: string }): PhotoToneName {
```

(The function body already doesn't reference `mealType`.)

- [ ] **Step 4: Verify client typechecks**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Smoke-test in the browser**

- Open an empty Sunday slot → Add → pick a meal with `canBatch=true`. The planned meal should come back with `isPrep=true` (Prep pill on the card).
- Open an empty Tuesday slot → Add → pick the same meal. `isPrep=false` (Fresh pill).
- Picker shows both capability tags when both are true.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/Planner.tsx client/src/theme/photoTone.ts
git commit -m "feat(client): planner picker uses capabilities; Sunday-only isPrep default"
```

---

## Task 13: Regression pass — auto-generate end-to-end

**Files:** none modified; behavioral smoke test only.

- [ ] **Step 1: Seed a mixed capability set**

From psql, confirm the library has at least one meal of each capability combo:

```bash
docker compose exec -T db psql -U postgres -d mealplanner -c "SELECT can_batch, can_fresh, COUNT(*) FROM meals GROUP BY 1,2;"
```

If you don't have any dual-capable meals (`can_batch=true AND can_fresh=true`), mark one temporarily for the test:

```bash
docker compose exec -T db psql -U postgres -d mealplanner -c "UPDATE meals SET can_batch=true WHERE can_fresh=true LIMIT 1;"
```

- [ ] **Step 2: Run auto-generate and verify the Sunday rule**

In the Planner UI, create a new plan for next Monday and click "Auto-generate". Wait for it to complete. Then:

```bash
docker compose exec -T db psql -U postgres -d mealplanner -c "SELECT day, meal_slot, is_prep, m.name, m.can_batch, m.can_fresh FROM planned_meals pm JOIN meals m ON m.id = pm.meal_id WHERE plan_id = (SELECT id FROM weekly_plans ORDER BY id DESC LIMIT 1) ORDER BY day, meal_slot;"
```

Expected:
- Every row with `is_prep=true` has `day='sunday'` AND `can_batch=true`.
- Every row with `is_prep=false` has `can_fresh=true`.
- No row violates either invariant (the validator guarantees this).

- [ ] **Step 3: If any violation is observed, open an issue**

(The validator should make this impossible. If it fails, the fix is in `server/src/claude/mealPlannerRules.ts`, not the prompt.)

- [ ] **Step 4: Commit (no-op; or stash notes)**

If this task introduced no code changes, skip the commit.

---

## Task 14: Stage 2 migration — drop `meal_type` and the enum

> **Hold this task until Task 1–13 have been running cleanly against real data for at least one auto-generate cycle.** This is the destructive half of the staged rollout; there is no back-migration once the enum is gone.

**Files:**
- Create: `server/prisma/migrations/004_drop_meal_type/migration.sql`
- Modify: `server/prisma/schema.prisma`
- Modify: `server/src/services/mealService.ts` — remove the `deriveMealType` call and the `mealType` field from the create/update payloads.
- Modify: `server/src/scripts/bulk-import.ts` — remove the `mealType` field from the `data:` block.
- Modify: `client/src/api/meals.ts` — remove `mealType` from `Meal`.

- [ ] **Step 1: Remove `mealType` from `schema.prisma`**

In the `Meal` model, delete the `mealType` line. At the top of the file, delete the `enum MealType { ... }` block.

- [ ] **Step 2: Create the migration**

Create `server/prisma/migrations/004_drop_meal_type/migration.sql`:

```sql
-- Migration 004: drop meal_type column and enum (stage 2 of multi cook-style rollout).
-- Prerequisite: migration 003 has been applied and all consumers read/write
-- can_batch + can_fresh exclusively.

ALTER TABLE "meals" DROP COLUMN "meal_type";
DROP TYPE "MealType";
```

- [ ] **Step 3: Remove `mealType` mirroring from `mealService.ts`**

In `resolveCapabilityWrite`, remove the `mealType` computation and the field from the return type:

```ts
interface ResolvedCapability {
  canBatch: boolean;
  canFresh: boolean;
}

export function resolveCapabilityWrite(
  input: CapabilityInput,
  existing: ExistingCapability | null,
): ResolvedCapability | null {
  if (existing && input.canBatch === undefined && input.canFresh === undefined) {
    return null;
  }
  const canFresh = input.canFresh ?? existing?.canFresh ?? true;
  const canBatch = input.canBatch ?? existing?.canBatch ?? false;
  return { canBatch, canFresh };
}
```

`createMeal` and `updateMeal` don't need further changes — they spread `...capability`, which now no longer includes `mealType`.

- [ ] **Step 4: Drop `mealType` from `bulk-import.ts`**

In the `data:` block of `prisma.meal.create`, remove the `mealType: "cook_fresh",` line.

- [ ] **Step 5: Drop `mealType` from `client/src/api/meals.ts`**

Remove the `mealType: string;` line from the `Meal` interface.

- [ ] **Step 6: Update the `resolveCapabilityWrite` tests**

In `server/src/__tests__/mealService.test.ts`, remove the `mealType:` property from every expected object literal. The test cases stay the same otherwise — they now assert only `{ canBatch, canFresh }`.

- [ ] **Step 7: Run the migration**

```bash
cd server && npx prisma migrate deploy && npx prisma generate
```

Expected: `Applying migration 004_drop_meal_type`.

- [ ] **Step 8: Verify everything typechecks and tests pass**

```bash
cd server && npx tsc --noEmit && npx vitest run
cd ../client && npx tsc --noEmit
```
Expected: all green.

- [ ] **Step 9: Grep for any remaining `mealType` references**

Run from repo root: look for `mealType`, `meal_type`, and `MealType` in source files. All matches should be inside the design doc / this plan / migration SQL. Zero references in `server/src` or `client/src`.

- [ ] **Step 10: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/004_drop_meal_type/ server/src/services/mealService.ts server/src/__tests__/mealService.test.ts server/src/scripts/bulk-import.ts client/src/api/meals.ts
git commit -m "feat(db): drop meal_type column and enum; consumers on canBatch/canFresh only"
```

---

## Validation checklist (run after Task 13, before Task 14)

- [ ] `cd server && npx tsc --noEmit` — clean.
- [ ] `cd server && npx vitest run` — all green, including the two new test files.
- [ ] `cd client && npx tsc --noEmit` — clean.
- [ ] In the UI: library filter, recipe detail, meal card, meal form, planner picker, auto-generate — all render and function. Dual-capable meals show two pills.
- [ ] psql check: no planned meals with `is_prep=true AND day <> 'sunday'`; no planned meals whose meal lacks the required capability.
- [ ] Recipe import flow (PDF → parse → form → save) creates a meal with `can_fresh=true, can_batch=false` by default.
