# Custom Shopping List Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user add free-text items (toilet paper, paper towels, ad-hoc groceries) to the current week's shopping list. Custom items survive `Regenerate` and never touch the pantry/ingredient graph.

**Architecture:** A new `CustomShoppingItem` Prisma model hangs off `WeeklyPlan` and is fully independent of `ShoppingItem` / `Ingredient`. Four new CRUD endpoints under `/api/shopping/...`. The existing `ShoppingList.tsx` page fetches both lists and merges them: custom items render in an "Extras" sub-section inside the "To buy" card, checked custom items move into the existing "Done" section.

**Tech Stack:** Prisma + PostgreSQL, Express, Vitest + supertest, React, Tailwind.

**Spec:** `docs/superpowers/specs/2026-05-17-custom-shopping-items-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `server/prisma/schema.prisma` | modify | Add `CustomShoppingItem` model + back-reference on `WeeklyPlan` |
| `server/prisma/migrations/<ts>_add_custom_shopping_items/migration.sql` | create (auto via prisma migrate) | DB schema change |
| `server/src/services/shoppingService.ts` | modify | Add `listCustomShoppingItems`, `createCustomShoppingItem`, `updateCustomShoppingItem`, `deleteCustomShoppingItem` (+ `CustomShoppingItemValidationError`) |
| `server/src/routes/shopping.ts` | modify | Add 4 routes; convert validation errors to 400 |
| `server/src/__tests__/customShoppingItems.test.ts` | create | Service + route tests, plus the regenerate-preserves-custom-items invariant |
| `client/src/api/shopping.ts` | modify | Add `CustomShoppingItem` type + 4 API client functions |
| `client/src/pages/ShoppingList.tsx` | modify | Fetch custom items, render Extras sub-section + inline add row, integrate into Done + counts + past-week gate |

The `server/src/__tests__/shoppingService.test.ts` file stays as pure unit tests for `aggregateShoppingItems`. New tests live in a new file because they need DB access and supertest.

---

## Task 1: Add Prisma model and run migration

**Files:**
- Modify: `server/prisma/schema.prisma:194` (add back-reference inside `WeeklyPlan`), and append new model after the `ShoppingItem` model

- [ ] **Step 1: Add back-reference to `WeeklyPlan`**

Open `server/prisma/schema.prisma`. Inside the `model WeeklyPlan` block, after the existing `shoppingItems ShoppingItem[]` line, add:

```prisma
  customShoppingItems CustomShoppingItem[]
```

- [ ] **Step 2: Add the `CustomShoppingItem` model**

Append after the `ShoppingItem` model (after its closing `}`):

```prisma
model CustomShoppingItem {
  id         Int        @id @default(autoincrement())
  planId     Int        @map("plan_id")
  name       String
  qtyText    String?    @map("qty_text")
  checked    Boolean    @default(false)
  createdAt  DateTime   @default(now()) @map("created_at")

  plan       WeeklyPlan @relation(fields: [planId], references: [id], onDelete: Cascade)

  @@index([planId])
  @@map("custom_shopping_items")
}
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:migrate --workspace=server -- --name add_custom_shopping_items`

Expected: Prisma writes a migration file and applies it. The generated client is rebuilt. No prompts (this is purely additive — no existing data is touched).

If you're working in an isolated worktree without DB access, run `npx prisma generate --workspace=server` instead and document that the migration must be applied in the merge-back step.

- [ ] **Step 4: Verify generated client has the new model**

Run: `npx tsc --noEmit --workspace=server` (or `npm run build --workspace=server` and ignore the dist output)

Expected: no type errors. `prisma.customShoppingItem` is callable.

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations
git commit -m "feat(shopping): add CustomShoppingItem model"
```

---

## Task 2: Service layer — list + create (TDD)

**Files:**
- Modify: `server/src/services/shoppingService.ts`
- Create: `server/src/__tests__/customShoppingItems.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/src/__tests__/customShoppingItems.test.ts`:

```ts
// This test wipes shopping-related tables via prisma.*.deleteMany() in beforeEach.
// Only safe against mealplanner_test — vitest.config.ts loads .env.test
// automatically; do NOT run against mealplanner (the real dev DB).
import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  listCustomShoppingItems,
  createCustomShoppingItem,
  CustomShoppingItemValidationError,
} from "../services/shoppingService.js";

const prisma = new PrismaClient();

async function reset() {
  await prisma.customShoppingItem.deleteMany();
  await prisma.shoppingItem.deleteMany();
  await prisma.plannedMeal.deleteMany();
  await prisma.weeklyPlan.deleteMany();
}

async function makePlan() {
  return prisma.weeklyPlan.create({ data: { weekStartDate: new Date("2026-05-17") } });
}

describe("customShoppingItem service — list + create", () => {
  beforeEach(reset);

  it("list returns [] for a plan with no custom items", async () => {
    const plan = await makePlan();
    expect(await listCustomShoppingItems(plan.id)).toEqual([]);
  });

  it("creates a custom item with name only", async () => {
    const plan = await makePlan();
    const row = await createCustomShoppingItem(plan.id, { name: "toilet paper" });
    expect(row.name).toBe("toilet paper");
    expect(row.qtyText).toBeNull();
    expect(row.checked).toBe(false);
    expect(row.planId).toBe(plan.id);
  });

  it("creates a custom item with name and qtyText", async () => {
    const plan = await makePlan();
    const row = await createCustomShoppingItem(plan.id, { name: "paper towels", qtyText: "2 rolls" });
    expect(row.qtyText).toBe("2 rolls");
  });

  it("trims name before storing", async () => {
    const plan = await makePlan();
    const row = await createCustomShoppingItem(plan.id, { name: "  soap  " });
    expect(row.name).toBe("soap");
  });

  it("trims qtyText before storing", async () => {
    const plan = await makePlan();
    const row = await createCustomShoppingItem(plan.id, { name: "soap", qtyText: "  1 bar  " });
    expect(row.qtyText).toBe("1 bar");
  });

  it("stores empty qtyText as null", async () => {
    const plan = await makePlan();
    const row = await createCustomShoppingItem(plan.id, { name: "soap", qtyText: "   " });
    expect(row.qtyText).toBeNull();
  });

  it("rejects empty name", async () => {
    const plan = await makePlan();
    await expect(createCustomShoppingItem(plan.id, { name: "" })).rejects.toBeInstanceOf(CustomShoppingItemValidationError);
  });

  it("rejects whitespace-only name", async () => {
    const plan = await makePlan();
    await expect(createCustomShoppingItem(plan.id, { name: "   " })).rejects.toBeInstanceOf(CustomShoppingItemValidationError);
  });

  it("rejects name longer than 200 chars", async () => {
    const plan = await makePlan();
    await expect(createCustomShoppingItem(plan.id, { name: "x".repeat(201) })).rejects.toBeInstanceOf(CustomShoppingItemValidationError);
  });

  it("rejects qtyText longer than 50 chars", async () => {
    const plan = await makePlan();
    await expect(createCustomShoppingItem(plan.id, { name: "soap", qtyText: "x".repeat(51) })).rejects.toBeInstanceOf(CustomShoppingItemValidationError);
  });

  it("list returns items ordered by createdAt asc", async () => {
    const plan = await makePlan();
    await createCustomShoppingItem(plan.id, { name: "first" });
    await new Promise((r) => setTimeout(r, 10));
    await createCustomShoppingItem(plan.id, { name: "second" });
    const rows = await listCustomShoppingItems(plan.id);
    expect(rows.map((r) => r.name)).toEqual(["first", "second"]);
  });

  it("list scopes to a single plan", async () => {
    const plan1 = await makePlan();
    const plan2 = await prisma.weeklyPlan.create({ data: { weekStartDate: new Date("2026-05-24") } });
    await createCustomShoppingItem(plan1.id, { name: "plan1 item" });
    await createCustomShoppingItem(plan2.id, { name: "plan2 item" });
    const rows1 = await listCustomShoppingItems(plan1.id);
    expect(rows1.map((r) => r.name)).toEqual(["plan1 item"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=server -- customShoppingItems`

Expected: All tests fail. Error mentions that `listCustomShoppingItems`, `createCustomShoppingItem`, and `CustomShoppingItemValidationError` are not exported from `shoppingService.ts`.

- [ ] **Step 3: Implement service functions**

At the end of `server/src/services/shoppingService.ts`, append:

```ts
export class CustomShoppingItemValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomShoppingItemValidationError";
  }
}

const MAX_NAME = 200;
const MAX_QTY_TEXT = 50;

function normalizeName(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new CustomShoppingItemValidationError("name is required");
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new CustomShoppingItemValidationError("name must not be empty");
  }
  if (trimmed.length > MAX_NAME) {
    throw new CustomShoppingItemValidationError(`name must be ${MAX_NAME} chars or fewer`);
  }
  return trimmed;
}

function normalizeQtyText(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new CustomShoppingItemValidationError("qtyText must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_QTY_TEXT) {
    throw new CustomShoppingItemValidationError(`qtyText must be ${MAX_QTY_TEXT} chars or fewer`);
  }
  return trimmed;
}

export async function listCustomShoppingItems(planId: number) {
  return prisma.customShoppingItem.findMany({
    where: { planId },
    orderBy: { createdAt: "asc" },
  });
}

export async function createCustomShoppingItem(
  planId: number,
  input: { name: unknown; qtyText?: unknown },
) {
  const name = normalizeName(input.name);
  const qtyText = normalizeQtyText(input.qtyText);
  return prisma.customShoppingItem.create({
    data: { planId, name, qtyText },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=server -- customShoppingItems`

