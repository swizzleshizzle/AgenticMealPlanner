# Cooked-Meal Validation Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a validation modal that opens on every transition of a `PlannedMeal` to `cooked`, lets the user confirm or edit what was actually used, and replaces today's silent recipe-derived pantry deduction with an explicit override-driven deduction.

**Architecture:** Server extends `deductIngredientsForMeal` with an `overrides` parameter and a richer shortfall response shape. The `PUT /api/plans/:planId/meals/:mealId` route validates overrides, wraps status update + deduction in one transaction, and returns shortfalls inline. Client adds a `<CookConfirmModal>` mounted via a `<CookConfirmProvider>` context, with a `useCookConfirm` hook that the four "mark cooked" entry points use. Failed deductions surface a dismissable `<ShortfallBanner>`.

**Tech Stack:** TypeScript, Express, Prisma, Vitest (server tests), React 18, Vite, Tailwind v4, lucide-react.

**Spec:** `docs/superpowers/specs/2026-05-08-cooked-meal-modal-design.md`

**Prerequisites:**

- The pantry-overhaul branch (`feature/pantry-overhaul`) MUST be merged to master before starting Task 1. It introduces:
  - The per-batch `PantryBatch` model and migration
  - `selectBatchesToDrain()` helper (already exported from `pantryService.ts`)
  - The conversion engine in `server/src/lib/units.ts` and the `UnitConversionError` class
  - `getPantryCards()` in `pantryService.ts` (used for inline pantry hints)
  - `getIngredients()` via `client/src/api/ingredients`
- After pulling master, run `cd server && pnpm install && pnpm prisma migrate deploy` so the schema matches the code.
- This plan does NOT ship the "Add shortfalls to shopping list" button. The post-merge code in `client/src/pages/ShoppingList.tsx` still has a `// TODO Task 27: wire add when shopping API supports adding a single item by ingredientId` marker, meaning no single-item add endpoint exists. The shortfall banner is informational only in this PR. When that endpoint lands, a tiny follow-up adds the button.

---

## File Structure

**Create:**

- `client/src/components/cookConfirm/CookConfirmModal.tsx` — modal shell (header, list, footer)
- `client/src/components/cookConfirm/CookConfirmRow.tsx` — single ingredient row (checkbox, qty, unit, hint, optional X)
- `client/src/components/cookConfirm/AddIngredientRow.tsx` — typeahead row for ad-hoc adds
- `client/src/components/cookConfirm/ShortfallBanner.tsx` — post-save dismissable banner
- `client/src/components/cookConfirm/CookConfirmProvider.tsx` — context provider + `useCookConfirm` hook (mounts modal + banner)
- `server/src/__tests__/cookConfirmDeduct.test.ts` — server-side unit tests for the new `deductIngredientsForMeal` branches
- `server/src/__tests__/cookConfirmRoute.test.ts` — server-side tests for the route's validation + transaction behavior

**Modify:**

- `server/src/services/pantryService.ts` — extend `deductIngredientsForMeal` with `overrides` and `tx` parameters; new shortfall shape
- `server/src/routes/plans.ts` — add overrides validation, `isCookTransition` guard, transaction wrap, return shortfalls
- `client/src/api/plans.ts` — extend `updatePlannedMeal` (or add `markCookedWithOverrides`) with overrides parameter and shortfall return type
- `client/src/pages/Dashboard.tsx` — replace direct status update with `useCookConfirm` for hero button and "today's other meals" cells
- `client/src/components/PlanDayColumn.tsx` — `onMarkCooked` opens the modal via the hook
- `client/src/pages/Planner.tsx` — `PlannedMealEditModal` status pick to "cooked" closes the parent modal and opens cook-confirm
- `client/src/main.tsx` (or root layout) — wrap app in `<CookConfirmProvider>`
- `docs/superpowers/plans/2026-05-05-recipe-versioning.md` — append "Implementation hooks" section

---

### Task 1: Server — extend `deductIngredientsForMeal` with `overrides` parameter, optional `tx`, and richer shortfall shape

**Files:**
- Modify: `server/src/services/pantryService.ts` (function around line 127)
- Test: `server/src/__tests__/cookConfirmDeduct.test.ts` (create)

The existing function returns `{ shortfalls: [{ ingredientId, ingredientName, missingQty, unit, missingField? }] }`. The route is the only caller and it currently discards the return. We replace the shortfall shape with the spec's richer shape (`requestedQuantity`, `requestedUnit`, `availableQuantity`, `reason`) and add an optional `overrides` parameter that, when present, drives deduction off explicit lines instead of recipe ingredients. We also accept an optional `Prisma.TransactionClient` so the route can wrap status update + deduction atomically.

- [ ] **Step 1: Write the failing test file**