Expected: All tests in this file pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/shoppingService.ts server/src/__tests__/customShoppingItems.test.ts
git commit -m "feat(shopping): list + create custom shopping items"
```

---

## Task 3: Service layer — update + delete (TDD)

**Files:**
- Modify: `server/src/services/shoppingService.ts`
- Modify: `server/src/__tests__/customShoppingItems.test.ts`

- [ ] **Step 1: Add failing tests**

Append to the test file (before the final `});` of the outer describe, or in a new describe block at the bottom):

```ts
describe("customShoppingItem service — update + delete", () => {
  beforeEach(reset);

  it("toggles checked from false to true", async () => {
    const plan = await makePlan();
    const created = await createCustomShoppingItem(plan.id, { name: "soap" });
    const updated = await updateCustomShoppingItem(created.id, { checked: true });
    expect(updated.checked).toBe(true);
  });

  it("toggles checked from true to false", async () => {
    const plan = await makePlan();
    const created = await createCustomShoppingItem(plan.id, { name: "soap" });
    await updateCustomShoppingItem(created.id, { checked: true });
    const updated = await updateCustomShoppingItem(created.id, { checked: false });
    expect(updated.checked).toBe(false);
  });

  it("updates name", async () => {
    const plan = await makePlan();
    const created = await createCustomShoppingItem(plan.id, { name: "soap" });
    const updated = await updateCustomShoppingItem(created.id, { name: "dish soap" });
    expect(updated.name).toBe("dish soap");
  });

  it("updates qtyText", async () => {
    const plan = await makePlan();
    const created = await createCustomShoppingItem(plan.id, { name: "soap" });
    const updated = await updateCustomShoppingItem(created.id, { qtyText: "2 bars" });
    expect(updated.qtyText).toBe("2 bars");
  });

  it("clears qtyText when passed empty string", async () => {
    const plan = await makePlan();
    const created = await createCustomShoppingItem(plan.id, { name: "soap", qtyText: "2 bars" });
    const updated = await updateCustomShoppingItem(created.id, { qtyText: "" });
    expect(updated.qtyText).toBeNull();
  });

  it("partial patch — checked only does not touch name", async () => {
    const plan = await makePlan();
    const created = await createCustomShoppingItem(plan.id, { name: "soap", qtyText: "2 bars" });
    const updated = await updateCustomShoppingItem(created.id, { checked: true });
    expect(updated.name).toBe("soap");
    expect(updated.qtyText).toBe("2 bars");
  });

  it("rejects empty-string name on update", async () => {
    const plan = await makePlan();
    const created = await createCustomShoppingItem(plan.id, { name: "soap" });
    await expect(updateCustomShoppingItem(created.id, { name: "" })).rejects.toBeInstanceOf(CustomShoppingItemValidationError);
  });

  it("rejects qtyText longer than 50 chars on update", async () => {
    const plan = await makePlan();
    const created = await createCustomShoppingItem(plan.id, { name: "soap" });
    await expect(updateCustomShoppingItem(created.id, { qtyText: "x".repeat(51) })).rejects.toBeInstanceOf(CustomShoppingItemValidationError);
  });

  it("deletes a custom item", async () => {
    const plan = await makePlan();
    const created = await createCustomShoppingItem(plan.id, { name: "soap" });
    await deleteCustomShoppingItem(created.id);
    const rows = await listCustomShoppingItems(plan.id);
    expect(rows).toEqual([]);
  });
});
```

Also extend the imports at the top of the file:

```ts
import {
  listCustomShoppingItems,
  createCustomShoppingItem,
  updateCustomShoppingItem,
  deleteCustomShoppingItem,
  CustomShoppingItemValidationError,
} from "../services/shoppingService.js";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=server -- customShoppingItems`

Expected: Tests in the new describe block fail. Imports fail to resolve.

- [ ] **Step 3: Implement update and delete**

Append to `shoppingService.ts`:

```ts
export async function updateCustomShoppingItem(
  id: number,
  patch: { checked?: unknown; name?: unknown; qtyText?: unknown },
) {
  const data: { checked?: boolean; name?: string; qtyText?: string | null } = {};

  if (patch.checked !== undefined) {
    if (typeof patch.checked !== "boolean") {
      throw new CustomShoppingItemValidationError("checked must be a boolean");
    }
    data.checked = patch.checked;
  }
  if (patch.name !== undefined) {
    data.name = normalizeName(patch.name);
  }
  if (patch.qtyText !== undefined) {
    data.qtyText = normalizeQtyText(patch.qtyText);
  }

  return prisma.customShoppingItem.update({ where: { id }, data });
}