Create `server/src/__tests__/cookConfirmDeduct.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { deductIngredientsForMeal } from "../services/pantryService.js";

const prisma = new PrismaClient();

async function reset() {
  // Order matters due to FKs.
  await prisma.shoppingItem.deleteMany();
  await prisma.plannedMeal.deleteMany();
  await prisma.weeklyPlan.deleteMany();
  await prisma.pantryBatch.deleteMany();
  await prisma.mealIngredient.deleteMany();
  await prisma.meal.deleteMany();
  await prisma.ingredient.deleteMany();
}

async function makeIngredient(name: string, opts: { densityGPerMl?: number; gramsPerCount?: number } = {}) {
  return prisma.ingredient.create({
    data: {
      name,
      defaultUnit: "g",
      densityGPerMl: opts.densityGPerMl ?? null,
      gramsPerCount: opts.gramsPerCount ?? null,
    },
  });
}

async function makeBatch(ingredientId: number, quantity: number, unit: string) {
  return prisma.pantryBatch.create({
    data: {
      ingredientId,
      quantity,
      unit,
      location: "pantry",
    },
  });
}

describe("deductIngredientsForMeal — overrides path", () => {
  beforeEach(reset);

  it("happy path: deducts each override row from pantry, no shortfalls", async () => {
    const chicken = await makeIngredient("chicken thighs");
    const soy = await makeIngredient("soy sauce", { densityGPerMl: 1.2 });
    await makeBatch(chicken.id, 500, "g");
    await makeBatch(soy.id, 240, "ml");

    const result = await deductIngredientsForMeal(0, 0, [
      { ingredientId: chicken.id, quantity: 200, unit: "g" },
      { ingredientId: soy.id, quantity: 30, unit: "ml" },
    ]);

    expect(result.shortfalls).toEqual([]);
    const remaining = await prisma.pantryBatch.findMany({
      where: { consumedAt: null },
      orderBy: { id: "asc" },
    });
    expect(remaining.find((b) => b.ingredientId === chicken.id)?.quantity).toBeCloseTo(300, 5);
    expect(remaining.find((b) => b.ingredientId === soy.id)?.quantity).toBeCloseTo(210, 5);
  });

  it("insufficient: deducts what exists, returns reason=insufficient with availableQuantity", async () => {
    const onion = await makeIngredient("onion");
    await makeBatch(onion.id, 100, "g");

    const result = await deductIngredientsForMeal(0, 0, [
      { ingredientId: onion.id, quantity: 250, unit: "g" },
    ]);

    expect(result.shortfalls).toEqual([
      {
        ingredientId: onion.id,
        ingredientName: "onion",
        requestedQuantity: 250,
        requestedUnit: "g",
        availableQuantity: 100,
        reason: "insufficient",
      },
    ]);
    const remaining = await prisma.pantryBatch.findMany({ where: { consumedAt: null } });
    expect(remaining).toHaveLength(0);
  });

  it("no_pantry: ingredient has no active batches", async () => {
    const ginger = await makeIngredient("ginger");

    const result = await deductIngredientsForMeal(0, 0, [
      { ingredientId: ginger.id, quantity: 5, unit: "g" },
    ]);

    expect(result.shortfalls).toEqual([
      {
        ingredientId: ginger.id,
        ingredientName: "ginger",
        requestedQuantity: 5,
        requestedUnit: "g",
        availableQuantity: 0,
        reason: "no_pantry",
      },
    ]);
  });

  it("no_density: cross-family unit with no ingredient density", async () => {
    const honey = await makeIngredient("honey"); // no density set
    await makeBatch(honey.id, 240, "ml");

    const result = await deductIngredientsForMeal(0, 0, [
      { ingredientId: honey.id, quantity: 10, unit: "g" }, // ml -> g needs density
    ]);

    expect(result.shortfalls).toEqual([
      {
        ingredientId: honey.id,
        ingredientName: "honey",
        requestedQuantity: 10,
        requestedUnit: "g",
        availableQuantity: 0,
        reason: "no_density",
      },
    ]);
    const remaining = await prisma.pantryBatch.findMany({ where: { consumedAt: null } });
    expect(remaining[0].quantity).toBe(240); // untouched
  });

  it("mixed: returns one shortfall per failing row, deducts the successful one", async () => {
    const chicken = await makeIngredient("chicken thighs");
    const onion = await makeIngredient("onion");
    const ginger = await makeIngredient("ginger");
    const honey = await makeIngredient("honey");
    await makeBatch(chicken.id, 500, "g");
    await makeBatch(onion.id, 50, "g");
    await makeBatch(honey.id, 240, "ml");

    const result = await deductIngredientsForMeal(0, 0, [
      { ingredientId: chicken.id, quantity: 200, unit: "g" },
      { ingredientId: onion.id, quantity: 100, unit: "g" },
      { ingredientId: ginger.id, quantity: 5, unit: "g" },
      { ingredientId: honey.id, quantity: 10, unit: "g" },
    ]);

    expect(result.shortfalls.map((s) => s.reason).sort()).toEqual(["insufficient", "no_density", "no_pantry"]);
    const chickenBatch = await prisma.pantryBatch.findFirst({ where: { ingredientId: chicken.id, consumedAt: null } });
    expect(chickenBatch?.quantity).toBeCloseTo(300, 5);
  });

  it("ignores mealId/servingMultiplier when overrides present", async () => {
    const onion = await makeIngredient("onion");
    await makeBatch(onion.id, 100, "g");

    const result = await deductIngredientsForMeal(99999, 99, [
      { ingredientId: onion.id, quantity: 25, unit: "g" },
    ]);

    expect(result.shortfalls).toEqual([]);
    const remaining = await prisma.pantryBatch.findFirst({ where: { ingredientId: onion.id, consumedAt: null } });
    expect(remaining?.quantity).toBeCloseTo(75, 5);
  });
});

describe("deductIngredientsForMeal — recipe-derived path (overrides omitted)", () => {
  beforeEach(reset);

  it("falls back to MealIngredient rows scaled by multiplier", async () => {
    const chicken = await prisma.ingredient.create({
      data: { name: "chicken thighs", defaultUnit: "g" },
    });
    const meal = await prisma.meal.create({
      data: {
        name: "Test stir fry",
        servings: 4,
        ingredients: { create: [{ ingredientId: chicken.id, quantity: 400, unit: "g" }] },
      },
    });
    await prisma.pantryBatch.create({
      data: { ingredientId: chicken.id, quantity: 500, unit: "g", location: "pantry" },
    });

    const result = await deductIngredientsForMeal(meal.id, 0.5);

    expect(result.shortfalls).toEqual([]);
    const remaining = await prisma.pantryBatch.findFirst({
      where: { ingredientId: chicken.id, consumedAt: null },
    });
    expect(remaining?.quantity).toBeCloseTo(300, 5); // 500 - (400 * 0.5)
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server
pnpm vitest run src/__tests__/cookConfirmDeduct.test.ts
```

Expected: FAIL — current implementation returns `{ ingredientId, ingredientName, missingQty, unit, missingField? }`, not the new shape; no `overrides` parameter exists.

- [ ] **Step 3: Replace `deductIngredientsForMeal` with the extended implementation**

Open `server/src/services/pantryService.ts`. Replace the entire function (currently around line 127, ending at the closing brace of the `prisma.$transaction` callback) with this:

```ts
export interface DeductOverride {
  ingredientId: number;
  quantity: number;
  unit: string;
}

export interface DeductShortfall {
  ingredientId: number;
  ingredientName: string;
  requestedQuantity: number;
  requestedUnit: string;
  availableQuantity: number;
  reason: "insufficient" | "no_density" | "no_pantry";
}

export interface DeductResult {
  shortfalls: DeductShortfall[];
}

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export async function deductIngredientsForMeal(
  mealId: number,
  servingMultiplier: number,
  overrides?: DeductOverride[],
  tx?: Tx,
): Promise<DeductResult> {
  if (tx) {
    return runDeduction(tx, mealId, servingMultiplier, overrides);
  }
  return prisma.$transaction((innerTx) =>
    runDeduction(innerTx, mealId, servingMultiplier, overrides),
  );
}

async function runDeduction(
  tx: Tx,
  mealId: number,
  servingMultiplier: number,
  overrides: DeductOverride[] | undefined,
): Promise<DeductResult> {
  // Build the deduction list. Either: explicit overrides (modal) OR recipe-derived (legacy).
  let lines: Array<{ ingredientId: number; quantity: number; unit: string }>;
  if (overrides !== undefined) {
    lines = overrides.map((o) => ({
      ingredientId: o.ingredientId,
      quantity: o.quantity,
      unit: o.unit,
    }));
  } else {
    const mealIngredients = await (tx as any).mealIngredient.findMany({
      where: { mealId },
    });
    lines = mealIngredients.map((mi: any) => ({
      ingredientId: mi.ingredientId,
      quantity: mi.quantity * servingMultiplier,
      unit: mi.unit,
    }));
  }

  const shortfalls: DeductShortfall[] = [];

  for (const line of lines) {
    const ingredient = await (tx as any).ingredient.findUnique({
      where: { id: line.ingredientId },
    });
    if (!ingredient) {
      // Defensive: skip rows whose ingredient was deleted between modal open and save.
      continue;
    }

    const batchRows = await (tx as any).pantryBatch.findMany({
      where: { ingredientId: line.ingredientId, consumedAt: null },
    });

    if (batchRows.length === 0) {
      shortfalls.push({
        ingredientId: line.ingredientId,
        ingredientName: ingredient.name,
        requestedQuantity: line.quantity,
        requestedUnit: line.unit,
        availableQuantity: 0,
        reason: "no_pantry",
      });
      continue;
    }

    let plan;
    try {
      plan = selectBatchesToDrain({
        needed: line.quantity,
        neededUnit: line.unit,
        ingredient,
        batches: batchRows.map((b: any) => ({
          id: b.id,
          quantity: b.quantity,
          unit: b.unit,
          expirationDate: b.expirationDate,
          tags: b.tags,
        })),
      });
    } catch (e) {
      if (e instanceof UnitConversionError) {
        shortfalls.push({
          ingredientId: line.ingredientId,
          ingredientName: ingredient.name,
          requestedQuantity: line.quantity,
          requestedUnit: line.unit,
          availableQuantity: 0,
          reason: "no_density",
        });
        continue;
      }
      throw e;
    }

    for (const c of plan.consumed) {
      if (c.partial) {
        await (tx as any).pantryBatch.update({
          where: { id: c.batchId },
          data: { quantity: c.newQuantity },
        });
      } else {
        await (tx as any).pantryBatch.update({
          where: { id: c.batchId },
          data: { quantity: 0, consumedAt: new Date() },
        });
      }
    }

    if (plan.shortfall > 0) {
      shortfalls.push({
        ingredientId: line.ingredientId,
        ingredientName: ingredient.name,
        requestedQuantity: line.quantity,
        requestedUnit: line.unit,
        availableQuantity: line.quantity - plan.shortfall,
        reason: "insufficient",
      });
    }
  }

  return { shortfalls };
}
```

Add this import to the top of the file if `UnitConversionError` and `convert` aren't already imported (they should be — keep the existing import line):

```ts
import { convert, UnitConversionError } from "../lib/units.js";
```

And add `import { PrismaClient } from "@prisma/client";` if not already present (it is).

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server
pnpm vitest run src/__tests__/cookConfirmDeduct.test.ts
```

Expected: ALL PASS (8 tests).

- [ ] **Step 5: Run the full test suite to confirm no regression**

```bash
cd server
pnpm vitest run
```

Expected: ALL existing tests still pass. The pre-existing `pantryDeduction.test.ts` only tests `selectBatchesToDrain` (not changed) and the legacy callers of `deductIngredientsForMeal` only check whether it ran — they don't assert on the shape. If any test fails because it asserted `missingQty` or `missingField` directly, update that test to use the new shape.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/pantryService.ts server/src/__tests__/cookConfirmDeduct.test.ts
git commit -m "feat(server): extend deductIngredientsForMeal with overrides + structured shortfalls"
```

---

### Task 2: Server — extend `PUT /api/plans/:planId/meals/:mealId` with overrides validation, `isCookTransition` guard, and transactional status+deduction

**Files:**
- Modify: `server/src/routes/plans.ts` (around line 39, the PUT handler)
- Test: `server/src/__tests__/cookConfirmRoute.test.ts` (create)

The route currently runs `updatePlannedMeal` and then a side-effect `deductIngredientsForMeal` whenever `req.body.status === "cooked"`. We need to:
1. Validate `req.body.overrides` when present.
2. Only deduct on a *transition* into cooked (`previous.status !== "cooked"`).
3. Wrap status update + deduction in a single transaction by passing `tx` to both calls.
4. Return the deduction shortfalls inline at `response.deduction`.

`plannerService.updatePlannedMeal` does not currently accept a `tx` parameter. We need to add one.

- [ ] **Step 1: Add optional `tx` to `plannerService.updatePlannedMeal`**

Open `server/src/services/plannerService.ts`. Find `updatePlannedMeal` and add an optional `tx` parameter. The current signature is roughly:

```ts
export async function updatePlannedMeal(id: number, data: any) {
  return prisma.plannedMeal.update({
    where: { id },
    data,
    include: { meal: { include: { ingredients: true } } },
  });
}
```

Replace with:

```ts
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export async function updatePlannedMeal(id: number, data: any, tx?: Tx) {
  const client: any = tx ?? prisma;
  return client.plannedMeal.update({
    where: { id },
    data,
    include: { meal: { include: { ingredients: true } } },
  });
}
```

If `Tx` is already declared in this file, reuse it. If `PrismaClient` is not imported, add `import { PrismaClient } from "@prisma/client";`.

- [ ] **Step 2: Write the failing test for the route**

Create `server/src/__tests__/cookConfirmRoute.test.ts`:

```ts
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import plansRouter from "../routes/plans.js";

const prisma = new PrismaClient();
const app = express();
app.use(express.json());
app.use("/api/plans", plansRouter);

async function reset() {
  await prisma.shoppingItem.deleteMany();
  await prisma.plannedMeal.deleteMany();
  await prisma.weeklyPlan.deleteMany();
  await prisma.pantryBatch.deleteMany();
  await prisma.mealIngredient.deleteMany();
  await prisma.meal.deleteMany();
  await prisma.ingredient.deleteMany();
}

async function seed() {
  const chicken = await prisma.ingredient.create({ data: { name: "chicken thighs", defaultUnit: "g" } });
  const soy = await prisma.ingredient.create({
    data: { name: "soy sauce", defaultUnit: "ml", densityGPerMl: 1.2 },
  });
  const meal = await prisma.meal.create({
    data: {
      name: "Stir fry",
      servings: 4,
      ingredients: {
        create: [
          { ingredientId: chicken.id, quantity: 400, unit: "g" },
          { ingredientId: soy.id, quantity: 30, unit: "ml" },
        ],
      },
    },
  });
  await prisma.pantryBatch.create({
    data: { ingredientId: chicken.id, quantity: 500, unit: "g", location: "pantry" },
  });
  await prisma.pantryBatch.create({
    data: { ingredientId: soy.id, quantity: 240, unit: "ml", location: "pantry" },
  });
  const plan = await prisma.weeklyPlan.create({ data: { weekStartDate: new Date("2026-05-10") } });
  const pm = await prisma.plannedMeal.create({
    data: {
      planId: plan.id,
      mealId: meal.id,
      day: "monday",
      mealSlot: "dinner",
      servings: 2,
      cookStyle: "cook_fresh",
      status: "planned",
    },
  });
  return { chicken, soy, meal, plan, pm };
}

describe("PUT /api/plans/:planId/meals/:mealId — cooked transition with overrides", () => {
  beforeEach(reset);

  it("happy path: deducts overrides, returns shortfalls=[]", async () => {
    const { chicken, soy, plan, pm } = await seed();

    const res = await request(app)
      .put(`/api/plans/${plan.id}/meals/${pm.id}`)
      .send({
        status: "cooked",
        overrides: [
          { ingredientId: chicken.id, quantity: 200, unit: "g" },
          { ingredientId: soy.id, quantity: 15, unit: "ml" },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cooked");
    expect(res.body.deduction).toEqual({ shortfalls: [] });
    const chickenBatch = await prisma.pantryBatch.findFirst({ where: { ingredientId: chicken.id, consumedAt: null } });
    expect(chickenBatch?.quantity).toBeCloseTo(300, 5);
  });

  it("rejects overrides on a non-cooked status with 400", async () => {
    const { chicken, plan, pm } = await seed();

    const res = await request(app)
      .put(`/api/plans/${plan.id}/meals/${pm.id}`)
      .send({
        status: "skipped",
        overrides: [{ ingredientId: chicken.id, quantity: 200, unit: "g" }],
      });

    expect(res.status).toBe(400);
  });

  it("rejects duplicate ingredientId rows with 400", async () => {
    const { chicken, plan, pm } = await seed();

    const res = await request(app)
      .put(`/api/plans/${plan.id}/meals/${pm.id}`)
      .send({
        status: "cooked",
        overrides: [
          { ingredientId: chicken.id, quantity: 100, unit: "g" },
          { ingredientId: chicken.id, quantity: 100, unit: "g" },
        ],
      });

    expect(res.status).toBe(400);
  });

  it("rejects qty<=0 with 400", async () => {
    const { chicken, plan, pm } = await seed();

    const res = await request(app)
      .put(`/api/plans/${plan.id}/meals/${pm.id}`)
      .send({
        status: "cooked",
        overrides: [{ ingredientId: chicken.id, quantity: 0, unit: "g" }],
      });

    expect(res.status).toBe(400);
  });

  it("rejects unknown ingredientId with 400", async () => {
    const { plan, pm } = await seed();

    const res = await request(app)
      .put(`/api/plans/${plan.id}/meals/${pm.id}`)
      .send({
        status: "cooked",
        overrides: [{ ingredientId: 99999, quantity: 10, unit: "g" }],
      });

    expect(res.status).toBe(400);
  });

  it("does NOT re-deduct when status update is applied to an already-cooked meal", async () => {
    const { chicken, plan, pm } = await seed();

    // First cook: status planned -> cooked, deducts.
    await request(app)
      .put(`/api/plans/${plan.id}/meals/${pm.id}`)
      .send({
        status: "cooked",
        overrides: [{ ingredientId: chicken.id, quantity: 200, unit: "g" }],
      });

    const after1 = await prisma.pantryBatch.findFirst({ where: { ingredientId: chicken.id, consumedAt: null } });
    expect(after1?.quantity).toBeCloseTo(300, 5);

    // Second update: cooked -> cooked with a different override. Should NOT deduct.
    const res = await request(app)
      .put(`/api/plans/${plan.id}/meals/${pm.id}`)
      .send({
        status: "cooked",
        overrides: [{ ingredientId: chicken.id, quantity: 200, unit: "g" }],
      });

    expect(res.status).toBe(200);
    expect(res.body.deduction).toEqual({ shortfalls: [] });
    const after2 = await prisma.pantryBatch.findFirst({ where: { ingredientId: chicken.id, consumedAt: null } });
    expect(after2?.quantity).toBeCloseTo(300, 5);
  });

  it("falls back to recipe-derived deduction when overrides omitted", async () => {
    const { chicken, plan, pm } = await seed();

    const res = await request(app)
      .put(`/api/plans/${plan.id}/meals/${pm.id}`)
      .send({ status: "cooked" });

    expect(res.status).toBe(200);
    expect(res.body.deduction).toEqual({ shortfalls: [] });
    const chickenBatch = await prisma.pantryBatch.findFirst({ where: { ingredientId: chicken.id, consumedAt: null } });
    // Recipe is 400g for 4 servings; planned 2 servings → multiplier 0.5 → 200g deducted.
    expect(chickenBatch?.quantity).toBeCloseTo(300, 5);
  });
});
```