export async function deleteCustomShoppingItem(id: number) {
  await prisma.customShoppingItem.delete({ where: { id } });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=server -- customShoppingItems`

Expected: All update + delete tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/shoppingService.ts server/src/__tests__/customShoppingItems.test.ts
git commit -m "feat(shopping): update + delete custom shopping items"
```

---

## Task 4: Critical invariant — `generateShoppingList` preserves custom items

This is the load-bearing test for the whole feature. If this passes today, the feature is safe; if it ever fails, custom items are getting wiped on Regenerate.

**Files:**
- Modify: `server/src/__tests__/customShoppingItems.test.ts`

- [ ] **Step 1: Add failing test**

Append to the test file:

```ts
import { generateShoppingList } from "../services/shoppingService.js";

describe("customShoppingItem service — invariants", () => {
  beforeEach(reset);

  it("generateShoppingList does NOT delete custom items", async () => {
    const plan = await makePlan();
    await createCustomShoppingItem(plan.id, { name: "toilet paper", qtyText: "2 rolls" });
    await createCustomShoppingItem(plan.id, { name: "paper towels" });

    // Run regenerate. With no planned meals it returns [] but the side effect
    // we care about is shoppingItem.deleteMany — which must NOT touch our table.
    await generateShoppingList(plan.id);

    const rows = await listCustomShoppingItems(plan.id);
    expect(rows.map((r) => r.name).sort()).toEqual(["paper towels", "toilet paper"]);
  });

  it("cascade-deleting a plan removes its custom items", async () => {
    const plan = await makePlan();
    await createCustomShoppingItem(plan.id, { name: "soap" });
    await prisma.weeklyPlan.delete({ where: { id: plan.id } });
    const remaining = await prisma.customShoppingItem.findMany({ where: { planId: plan.id } });
    expect(remaining).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npm test --workspace=server -- customShoppingItems`

Expected: Both invariant tests pass on the first try — we didn't modify `generateShoppingList`, and the schema already specifies `onDelete: Cascade`. These tests are deliberately green-on-arrival; they exist as regression guards.

If either test fails, STOP. The data model is wrong. Re-check `schema.prisma` and `generateShoppingList`.

- [ ] **Step 3: Commit**

```bash
git add server/src/__tests__/customShoppingItems.test.ts
git commit -m "test(shopping): pin regenerate + cascade invariants for custom items"
```

---

## Task 5: Routes — GET, POST, PUT, DELETE (TDD with supertest)

**Files:**
- Modify: `server/src/routes/shopping.ts`
- Modify: `server/src/__tests__/customShoppingItems.test.ts`

- [ ] **Step 1: Add failing route tests**

Append to the test file:

```ts
import express from "express";
import request from "supertest";
import shoppingRouter from "../routes/shopping.js";

const app = express();
app.use(express.json());
app.use("/api/shopping", shoppingRouter);

describe("customShoppingItem routes", () => {
  beforeEach(reset);

  it("GET /api/shopping/:planId/custom returns []", async () => {
    const plan = await makePlan();
    const res = await request(app).get(`/api/shopping/${plan.id}/custom`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("POST /api/shopping/:planId/custom creates an item", async () => {
    const plan = await makePlan();
    const res = await request(app)
      .post(`/api/shopping/${plan.id}/custom`)
      .send({ name: "toilet paper", qtyText: "2 rolls" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("toilet paper");
    expect(res.body.qtyText).toBe("2 rolls");
    expect(res.body.checked).toBe(false);
  });

  it("POST returns 400 on empty name", async () => {
    const plan = await makePlan();
    const res = await request(app).post(`/api/shopping/${plan.id}/custom`).send({ name: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/empty/);
  });

  it("POST returns 400 on missing name", async () => {
    const plan = await makePlan();
    const res = await request(app).post(`/api/shopping/${plan.id}/custom`).send({});
    expect(res.status).toBe(400);
  });

  it("POST returns 400 on name >200 chars", async () => {
    const plan = await makePlan();
    const res = await request(app)
      .post(`/api/shopping/${plan.id}/custom`)
      .send({ name: "x".repeat(201) });
    expect(res.status).toBe(400);
  });

  it("PUT /api/shopping/custom/:id toggles checked", async () => {
    const plan = await makePlan();
    const created = await createCustomShoppingItem(plan.id, { name: "soap" });
    const res = await request(app).put(`/api/shopping/custom/${created.id}`).send({ checked: true });
    expect(res.status).toBe(200);
    expect(res.body.checked).toBe(true);
  });

  it("PUT returns 400 on invalid name", async () => {
    const plan = await makePlan();
    const created = await createCustomShoppingItem(plan.id, { name: "soap" });
    const res = await request(app).put(`/api/shopping/custom/${created.id}`).send({ name: "" });
    expect(res.status).toBe(400);
  });

  it("DELETE /api/shopping/custom/:id returns 204 and removes the row", async () => {
    const plan = await makePlan();
    const created = await createCustomShoppingItem(plan.id, { name: "soap" });
    const res = await request(app).delete(`/api/shopping/custom/${created.id}`);
    expect(res.status).toBe(204);
    const rows = await listCustomShoppingItems(plan.id);
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=server -- customShoppingItems`

Expected: All route tests fail with 404 (routes don't exist yet).

- [ ] **Step 3: Add the routes**

Modify `server/src/routes/shopping.ts`. The full new file:

```ts
import { Router } from "express";
import * as shoppingService from "../services/shoppingService.js";
import { CustomShoppingItemValidationError } from "../services/shoppingService.js";

const router = Router();

router.post("/generate/:planId", async (req, res) => {
  const items = await shoppingService.generateShoppingList(Number(req.params.planId));
  res.status(201).json(items);
});

router.get("/low-stock", async (_req, res) => {
  const suggestions = await shoppingService.getLowStockSuggestions();
  res.json(suggestions);
});

// Custom items — list before the generic :planId route so /:planId/custom resolves correctly.
router.get("/:planId/custom", async (req, res) => {
  const items = await shoppingService.listCustomShoppingItems(Number(req.params.planId));
  res.json(items);
});

router.post("/:planId/custom", async (req, res) => {
  try {
    const item = await shoppingService.createCustomShoppingItem(
      Number(req.params.planId),
      { name: req.body?.name, qtyText: req.body?.qtyText },
    );
    res.status(201).json(item);
  } catch (e) {
    if (e instanceof CustomShoppingItemValidationError) {
      res.status(400).json({ error: e.message });
      return;
    }
    throw e;
  }
});

router.put("/custom/:id", async (req, res) => {
  try {
    const item = await shoppingService.updateCustomShoppingItem(Number(req.params.id), {
      checked: req.body?.checked,
      name: req.body?.name,
      qtyText: req.body?.qtyText,
    });
    res.json(item);
  } catch (e) {
    if (e instanceof CustomShoppingItemValidationError) {
      res.status(400).json({ error: e.message });
      return;
    }
    throw e;
  }
});

router.delete("/custom/:id", async (req, res) => {
  await shoppingService.deleteCustomShoppingItem(Number(req.params.id));
  res.status(204).end();
});

router.get("/:planId", async (req, res) => {
  const items = await shoppingService.getShoppingList(Number(req.params.planId));
  res.json(items);
});

router.put("/item/:id", async (req, res) => {
  const item = await shoppingService.toggleShoppingItem(Number(req.params.id), req.body.checked);
  res.json(item);
});

export default router;
```

**Route ordering note:** Express matches in declaration order. The new `/:planId/custom` route is declared *before* the existing `/:planId` route so the literal `/custom` suffix doesn't get swallowed by the generic param. Same reason `/low-stock` is declared before `/:planId` today.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=server -- customShoppingItems`

Expected: All tests in the file pass (service + invariants + routes).

- [ ] **Step 5: Sanity-check existing shopping tests still pass**

Run: `npm test --workspace=server -- shopping`

Expected: Both `shoppingService.test.ts` and `customShoppingItems.test.ts` pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/shopping.ts server/src/__tests__/customShoppingItems.test.ts
git commit -m "feat(shopping): expose custom shopping item CRUD routes"
```

---

## Task 6: Client API client

**Files:**
- Modify: `client/src/api/shopping.ts`

- [ ] **Step 1: Add types and functions**

Append to `client/src/api/shopping.ts`:

```ts
export interface CustomShoppingItem {
  id: number;
  planId: number;
  name: string;
  qtyText: string | null;
  checked: boolean;
  createdAt: string;
}

export const getCustomShoppingItems = (planId: number) =>
  apiFetch<CustomShoppingItem[]>(`/shopping/${planId}/custom`);

export const createCustomShoppingItem = (
  planId: number,
  input: { name: string; qtyText?: string },
) =>
  apiFetch<CustomShoppingItem>(`/shopping/${planId}/custom`, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const updateCustomShoppingItem = (
  id: number,
  patch: { checked?: boolean; name?: string; qtyText?: string },
) =>
  apiFetch<CustomShoppingItem>(`/shopping/custom/${id}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });

export const deleteCustomShoppingItem = (id: number) =>
  apiFetch<void>(`/shopping/custom/${id}`, { method: "DELETE" });
```

The DELETE endpoint returns 204. `apiFetch` already handles that — see `client/src/api/client.ts:14` (`if (res.status === 204) return undefined as T;`) — so the typed return of `apiFetch<void>` is correct as-is.

- [ ] **Step 2: Run type-check**

Run: `npm run build --workspace=client` (or `npx tsc --noEmit --project client/tsconfig.json` if available)

Expected: clean compile.

- [ ] **Step 3: Commit**

```bash
git add client/src/api/shopping.ts
git commit -m "feat(shopping): client API for custom shopping items"
```

---

## Task 7: ShoppingList page — state + fetch

**Files:**
- Modify: `client/src/pages/ShoppingList.tsx`

- [ ] **Step 1: Add imports and state**

In `client/src/pages/ShoppingList.tsx`, extend the imports from `../api/shopping` to include the four new functions and the type:

```ts
import {
  generateShoppingList,
  getLowStockSuggestions,
  getShoppingList,
  toggleItem,
  getCustomShoppingItems,
  createCustomShoppingItem,
  updateCustomShoppingItem,
  deleteCustomShoppingItem,
  type LowStockSuggestion,
  type ShoppingItem,
  type CustomShoppingItem,
} from "../api/shopping";
```

Also import `Plus` and `X` from lucide-react (alongside existing icon imports at top of file):

```ts
import { RefreshCw, CheckCircle2, Check, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
```

Inside the component, near the existing `items` state, add:

```tsx
const [customItems, setCustomItems] = useState<CustomShoppingItem[]>([]);
```

- [ ] **Step 2: Add a fetch effect keyed on `viewedPlan?.id`**

After the existing `useEffect` that fetches `items`, add:

```tsx
useEffect(() => {
  if (!viewedPlan) {
    setCustomItems([]);
    return;
  }
  getCustomShoppingItems(viewedPlan.id).then(setCustomItems).catch(() => setCustomItems([]));
}, [viewedPlan?.id]);
```

- [ ] **Step 3: Verify by running the dev server briefly**

Run: `npm run dev` (from repo root).

Manual check: open the Shopping List page. The list should render exactly as before (no visual change yet) — the new state is fetched but unused.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/ShoppingList.tsx
git commit -m "feat(shopping): fetch custom items into ShoppingList state"
```

---

## Task 8: ShoppingList page — CustomRow component

**Files:**
- Modify: `client/src/pages/ShoppingList.tsx`

- [ ] **Step 1: Add `CustomRow` below the existing `Row` function**

Inside `ShoppingList.tsx`, after the existing `Row` function (around line 301), add:

```tsx
function CustomRow({
  item, onToggle, onDelete, last, strikethrough, disabled,
}: {
  item: CustomShoppingItem;
  onToggle: (id: number, checked: boolean) => void;
  onDelete: (id: number) => void;
  last: boolean;
  strikethrough?: boolean;
  disabled?: boolean;
}) {
  const Wrapper: any = disabled ? "div" : "label";
  return (
    <Wrapper
      className={`group grid grid-cols-[auto_1fr_auto_auto] gap-3 items-center px-4 sm:px-5 py-3 ${disabled ? "cursor-not-allowed opacity-80" : "cursor-pointer"} ${last ? "" : "border-b border-line-soft"}`}
    >
      <span
        className="w-5 h-5 rounded-[6px] grid place-items-center"
        style={{
          border: `1.5px solid ${item.checked ? "var(--accent)" : "var(--ink-3)"}`,
          background: item.checked ? "var(--accent)" : "transparent",
          color: "var(--accent-on)",
        }}
      >
        {item.checked && <Check size={13} strokeWidth={2.5} />}
      </span>
      {!disabled && (
        <input
          type="checkbox"
          checked={item.checked}
          onChange={() => onToggle(item.id, !item.checked)}
          className="hidden"
        />
      )}
      <div
        className="text-[14px] text-ink-1"
        style={{ textDecoration: strikethrough ? "line-through" : "none" }}
      >
        {item.name}
      </div>
      <div className="text-[12.5px] text-ink-3 tabular-nums">
        {item.qtyText ?? ""}
      </div>
      {!disabled && !strikethrough ? (
        <button
          type="button"
          aria-label={`Delete ${item.name}`}
          onClick={(e) => { e.preventDefault(); onDelete(item.id); }}
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 w-6 h-6 grid place-items-center rounded-[6px] text-ink-3 hover:bg-surface-2 hover:text-ink-1 transition-opacity"
        >
          <X size={13} />
        </button>
      ) : <span />}
    </Wrapper>
  );
}
```

The grid is 4 columns: checkbox / name / qty / delete. When `disabled` (past week) or `strikethrough` (Done section), the delete column is rendered as a placeholder `<span />` so the grid alignment stays consistent.

- [ ] **Step 2: Type-check**

Run: `npm run build --workspace=client`

Expected: clean compile (no JSX errors). The component isn't rendered anywhere yet — that's the next task.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/ShoppingList.tsx
git commit -m "feat(shopping): CustomRow component"
```

---

## Task 9: Extras sub-section — render + toggle + delete

**Files:**
- Modify: `client/src/pages/ShoppingList.tsx`

- [ ] **Step 1: Add toggle + delete handlers**

Near the existing `handleToggle` function, add:

```tsx
const handleToggleCustom = async (id: number, checked: boolean) => {
  if (isPastWeek) return;
  const prev = customItems;
  setCustomItems(customItems.map((i) => i.id === id ? { ...i, checked } : i));
  try {
    await updateCustomShoppingItem(id, { checked });
  } catch {
    setCustomItems(prev);
  }
};

const handleDeleteCustom = async (id: number) => {
  if (isPastWeek) return;
  const prev = customItems;
  setCustomItems(customItems.filter((i) => i.id !== id));
  try {
    await deleteCustomShoppingItem(id);
  } catch {
    setCustomItems(prev);
  }
};
```

- [ ] **Step 2: Compute unchecked + checked partitions**

After the existing `toBuy` / `alreadyHave` / `done` memos, add:

```tsx
const customToBuy = useMemo(() => customItems.filter((i) => !i.checked), [customItems]);
const customDone = useMemo(() => customItems.filter((i) =>  i.checked), [customItems]);
```

- [ ] **Step 3: Render Extras inside the "To buy" card**

Locate the existing block (around line 202):

```tsx
{toBuy.length > 0 && (
  <Section title="To buy" count={toBuy.length}>
    {byCategory(toBuy).map(([cat, list]) => ( ... ))}
  </Section>
)}
```

Replace it with:

```tsx
{(toBuy.length > 0 || customToBuy.length > 0 || !isPastWeek) && viewedPlan && (
  <Section title="To buy" count={toBuy.length + customToBuy.length}>
    {byCategory(toBuy).map(([cat, list]) => (
      <div key={cat}>
        <div className="px-4 sm:px-5 pt-2.5 pb-1 text-[11px] font-semibold text-accent-ink tracking-[0.05em] uppercase">
          {CATEGORY_LABELS[cat] ?? cat}
        </div>
        {list.map((item, i) => (
          <Row key={item.id} item={item} onToggle={handleToggle} last={i === list.length - 1} disabled={isPastWeek} />
        ))}
      </div>
    ))}
    <div>
      <div className="px-4 sm:px-5 pt-2.5 pb-1 text-[11px] font-semibold text-accent-ink tracking-[0.05em] uppercase">
        Extras
      </div>
      {customToBuy.map((item, i) => (
        <CustomRow
          key={item.id}
          item={item}
          onToggle={handleToggleCustom}
          onDelete={handleDeleteCustom}
          last={i === customToBuy.length - 1 && isPastWeek}
          disabled={isPastWeek}
        />
      ))}
      {/* Inline add row goes here in the next task. last={false} above leaves a border for it. */}
    </div>
  </Section>
)}
```

The `last` prop on the final CustomRow is intentionally `i === customToBuy.length - 1 && isPastWeek` so that when the add row is rendered (next task) it slots in cleanly; when in past-week mode there is no add row and the final row should be borderless.

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`. On the Shopping List page:
- Pick a current week with a generated list. The "Extras" sub-header should appear inside the "To buy" card below the category groups.
- Use a DB tool (or psql) to insert a row: `INSERT INTO custom_shopping_items (plan_id, name, qty_text) VALUES (<your plan id>, 'toilet paper', '2 rolls');`
- Reload the page. The row should appear under "Extras".
- Click its checkbox. It should toggle (no visible movement yet — Done integration is the next task; row stays in Extras checked).
- Hover over the row. The × button should appear on the right.
- Click ×. The row should disappear.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/ShoppingList.tsx
git commit -m "feat(shopping): render Extras sub-section with toggle and delete"
```

---

## Task 10: Inline add row

**Files:**
- Modify: `client/src/pages/ShoppingList.tsx`

- [ ] **Step 1: Add state for the add-row inputs**

Inside the component, near other `useState` calls:

```tsx
const [draftName, setDraftName] = useState("");
const [draftQty, setDraftQty] = useState("");
```

- [ ] **Step 2: Add the create handler**

Near other handlers:

```tsx
const handleAddCustom = async () => {
  const name = draftName.trim();
  if (!name || !viewedPlan || isPastWeek) return;
  const qtyText = draftQty.trim();
  const optimisticId = -Date.now(); // negative id so it can't collide with real ones
  const optimistic: CustomShoppingItem = {
    id: optimisticId,
    planId: viewedPlan.id,
    name,
    qtyText: qtyText || null,
    checked: false,
    createdAt: new Date().toISOString(),
  };
  setCustomItems([...customItems, optimistic]);
  setDraftName("");
  setDraftQty("");
  try {
    const created = await createCustomShoppingItem(viewedPlan.id, { name, qtyText: qtyText || undefined });
    setCustomItems((prev) => prev.map((i) => i.id === optimisticId ? created : i));
  } catch {
    setCustomItems((prev) => prev.filter((i) => i.id !== optimisticId));
  }
};
```

- [ ] **Step 3: Render the add row at the bottom of Extras**

Inside the `<div>` that wraps the Extras sub-section (added in Task 9), after the `customToBuy.map(...)` block and before the closing `</div>`, replace the placeholder comment with:

```tsx
{!isPastWeek && (
  <div className="grid grid-cols-[auto_1fr_auto_auto] gap-3 items-center px-4 sm:px-5 py-3">
    <span className="w-5 h-5" aria-hidden />
    <input
      type="text"
      value={draftName}
      onChange={(e) => setDraftName(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") handleAddCustom(); }}
      maxLength={200}
      placeholder="Add an item (e.g. toilet paper)"
      className="text-[14px] bg-transparent outline-none text-ink-1 placeholder:text-ink-3"
    />
    <input
      type="text"
      value={draftQty}
      onChange={(e) => setDraftQty(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") handleAddCustom(); }}
      maxLength={50}
      placeholder="Qty"
      className="text-[12.5px] bg-transparent outline-none text-ink-3 placeholder:text-ink-3 text-right tabular-nums w-20"
    />
    <button
      type="button"
      onClick={handleAddCustom}
      disabled={draftName.trim().length === 0}
      aria-label="Add item"
      className="w-6 h-6 grid place-items-center rounded-[6px] text-ink-3 hover:bg-surface-2 hover:text-ink-1 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-default"
    >
      <Plus size={14} />
    </button>
  </div>
)}
```

- [ ] **Step 4: Manual smoke test**

Run `npm run dev`. On the Shopping List page:
- The bottom of the Extras section now has two text fields and a + button.
- Type "toilet paper", press Enter. Row appears in Extras. Inputs clear.
- Type "paper towels" + "2 rolls" in the Qty field, click +. Row appears with "2 rolls" on the right.
- Try Enter with empty name: nothing happens.
- Past-week navigation: the add row is hidden.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/ShoppingList.tsx
git commit -m "feat(shopping): inline add row for custom items"
```

---

## Task 11: Done section integrates custom items

**Files:**
- Modify: `client/src/pages/ShoppingList.tsx`

- [ ] **Step 1: Update the Done section render**

Locate the existing Done block (around line 228 of the original file):

```tsx
{done.length > 0 && (
  <div className="opacity-65 bg-surface-1 border border-line rounded-[14px] overflow-hidden">
    <div className="px-4 sm:px-5 py-3 text-[11px] text-ink-3 uppercase tracking-[0.08em]">
      Done · {done.length}
    </div>
    {done.map((item, i) => (
      <Row key={item.id} item={item} onToggle={handleToggle} last={i === done.length - 1} strikethrough disabled={isPastWeek} />
    ))}
  </div>
)}
```

Replace with:

```tsx
{(done.length + customDone.length) > 0 && (
  <div className="opacity-65 bg-surface-1 border border-line rounded-[14px] overflow-hidden">
    <div className="px-4 sm:px-5 py-3 text-[11px] text-ink-3 uppercase tracking-[0.08em]">
      Done · {done.length + customDone.length}
    </div>
    {done.map((item, i) => (
      <Row
        key={`g-${item.id}`}
        item={item}
        onToggle={handleToggle}
        last={i === done.length - 1 && customDone.length === 0}
        strikethrough
        disabled={isPastWeek}
      />
    ))}
    {customDone.map((item, i) => (
      <CustomRow
        key={`c-${item.id}`}
        item={item}
        onToggle={handleToggleCustom}
        onDelete={handleDeleteCustom}
        last={i === customDone.length - 1}
        strikethrough
        disabled={isPastWeek}
      />
    ))}
  </div>
)}
```

Key keys are namespaced (`g-` / `c-`) so two items with overlapping ids across the two tables don't collide.

- [ ] **Step 2: Manual smoke test**

Run `npm run dev`. On the Shopping List page:
- Add a custom item, then check it. It moves from Extras to the Done section with strikethrough. No × button in Done.
- Uncheck it. It moves back to Extras.
- Check a generated item too. The two render together in Done.

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/ShoppingList.tsx
git commit -m "feat(shopping): include custom items in Done section"
```

---

## Task 12: Header chip count includes custom items

**Files:**
- Modify: `client/src/pages/ShoppingList.tsx`

- [ ] **Step 1: Update the header count**

Locate the header chip (around line 124 of the original file):

```tsx
Week of {monthLabel}{toBuy.length > 0 ? ` · ${toBuy.length} to buy` : ""}
```

Replace with:

```tsx
{(() => {
  const total = toBuy.length + customToBuy.length;
  return `Week of ${monthLabel}${total > 0 ? ` · ${total} to buy` : ""}`;
})()}
```

- [ ] **Step 2: Manual smoke test**

Run `npm run dev`. Verify that adding/removing/checking custom items changes the "· N to buy" header count in real time.

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/ShoppingList.tsx
git commit -m "feat(shopping): include custom items in to-buy header count"
```

---

## Task 13: NoListCard becomes a nudge above Extras

**Files:**
- Modify: `client/src/pages/ShoppingList.tsx`

- [ ] **Step 1: Update the no-list rendering path**

Locate the existing block (around line 150 of the original file):

```tsx
{!viewedPlan ? (
  <NoPlanCard ... />
) : items.length === 0 ? (
  <NoListCard
    isPastWeek={isPastWeek}
    generating={generating}
    onGenerate={handleGenerate}
  />
) : null}
```

Replace with:

```tsx
{!viewedPlan ? (
  <NoPlanCard
    isPastWeek={isPastWeek}
    viewedWeek={viewedWeek}
    monthLabel={monthLabel}
    onGoToPlanner={() => navigate(`/planner?week=${viewedWeek}`)}
  />
) : items.length === 0 ? (
  <NoListCard
    isPastWeek={isPastWeek}
    generating={generating}
    onGenerate={handleGenerate}
    compact={customItems.length > 0 || !isPastWeek}
  />
) : null}
```

The `compact` flag tells the card to render a smaller nudge when there's still going to be an Extras section visible below it.

- [ ] **Step 2: Update `NoListCard`**

Modify the existing function (around line 339):

```tsx
function NoListCard({
  isPastWeek,
  generating,
  onGenerate,
  compact,
}: {
  isPastWeek: boolean;
  generating: boolean;
  onGenerate: () => void;
  compact?: boolean;
}) {
  if (isPastWeek) {
    return (
      <div className="rounded-[16px] border border-dashed border-line bg-surface-1 p-8 text-center">
        <div className="text-[14px] text-ink-2">No shopping list for this week.</div>
      </div>
    );
  }
  if (compact) {
    return (
      <div className="rounded-[14px] border border-dashed border-line bg-surface-1 p-4 flex items-center justify-between gap-3">
        <div className="text-[13px] text-ink-2">No generated list yet.</div>
        <Button variant="ghost" icon={RefreshCw} onClick={onGenerate} disabled={generating}>
          {generating ? "Generating…" : "Generate from this week's plan"}
        </Button>
      </div>
    );
  }
  return (
    <div className="rounded-[16px] border border-dashed border-line bg-surface-1 p-8 text-center flex flex-col items-center gap-3">
      <div className="text-[14px] text-ink-2">No shopping list yet.</div>
      <Button variant="primary" icon={RefreshCw} onClick={onGenerate} disabled={generating}>
        {generating ? "Generating…" : "Generate from this week's plan"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Manual smoke test**

Run `npm run dev`.
- On a plan that has no generated list and no custom items: the original large NoListCard renders.
- Add a custom item via the inline add row. The Extras section appears AND the NoListCard collapses into the compact inline variant above it (because `customItems.length > 0`).
- Hit "Generate from this week's plan" from the compact card; the generated list appears, the NoListCard disappears, and Extras continues to show below.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/ShoppingList.tsx
git commit -m "feat(shopping): compact NoListCard nudge when Extras is visible"
```

---

## Task 14: Final smoke pass against the spec checklist

This task has no code changes — it's the verification gate from the spec.

**Files:** none.

- [ ] **Step 1: Run the full server test suite**

Run: `npm test --workspace=server`

Expected: All tests pass, including the existing shopping tests and the new `customShoppingItems` tests.

- [ ] **Step 2: Run the dev server and walk through the spec's smoke-test checklist**

Run: `npm run dev`.

Walk through each item from the spec's "Manual smoke test" section:
- Add "toilet paper" + "2 rolls" → appears in Extras.
- Hit Regenerate → custom item still there, generated items refreshed.
- Check custom item → moves to Done with strikethrough.
- Uncheck custom item → moves back to Extras.
- Delete custom item (× on hover) → gone from list.
- Navigate to last week (or any past week) → no add row, no × buttons, no toggling. Existing past-week behavior unchanged for generated items.
- Navigate to a future week with no plan → NoPlanCard renders. No Extras section (custom items require a plan — consistent with non-goal).
- Navigate to a future week with a plan but no generated list → Extras is rendered with its add row. NoListCard appears above it in the compact inline variant.
- Header chip shows accurate "· N to buy" count including both generated to-buy items and unchecked custom items.

If any step misbehaves, fix it and re-run before declaring done. Do NOT mark this task complete with known issues.

Stop the dev server.

- [ ] **Step 3: No commit needed**

This task is verification only. The feature is done when this checklist passes end-to-end.

---

## Notes for the implementer

- **DB safety:** The new test file mirrors the pattern from `cookConfirmRoute.test.ts` — `beforeEach` wipes shopping/plan-related tables. The header comment in those files explicitly warns it's only safe against `mealplanner_test`. The repo's `vitest.config.ts` loads `.env.test` automatically. Do not run `npm test` against your dev DB.
- **Route ordering:** Express matches routes in declaration order. The new `GET /:planId/custom` is registered *before* `GET /:planId` so the literal `/custom` segment isn't swallowed by the generic param. The same ordering trick is used today for `/low-stock`.
- **Optimistic updates:** Match the existing `toggleItem` pattern (rollback on rejection, no toast). The spec is explicit about this — don't introduce a notification system as part of this feature.
- **No agent tool:** Adding an MCP tool so the chat agent can add custom items via `addCustomShoppingItem` is explicitly out of scope. If you find yourself touching `server/src/agent/tools/shopping.ts`, stop — that belongs to a follow-up spec.
- **Don't restructure `ShoppingList.tsx`:** This file is ~360 lines today. The plan adds ~150 lines. If it starts feeling unwieldy, that's a follow-up — don't split it as part of this feature.