If `supertest` is not installed in `server/`:

```bash
cd server
pnpm add -D supertest @types/supertest
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd server
pnpm vitest run src/__tests__/cookConfirmRoute.test.ts
```

Expected: FAIL — no validation of overrides exists, no `isCookTransition` guard, no `deduction` field on response.

- [ ] **Step 4: Replace the PUT handler in `routes/plans.ts`**

Open `server/src/routes/plans.ts`. Replace the `router.put(":planId/meals/:mealId", ...)` block (around lines 39-49 of the post-overhaul code) with:

```ts
router.put("/:planId/meals/:mealId", async (req, res) => {
  const mealId = Number(req.params.mealId);
  const isCooked = req.body.status === "cooked";
  const overrides = req.body.overrides;

  // Reject overrides outside of a cooked transition.
  if (!isCooked && overrides !== undefined) {
    res.status(400).json({ error: "overrides only accepted with status=cooked" });
    return;
  }

  // Validate overrides shape, if present.
  if (isCooked && overrides !== undefined) {
    if (!Array.isArray(overrides)) {
      res.status(400).json({ error: "overrides must be an array" });
      return;
    }
    if (!overrides.every((o) => typeof o?.ingredientId === "number" && typeof o?.quantity === "number" && o.quantity > 0 && typeof o?.unit === "string")) {
      res.status(400).json({ error: "invalid override row" });
      return;
    }
    const ids = overrides.map((o) => o.ingredientId);
    if (new Set(ids).size !== ids.length) {
      res.status(400).json({ error: "duplicate ingredientId in overrides" });
      return;
    }
    const found = await prisma.ingredient.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (found.length !== ids.length) {
      res.status(400).json({ error: "unknown ingredientId in overrides" });
      return;
    }
  }

  // Read current status to detect transition.
  const previous = await prisma.plannedMeal.findUnique({ where: { id: mealId }, select: { status: true } });
  if (!previous) {
    res.status(404).json({ error: "Planned meal not found" });
    return;
  }
  const isCookTransition = isCooked && previous.status !== "cooked";

  // Strip overrides from the update payload (it isn't a column).
  const { overrides: _stripped, ...updatePayload } = req.body;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await plannerService.updatePlannedMeal(mealId, updatePayload, tx);
    let deduction = { shortfalls: [] as any[] };
    if (isCookTransition) {
      const multiplier = updated.servings / updated.meal.servings;
      deduction = await deductIngredientsForMeal(updated.mealId, multiplier, overrides, tx);
    }
    return { updated, deduction };
  });

  res.json({ ...result.updated, deduction: result.deduction });
});
```

If the existing import block at the top of the file does not yet pull `prisma` (there's a `const prisma = new PrismaClient();` already), keep that line.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd server
pnpm vitest run src/__tests__/cookConfirmRoute.test.ts
```

Expected: ALL 7 tests pass.

- [ ] **Step 6: Run the full test suite**

```bash
cd server
pnpm vitest run
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/plans.ts server/src/services/plannerService.ts server/src/__tests__/cookConfirmRoute.test.ts server/package.json server/pnpm-lock.yaml
git commit -m "feat(server): cook-transition overrides, validation, and atomic deduction in route"
```

---

### Task 3: Client — extend plans API with overrides parameter and shortfall return type

**Files:**
- Modify: `client/src/api/plans.ts`

The existing `updatePlannedMeal(planId, mealId, data)` already accepts `data: any`. We add a typed helper specifically for the cooked-with-overrides path so call sites are unambiguous.

- [ ] **Step 1: Add types and helper to `client/src/api/plans.ts`**

Append to `client/src/api/plans.ts` (after the existing `updatePlannedMeal` declaration):

```ts
export interface DeductOverride {
  ingredientId: number;
  quantity: number;
  unit: string;
}

export interface DeductShortfall {
  ingredientId: number;
  ingredientName: string;
  requestedQuantity: number;
  requestedUnit: string;
  availableQuantity: number;
  reason: "insufficient" | "no_density" | "no_pantry";
}

export interface MarkCookedResult extends PlannedMeal {
  deduction: { shortfalls: DeductShortfall[] };
}

export const markCookedWithOverrides = (
  planId: number,
  plannedMealId: number,
  overrides: DeductOverride[],
) =>
  apiFetch<MarkCookedResult>(`/plans/${planId}/meals/${plannedMealId}`, {
    method: "PUT",
    body: JSON.stringify({ status: "cooked", overrides }),
  });
```

- [ ] **Step 2: Verify it typechecks**

```bash
cd client
pnpm tsc -b --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/api/plans.ts
git commit -m "feat(client): markCookedWithOverrides API helper + types"
```

---

### Task 4: Client — `<CookConfirmRow>` component (single ingredient row)

**Files:**
- Create: `client/src/components/cookConfirm/CookConfirmRow.tsx`

The smallest unit: one row with checkbox, ingredient name, qty input, unit dropdown, pantry hint, optional X. Stateless — owner manages the row state.

- [ ] **Step 1: Create the component**

Create directory and file: `client/src/components/cookConfirm/CookConfirmRow.tsx`:

```tsx
import { Check, X } from "lucide-react";

export interface CookConfirmRowState {
  /** Stable key (recipe `mealIngredient.id` for recipe rows; "adhoc-${nanoid}" for ad-hoc). */
  key: string;
  ingredientId: number;
  ingredientName: string;
  quantity: number;
  unit: string;
  /** Whether this row will be sent to the server. Recipe rows default true; ad-hoc rows always true. */
  checked: boolean;
  /** True for ad-hoc rows. Affects whether the X (remove) button shows. */
  adhoc: boolean;
}

export interface PantryHint {
  /** "240 ml" or "480 g · 1 lb (2 batches)" or "none". */
  text: string;
  /** True when the row's selected unit is cross-family vs pantry batches and density is missing. */
  warn: boolean;
}

interface Props {
  row: CookConfirmRowState;
  unitOptions: string[];
  hint: PantryHint;
  onChange: (patch: Partial<CookConfirmRowState>) => void;
  onRemove?: () => void; // only set for ad-hoc rows
}

export default function CookConfirmRow({ row, unitOptions, hint, onChange, onRemove }: Props) {
  const dim = !row.checked;
  return (
    <div className="grid grid-cols-[18px_1fr_64px_88px_16px] gap-2.5 items-center px-1 py-2.5 border-b border-line-soft">
      <button
        type="button"
        onClick={() => onChange({ checked: !row.checked })}
        aria-label={row.checked ? "Skip this ingredient" : "Include this ingredient"}
        className={`w-4 h-4 inline-flex items-center justify-center rounded-[4px] border transition ${
          row.checked
            ? "bg-accent border-accent text-accent-on"
            : "bg-transparent border-line"
        }`}
      >
        {row.checked && <Check size={11} strokeWidth={3} />}
      </button>

      <div className={dim ? "opacity-50" : ""}>
        <div className="text-[13.5px] text-ink-1 leading-tight">{row.ingredientName}</div>
        <div className={`text-[11px] mt-0.5 ${hint.warn ? "text-warn-ink" : "text-ink-3"}`}>{hint.text}</div>
      </div>

      <input
        type="number"
        step="any"
        min="0"
        value={row.quantity}
        onChange={(e) => onChange({ quantity: Number(e.target.value) })}
        className={`px-2 py-1.5 text-[13px] bg-surface-2 border border-line rounded-[6px] text-right text-ink-1 tabular-nums focus:outline-none focus:border-accent ${dim ? "opacity-50" : ""}`}
      />

      <select
        value={row.unit}
        onChange={(e) => onChange({ unit: e.target.value })}
        className={`px-2 py-1.5 text-[13px] bg-surface-2 border border-line rounded-[6px] text-ink-1 focus:outline-none focus:border-accent ${dim ? "opacity-50" : ""}`}
      >
        {unitOptions.map((u) => (
          <option key={u} value={u}>{u}</option>
        ))}
      </select>

      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove this ingredient"
          className="text-ink-3 hover:text-ink-1 grid place-items-center"
        >
          <X size={13} />
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}
```

This row uses Tailwind classes that already exist in the project (e.g. `bg-surface-2`, `border-line`, `text-ink-1`, `text-accent-on`, `text-warn-ink`). If `text-warn-ink` doesn't exist in the project's Tailwind config, swap to `text-amber-600` or whatever the project uses for warnings — search for an existing warn-style usage first.

- [ ] **Step 2: Verify it typechecks**

```bash
cd client
pnpm tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/cookConfirm/CookConfirmRow.tsx
git commit -m "feat(client): CookConfirmRow — single ingredient row component"
```

---

### Task 5: Client — `<AddIngredientRow>` typeahead row

**Files:**
- Create: `client/src/components/cookConfirm/AddIngredientRow.tsx`

Persistent row at the bottom of the list. Click expands a typeahead. Pick an ingredient → caller appends a new editable row.

- [ ] **Step 1: Create the component**

Create `client/src/components/cookConfirm/AddIngredientRow.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { Ingredient } from "../../api/ingredients";
import { getIngredients } from "../../api/ingredients";

interface Props {
  /** ingredientIds already on the list — excluded from the typeahead so the modal can't dedupe a server-side 400. */
  excludeIds: number[];
  onPick: (ingredient: Ingredient) => void;
}

export default function AddIngredientRow({ excludeIds, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || ingredients.length > 0) return;
    getIngredients().then(setIngredients).catch(() => setIngredients([]));
  }, [open, ingredients.length]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const filtered = useMemo(() => {
    const exclude = new Set(excludeIds);
    const q = query.trim().toLowerCase();
    return ingredients
      .filter((i) => !exclude.has(i.id))
      .filter((i) => !q || i.name.toLowerCase().includes(q))
      .slice(0, 12);
  }, [ingredients, query, excludeIds]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2.5 w-full text-left px-1 py-3 text-[13px] text-ink-3 hover:bg-surface-2 hover:text-ink-1 border-b border-line-soft"
      >
        <span className="w-4 h-4 inline-flex items-center justify-center rounded-[4px] border border-dashed border-line">
          <Plus size={11} />
        </span>
        Add ingredient…
      </button>
    );
  }

  return (
    <div className="border-b border-line-soft py-2 px-1 flex flex-col gap-2">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search ingredients…"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
          }
        }}
        className="px-2.5 py-1.5 text-[13px] bg-surface-2 border border-line rounded-[6px] text-ink-1 focus:outline-none focus:border-accent"
      />
      {filtered.length > 0 && (
        <div className="max-h-[160px] overflow-y-auto flex flex-col">
          {filtered.map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => {
                onPick(i);
                setQuery("");
                setOpen(false);
              }}
              className="text-left px-2.5 py-1.5 text-[13px] text-ink-1 hover:bg-surface-2 rounded-[4px]"
            >
              {i.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

The "create new ingredient" path is intentionally omitted in v1: ad-hoc additions during a cook should pick from existing ingredients. Creating a brand-new ingredient mid-cook is a chunky path (needs unit, category, etc.); defer to Pantry's "Add Item" modal.

- [ ] **Step 2: Verify it typechecks**

```bash
cd client
pnpm tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/cookConfirm/AddIngredientRow.tsx
git commit -m "feat(client): AddIngredientRow — typeahead row for ad-hoc additions"
```

---

### Task 6: Client — `<CookConfirmModal>` (assembles header, list, footer)

**Files:**
- Create: `client/src/components/cookConfirm/CookConfirmModal.tsx`

Owns row state. Pre-fills from `pm.meal.ingredients` scaled by `pm.servings / pm.meal.servings`. Builds `unitOptions` per row from the conversion engine's known units. Looks up `PantryHint` per row from a `Map<ingredientId, PantryCard>` passed in by the provider.

- [ ] **Step 1: Create the component**

Create `client/src/components/cookConfirm/CookConfirmModal.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { PlannedMeal, DeductOverride } from "../../api/plans";
import type { PantryCard } from "../../api/pantry";
import type { Ingredient } from "../../api/ingredients";
import CookConfirmRow, { type CookConfirmRowState, type PantryHint } from "./CookConfirmRow";
import AddIngredientRow from "./AddIngredientRow";
import Button from "../ui/Button";

const UNIT_OPTIONS_VOLUME = ["tsp", "tbsp", "cup", "ml", "l", "fl oz"];
const UNIT_OPTIONS_MASS = ["g", "kg", "oz", "lb"];
const UNIT_OPTIONS_COUNT = ["count"];

function unitOptionsFor(unit: string): string[] {
  if (UNIT_OPTIONS_VOLUME.includes(unit)) return UNIT_OPTIONS_VOLUME;
  if (UNIT_OPTIONS_MASS.includes(unit)) return UNIT_OPTIONS_MASS;
  if (UNIT_OPTIONS_COUNT.includes(unit)) return UNIT_OPTIONS_COUNT;
  // Unknown family — only allow the original unit.
  return [unit];
}

function formatTotalsByUnit(card: PantryCard | undefined): PantryHint {
  if (!card || card.batchCount === 0) return { text: "pantry: none", warn: false };
  const parts = card.totalsByUnit.map((t) => `${formatQty(t.qty)} ${t.unit}`);
  const suffix = card.batchCount > 1 ? ` (${card.batchCount} batches)` : "";
  return { text: `pantry: ${parts.join(" · ")}${suffix}`, warn: false };
}

function formatQty(n: number): string {
  if (n === Math.floor(n)) return String(n);
  return n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

let adhocCounter = 0;

interface Props {
  pm: PlannedMeal;
  pantryByIngredient: Map<number, PantryCard>;
  onCancel: () => void;
  onSubmit: (overrides: DeductOverride[]) => Promise<void>;
}

export default function CookConfirmModal({ pm, pantryByIngredient, onCancel, onSubmit }: Props) {
  const multiplier = pm.servings / pm.meal.servings;

  const [rows, setRows] = useState<CookConfirmRowState[]>(() =>
    pm.meal.ingredients.map((mi) => ({
      key: `mi-${mi.id}`,
      ingredientId: mi.ingredientId,
      ingredientName: mi.ingredient.name,
      quantity: roundQty(mi.quantity * multiplier),
      unit: mi.unit,
      checked: true,
      adhoc: false,
    })),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onCancel, busy]);

  const excludeIds = useMemo(() => rows.map((r) => r.ingredientId), [rows]);

  const updateRow = (key: string, patch: Partial<CookConfirmRowState>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
  };

  const addAdhoc = (i: Ingredient) => {
    adhocCounter += 1;
    setRows((prev) => [
      ...prev,
      {
        key: `adhoc-${adhocCounter}`,
        ingredientId: i.id,
        ingredientName: i.name,
        quantity: 1,
        unit: i.defaultUnit,
        checked: true,
        adhoc: true,
      },
    ]);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const overrides = rows
        .filter((r) => r.checked && r.quantity > 0)
        .map<DeductOverride>((r) => ({
          ingredientId: r.ingredientId,
          quantity: r.quantity,
          unit: r.unit,
        }));
      await onSubmit(overrides);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-[300] flex items-center justify-center p-4 amp-fade-in"
      style={{ background: "rgba(20, 14, 6, 0.55)", backdropFilter: "blur(4px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-1 border border-line rounded-[16px] w-full max-w-[560px] max-h-[88vh] flex flex-col"
        style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
      >
        <div className="flex items-start gap-3 px-5 py-4 border-b border-line-soft">
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-semibold text-ink-1 leading-tight">{pm.meal.name}</div>
            <div className="text-[12px] text-ink-3 mt-0.5">
              {pm.servings} servings · scaled from recipe ({pm.meal.servings} svgs)
            </div>
          </div>
          <button onClick={onCancel} aria-label="Close" className="w-8 h-8 grid place-items-center rounded-[8px] text-ink-2 hover:bg-surface-2">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          {rows.map((r) => (
            <CookConfirmRow
              key={r.key}
              row={r}
              unitOptions={unitOptionsFor(r.unit)}
              hint={formatTotalsByUnit(pantryByIngredient.get(r.ingredientId))}
              onChange={(patch) => updateRow(r.key, patch)}
              onRemove={r.adhoc ? () => removeRow(r.key) : undefined}
            />
          ))}
          <AddIngredientRow excludeIds={excludeIds} onPick={addAdhoc} />
        </div>

        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-line-soft">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Mark cooked"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function roundQty(n: number): number {
  return Math.round(n * 100) / 100;
}
```

Note: `PlannedMeal` in `client/src/api/plans.ts` does not currently include `meal.ingredients` in its type (the runtime data does, but the type is loose). Verify the runtime shape from the server route's `include` (it does include ingredients via `plannerService.updatePlannedMeal`). If the type is missing, tighten it now: change `PlannedMeal["meal"]` to include `ingredients: Array<{ id: number; ingredientId: number; quantity: number; unit: string; ingredient: Ingredient }>`.

- [ ] **Step 2: Verify typechecks**

```bash
cd client
pnpm tsc -b --noEmit
```

Expected: no errors. If `PantryCard`, `PlannedMeal`, `Ingredient` types are missing fields, tighten them now.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/cookConfirm/CookConfirmModal.tsx client/src/api/plans.ts
git commit -m "feat(client): CookConfirmModal — assembles rows, header, footer"
```

---

### Task 7: Client — `<ShortfallBanner>` (post-save banner)

**Files:**
- Create: `client/src/components/cookConfirm/ShortfallBanner.tsx`

Dismissable banner. Renders shortfalls with per-reason copy. No "Add to shopping list" button (informational only — see Prerequisites).

- [ ] **Step 1: Create the component**

Create `client/src/components/cookConfirm/ShortfallBanner.tsx`:

```tsx
import { X } from "lucide-react";
import type { DeductShortfall } from "../../api/plans";

interface Props {
  shortfalls: DeductShortfall[];
  onDismiss: () => void;
}

function lineFor(s: DeductShortfall): string {
  switch (s.reason) {
    case "insufficient":
      return `${s.ingredientName}: needed ${formatQty(s.requestedQuantity)} ${s.requestedUnit}, had ${formatQty(s.availableQuantity)} ${s.requestedUnit}`;
    case "no_density":
      return `${s.ingredientName}: couldn't deduct (no density set for ${s.requestedUnit})`;
    case "no_pantry":
      return `${s.ingredientName}: not in pantry`;
  }
}

function formatQty(n: number): string {
  if (n === Math.floor(n)) return String(n);
  return n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export default function ShortfallBanner({ shortfalls, onDismiss }: Props) {
  if (shortfalls.length === 0) return null;
  return (
    <div className="bg-warn-soft border border-warn-line border-l-[3px] border-l-warn-ink rounded-[12px] px-4 py-3.5 mb-4">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="text-[13px] font-semibold text-warn-ink">Marked cooked — pantry came up short</div>
        <button onClick={onDismiss} aria-label="Dismiss" className="text-warn-ink/70 hover:text-warn-ink">
          <X size={14} />
        </button>
      </div>
      <ul className="m-0 p-0 list-none text-[12.5px] text-warn-ink/85">
        {shortfalls.map((s, i) => (
          <li key={i} className="py-0.5">• {lineFor(s)}</li>
        ))}
      </ul>
    </div>
  );
}
```

If `bg-warn-soft`, `border-warn-line`, `text-warn-ink` don't exist in the Tailwind theme, replace with `bg-amber-50`, `border-amber-300`, `text-amber-900` (or whatever the project uses for amber/warn elsewhere — check `tailwind.config` or for an existing warn-style component first).

- [ ] **Step 2: Verify typechecks**

```bash
cd client
pnpm tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/cookConfirm/ShortfallBanner.tsx
git commit -m "feat(client): ShortfallBanner — informational post-save banner"
```

---

### Task 8: Client — `<CookConfirmProvider>` + `useCookConfirm` hook

**Files:**
- Create: `client/src/components/cookConfirm/CookConfirmProvider.tsx`
- Modify: `client/src/main.tsx` (or wherever the app root lives)

Mounts the modal and banner once at the app root. `useCookConfirm()` returns `{ openForMeal(planId, plannedMealId) }`. On open, fetches the planned meal + pantry cards, mounts modal. On submit, calls API, dismisses modal, fires banner.

- [ ] **Step 1: Create the provider**

Create `client/src/components/cookConfirm/CookConfirmProvider.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { PlannedMeal, DeductShortfall, DeductOverride } from "../../api/plans";
import { getPlan, markCookedWithOverrides } from "../../api/plans";
import { getPantry, type PantryCard } from "../../api/pantry";
import CookConfirmModal from "./CookConfirmModal";
import ShortfallBanner from "./ShortfallBanner";

interface Ctx {
  openForMeal: (planId: number, plannedMealId: number) => void;
}

const CookConfirmCtx = createContext<Ctx | null>(null);

export function useCookConfirm(): Ctx {
  const ctx = useContext(CookConfirmCtx);
  if (!ctx) throw new Error("useCookConfirm must be used within <CookConfirmProvider>");
  return ctx;
}

interface State {
  planId: number;
  pm: PlannedMeal;
}

export default function CookConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<State | null>(null);
  const [pantryByIngredient, setPantryByIngredient] = useState<Map<number, PantryCard>>(new Map());
  const [shortfalls, setShortfalls] = useState<DeductShortfall[]>([]);

  const openForMeal = useCallback(async (planId: number, plannedMealId: number) => {
    // Fetch the plan + pantry in parallel. The plan response already includes meal.ingredients.
    const [plan, cards] = await Promise.all([getPlan(planId), getPantry()]);
    const pm = plan.plannedMeals.find((p) => p.id === plannedMealId);
    if (!pm) return;
    const map = new Map<number, PantryCard>();
    for (const c of cards) map.set(c.ingredient.id, c);
    setPantryByIngredient(map);
    setOpen({ planId, pm });
  }, []);

  const submit = async (overrides: DeductOverride[]) => {
    if (!open) return;
    const result = await markCookedWithOverrides(open.planId, open.pm.id, overrides);
    setShortfalls(result.deduction.shortfalls);
    setOpen(null);
    // Notify pages to refetch; subscribed pages call their `load()`.
    window.dispatchEvent(new Event("cookconfirm:done"));
  };

  return (
    <CookConfirmCtx.Provider value={{ openForMeal }}>
      <ShortfallBanner shortfalls={shortfalls} onDismiss={() => setShortfalls([])} />
      {children}
      {open && (
        <CookConfirmModal
          pm={open.pm}
          pantryByIngredient={pantryByIngredient}
          onCancel={() => setOpen(null)}
          onSubmit={submit}
        />
      )}
    </CookConfirmCtx.Provider>
  );
}
```

If `getPantryCards()` doesn't exist or has a different name in `client/src/api/pantry`, locate the function used by `Pantry.tsx` and import that one instead.

- [ ] **Step 2: Wrap the app in the provider**

Open `client/src/main.tsx` (or `App.tsx` — whichever holds the route tree). Add:

```tsx
import CookConfirmProvider from "./components/cookConfirm/CookConfirmProvider";
```

Wrap the routed tree:

```tsx
<CookConfirmProvider>
  {/* existing <BrowserRouter>/<Routes>/etc */}
</CookConfirmProvider>
```

The banner is rendered by the provider above `children`, so it appears at the top of the page that mounted the modal.

- [ ] **Step 3: Verify typechecks**

```bash
cd client
pnpm tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/cookConfirm/CookConfirmProvider.tsx client/src/main.tsx
git commit -m "feat(client): CookConfirmProvider + useCookConfirm hook"
```

---

### Task 9: Client — wire Dashboard surfaces (hero "Mark as cooked" + "today's other meals" cells)

**Files:**
- Modify: `client/src/pages/Dashboard.tsx`

Replace `handleCooked` (around line 152) with a call to `useCookConfirm().openForMeal(...)`. Both the hero button (around line 255) and the "today's other meals" cells (around line 302 — buttons that currently silently set status to cooked) call the same handler.

- [ ] **Step 1: Add the hook and rewrite handler**

Open `client/src/pages/Dashboard.tsx`. Add the import:

```tsx
import { useCookConfirm } from "../components/cookConfirm/CookConfirmProvider";
```

Inside the component (near the top, with other hooks):

```tsx
const { openForMeal } = useCookConfirm();
```

Replace the existing `handleCooked` function:

```tsx
const handleCooked = (pm: PlannedMeal) => {
  if (!plan) return;
  openForMeal(plan.id, pm.id);
};
```

The function is no longer `async` — opening the modal is synchronous from the caller's perspective; the actual API call happens after Save.

The provider already dispatches a `cookconfirm:done` window event after a successful save (Task 8). Dashboard subscribes and refetches.

Add to Dashboard's `useEffect` block:

```tsx
useEffect(() => {
  const onDone = () => load();
  window.addEventListener("cookconfirm:done", onDone);
  return () => window.removeEventListener("cookconfirm:done", onDone);
}, [load]);
```

If `load` isn't memoized, wrap it in `useCallback` first, or capture it in a ref to avoid stale closure.

- [ ] **Step 2: Verify typechecks**

```bash
cd client
pnpm tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manually smoke-test**

Start client + server:
```bash
# terminal 1
cd server && pnpm dev
# terminal 2
cd client && pnpm dev
```

In the browser:
1. Go to Dashboard.
2. Click hero "Mark as cooked" → modal opens with that meal's ingredients.
3. Cancel → modal closes, status unchanged.
4. Click hero again → modal opens.
5. Edit a quantity, uncheck a row, click "Mark cooked" → modal closes, status flips to cooked, banner appears if any shortfall.
6. Click a card under "today's other meals" → check whether that surface uses `handleCooked` (some Dashboard layouts may have a separate per-card click handler — search for any other place that mutates `status: "cooked"` and route through the hook).

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Dashboard.tsx client/src/components/cookConfirm/CookConfirmProvider.tsx
git commit -m "feat(client): Dashboard mark-cooked surfaces open CookConfirmModal"
```

---

### Task 10: Client — wire `PlanDayColumn` "Cooked" link

**Files:**
- Modify: `client/src/components/PlanDayColumn.tsx`

Currently `onMarkCooked(pm.id)` is a prop. The parent (Planner.tsx) passes a function that flips the status directly. We could either: (a) change the prop to take `(planId, pm.id)` and have the parent pass the new hook, or (b) have `PlanDayColumn` call the hook itself. (b) is cleaner — fewer prop hops.

- [ ] **Step 1: Use the hook directly**

Open `client/src/components/PlanDayColumn.tsx`. Change the import block to add:

```tsx
import { useCookConfirm } from "./cookConfirm/CookConfirmProvider";
```

Adjust path (`./cookConfirm/...`) to whatever resolves from `components/`. If the provider lives at `client/src/components/cookConfirm/`, this is `./cookConfirm/CookConfirmProvider`.

Change the props: drop `onMarkCooked` from the `Props` type. Keep `onSkip`. Add `planId: number`.

```tsx
interface Props {
  day: DayKey;
  planId: number;
  meals: PlannedMeal[];
  onSkip: (id: number) => void;
}

export default function PlanDayColumn({ day, planId, meals, onSkip }: Props) {
  const { openForMeal } = useCookConfirm();
  // ... existing markup
  // Replace `onClick={() => onMarkCooked(pm.id)}` with:
  // onClick={() => openForMeal(planId, pm.id)}
```

- [ ] **Step 2: Update the parent (Planner.tsx) to pass `planId`**

Open `client/src/pages/Planner.tsx`. Find where `<PlanDayColumn ... onMarkCooked={...}>` is rendered. Replace the `onMarkCooked` prop with `planId={effectiveViewedPlan.id}` (or whatever variable holds the current plan id).

Also, remove the now-unused `onMarkCooked` handler in Planner.tsx if it was a top-level function.

- [ ] **Step 3: Verify typechecks**

```bash
cd client
pnpm tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 4: Manually smoke-test**

In the Planner, click a small "Cooked" link inside a day column → modal opens. Save → status flips, banner appears for any shortfalls.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/PlanDayColumn.tsx client/src/pages/Planner.tsx
git commit -m "feat(client): PlanDayColumn 'Cooked' link opens CookConfirmModal"
```

---

### Task 11: Client — wire `PlannedMealEditModal` status pick to "cooked"

**Files:**
- Modify: `client/src/pages/Planner.tsx` (around line 610-700, the status buttons)

When the user picks "Cooked" inside the existing `PlannedMealEditModal`, we close that modal and open the cook-confirm modal. The other status options ("Planned", "Skipped") proceed as today.

- [ ] **Step 1: Branch in the status-pick handler**

Open `client/src/pages/Planner.tsx`. Find the `PlannedMealEditModal` definition (around line 610). Find the `statuses.map(...)` block (around line 689) where status buttons render. The current onClick is:

```tsx
onClick={() => guarded(() => onChange({ status: s.value }))}
```

Add a new prop to `PlannedMealEditModal`: `onCookedRequested: () => void`. Change the onClick:

```tsx
onClick={() => {
  if (s.value === "cooked") {
    onCookedRequested();
  } else {
    guarded(() => onChange({ status: s.value }));
  }
}}
```

In the parent `Planner` component (around line 461 where `<PlannedMealEditModal ...>` is rendered), import `useCookConfirm`:

```tsx
import { useCookConfirm } from "../components/cookConfirm/CookConfirmProvider";
```

Inside the `Planner` function, use the hook:

```tsx
const { openForMeal } = useCookConfirm();
```

Pass the new prop:

```tsx
<PlannedMealEditModal
  // ... existing props
  onCookedRequested={() => {
    const pm = editing!;
    setEditing(null);            // close edit modal
    openForMeal(effectiveViewedPlan.id, pm.id);
  }}
/>
```

- [ ] **Step 2: Verify typechecks**

```bash
cd client
pnpm tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manually smoke-test**

In the Planner, click a planned meal → edit modal opens. Click "Cooked" → edit modal closes, cook-confirm modal opens. Save → status flips, banner appears for any shortfalls. Verify that clicking "Planned" or "Skipped" from the edit modal still works as before (no cook-confirm modal opens).

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Planner.tsx
git commit -m "feat(client): Planner edit-modal status=cooked opens CookConfirmModal"
```

---

### Task 12: Docs — append "Implementation hooks" section to recipe-versioning plan

**Files:**
- Modify: `docs/superpowers/plans/2026-05-05-recipe-versioning.md`

The cooked-meal modal spec defers "save substitution for next time" to recipe-versioning. We add a section there so the seam is not forgotten when the recipe-versioning work continues.

- [ ] **Step 1: Append the section**

Open `docs/superpowers/plans/2026-05-05-recipe-versioning.md`. Append at the end of the document (use Read to confirm the trailing content first; preserve any existing terminator):

```markdown

---

## Implementation hooks: cooked-meal modal

The cooked-meal validation modal (`docs/superpowers/specs/2026-05-08-cooked-meal-modal-design.md`) intentionally does NOT persist per-cook substitution memory. The "save these as the new default" affordance lives here, in the recipe-versioning flow, not in the cook modal.

When this plan adds the recipe editor's "Save as new version" path:

- Add a small "Save these as the new default" link to the cook-confirm modal footer, visible only when the user has edited recipe rows (qty changes, unit changes, ad-hoc additions, or unchecked recipe rows).
- Clicking that link instead of "Mark cooked" opens `/recipes/:id/edit` pre-populated with the modal's current edited ingredient list, with `Save as new version` highlighted as the default action. The pending cook is preserved in URL state or localStorage so the user can return to confirm.
- The cook itself proceeds independently. Whether the user takes the save-as-version path or just marks cooked, the per-cook deduction works the same — substitution memory and pantry deduction are independent.
- No schema changes needed — the cook-confirm modal already produces the full final ingredient list in the shape the editor consumes.

Files to touch when wiring:

- `client/src/components/cookConfirm/CookConfirmModal.tsx` — add the link in the footer with a `onSaveAsVersion` prop.
- `client/src/components/cookConfirm/CookConfirmProvider.tsx` — accept the prop and route the link's click to `navigate(/recipes/:id/edit?prefill=...)`.
- `client/src/pages/RecipeEditor.tsx` (introduced by this plan) — accept the `?prefill=` query parameter and pre-populate the editor's ingredient list.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-05-05-recipe-versioning.md
git commit -m "docs(plan): cooked-meal modal tie-in for recipe-versioning"
```

---

### Task 13: End-to-end manual smoke test

**Files:** none

Verify all four trigger surfaces and all three shortfall reasons in the running app.

- [ ] **Step 1: Start dev environment**

```bash
# terminal 1
cd server && pnpm prisma migrate deploy && pnpm dev
# terminal 2
cd client && pnpm dev
```

- [ ] **Step 2: Seed test data**

In the app:
1. Add a meal "Test Cook" with 4 servings and 3 ingredients (e.g., chicken thighs 400g, soy sauce 30ml, ginger 5g).
2. Create a plan for the current week and add Test Cook on a day, 2 servings.
3. Pantry: chicken thighs 500g, soy sauce 100ml. Leave ginger out (so we can hit `no_pantry`).
4. Open Pantry → ingredient detail for soy sauce → ensure no density is set (so we can hit `no_density` if we deduct g instead of ml).

- [ ] **Step 3: Verify each trigger surface**

For each, the cook-confirm modal must open with pre-filled rows scaled by 0.5 (200g chicken, 15ml soy, 2.5g ginger):

- Dashboard hero **"Mark as cooked"** button.
- Dashboard "today's other meals" cell click (if Test Cook isn't tonight, set its day to today).
- Planner page → small "Cooked" link inside the day column.
- Planner page → click the meal → edit modal → click "Cooked" status pill.

For each: cancel reverts (status stays `planned`); save commits.

- [ ] **Step 4: Verify shortfall paths**

- **Insufficient:** save 250g chicken (more than 500g pantry · 0.5 = pantry has 500g, deduct 250g, no shortfall). Adjust to 700g to force insufficient → banner shows "Test ingredient: needed 700 g, had 500 g".
- **no_pantry:** keep ginger row checked at 2.5g → after save, banner shows "ginger: not in pantry".
- **no_density:** change soy sauce row's unit from `ml` to `g` (cross-family with no density) → banner shows "soy sauce: couldn't deduct (no density set for g)".

- [ ] **Step 5: Verify ad-hoc add**

Open the cook-confirm modal again on a fresh planned meal. Click "Add ingredient…", search for an ingredient (e.g., "hoisin"), pick it. Row appears at the bottom with X. Edit qty. Save. Verify pantry deducted (or shortfall surfaced).

- [ ] **Step 6: Verify "no re-deduct" on already-cooked meal**

In the Planner, open the edit modal for the just-cooked meal. The "Cooked" status pill is already active (disabled per existing UI). Pick "Planned" → modal stays open, status flips back to planned. Click "Cooked" again → cook-confirm modal opens (this is a fresh cook transition). Save with different overrides → pantry deducts again. Verify the previous deduction was NOT reversed (consumed_at on the original batches stays set — pantry-overhaul's 30-day Undo on the Pantry page is the escape hatch).

- [ ] **Step 7: Confirmation commit (if any test discoveries needed code tweaks)**

If smoke testing surfaced bugs, fix them now. Otherwise nothing to commit.

```bash
git status                 # should show working tree clean
git log --oneline -15      # confirm the feature commit chain
```

---

## Rollout

This branch ships as its own PR off master once Tasks 1-13 are complete. After merge, the running-low / add-to-shopping plumbing (a separate small follow-up) can wire the "Add shortfalls to shopping list" button on `<ShortfallBanner>` — no other changes to this feature.
