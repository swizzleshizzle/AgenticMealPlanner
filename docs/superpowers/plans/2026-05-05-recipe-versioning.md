# Recipe Versioning, Variants, Archive, and Manual Create — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recipes editable in-place, supersedable into versions, forkable into sibling variants, archivable at variant + family level, and creatable from a blank editor.

**Architecture:** Extend the existing `Meal` row with five columns (`recipe_id`, `version_number`, `parent_meal_id`, `is_default`, `archived_at`) — no new family table. `PlannedMeal.mealId` keeps pointing at a specific version row. The shopping-list resolver picks "current default" only for `planned`-status occurrences; `cooked`/`skipped`/`swapped` rows freeze to the row they were created against.

**Tech Stack:** Express + Prisma (PostgreSQL), Vitest, React + react-router, TailwindCSS.

**Reference spec:** `docs/superpowers/specs/2026-05-05-recipe-versioning-design.md`

---

## File map

**Modify**
- `server/prisma/schema.prisma` — add 5 columns + indexes to `Meal`.
- `server/src/services/mealService.ts` — filter `getAllMeals`; add `recipeId` self-set on create; new ops: `getFamily`, `supersedeMeal`, `createVariant`, `archiveMeal`, `archiveFamily`, `unarchiveMeal`, `setDefault`, `getArchivedMeals`. New helper `copyMealAssets`.
- `server/src/services/shoppingService.ts` — resolve PlannedMeal version by status before aggregating.
- `server/src/routes/meals.ts` — new endpoints; remove the existing hard-`DELETE` from the response payload only after frontend stops calling it (we'll keep the route alive for now).
- `server/src/routes/plans.ts` — filter the candidate pool used by the auto-planner.
- `server/src/services/chatService.ts` — same filter for the chat agent's meal context.
- `server/src/__tests__/mealService.test.ts` — new tests for pure helpers.
- `server/src/__tests__/shoppingService.test.ts` — new test for status-based resolution helper.
- `client/src/api/meals.ts` — client functions for new endpoints + new types.
- `client/src/App.tsx` — register `/recipes/new`, `/recipes/:id/edit`, `/recipes/:id/variant`, `/recipes/archived`.
- `client/src/components/MealForm.tsx` — extend with full ingredient editor.
- `client/src/pages/Recipes.tsx` — "+ New recipe" button; "N variants" pill in cards; archive page link.
- `client/src/pages/RecipeDetail.tsx` — variant chips; Edit / Create variant / Set default / Archive variant / Archive recipe affordances; remove Delete; "archived" indicator when viewing archived rows.
- `client/src/components/MealCard.tsx` — `variantCount` pill.
- `client/src/components/PlanDayColumn.tsx` — "archived" pill when resolved version is archived.

**Create**
- `server/prisma/migrations/007_recipe_versioning/migration.sql` — migration.
- `server/src/services/mealVersioning.ts` — pure helpers: `pickNextDefaultAfterArchive`, `resolvePlannedMealForShopping`. (Keeps `mealService.ts` from sprawling and matches the codebase pattern of pure-function unit tests.)
- `server/src/__tests__/mealVersioning.test.ts` — unit tests for the pure helpers.
- `client/src/pages/RecipeEditor.tsx` — shared editor page for `/recipes/new`, `/recipes/:id/edit`, `/recipes/:id/variant`. Wraps `MealForm` and adds the three save buttons.
- `client/src/components/IngredientEditor.tsx` — typeahead-driven ingredient row editor with quantity/unit/preparation, used inside `MealForm`.
- `client/src/pages/RecipeArchive.tsx` — `/recipes/archived` page.

---

## Task 1: Schema migration

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/007_recipe_versioning/migration.sql`

- [ ] **Step 1: Add the columns + indexes to the Prisma model**

In `server/prisma/schema.prisma`, replace the `Meal` model with the version-aware shape:

```prisma
model Meal {
  id          Int       @id @default(autoincrement())
  name        String
  description String?
  source      MealSource @default(manual)
  sourceUrl   String?    @map("source_url")
  canBatch    Boolean    @default(false) @map("can_batch")
  canFresh    Boolean    @default(true)  @map("can_fresh")
  servings    Int        @default(2)
  prepTime    Int?       @map("prep_time")
  cookTime    Int?       @map("cook_time")
  tags        String[]   @default([])
  instructions Json      @default("[]")
  imageUrl    String?    @map("image_url")

  calories    Int?
  proteinG    Float?     @map("protein_g")
  carbsG      Float?     @map("carbs_g")
  fatG        Float?     @map("fat_g")
  fiberG      Float?     @map("fiber_g")
  sodiumMg    Float?     @map("sodium_mg")

  pdfPath     String?  @map("pdf_path")
  imagePath   String?  @map("image_path")
  imageSource String?  @map("image_source")

  recipeId      Int       @map("recipe_id")
  versionNumber Int       @default(1) @map("version_number")
  parentMealId  Int?      @map("parent_meal_id")
  isDefault     Boolean   @default(true) @map("is_default")
  archivedAt    DateTime? @map("archived_at")

  parent      Meal?     @relation("MealSupersede", fields: [parentMealId], references: [id])
  supersedes  Meal[]    @relation("MealSupersede")

  createdAt   DateTime   @default(now()) @map("created_at")
  updatedAt   DateTime   @updatedAt @map("updated_at")

  ingredients  MealIngredient[]
  plannedMeals PlannedMeal[]

  @@index([recipeId])
  @@index([recipeId, archivedAt, isDefault])
  @@map("meals")
}
```

- [ ] **Step 2: Write the migration SQL**

Create `server/prisma/migrations/007_recipe_versioning/migration.sql`:

```sql
ALTER TABLE meals
  ADD COLUMN recipe_id      integer,
  ADD COLUMN version_number integer NOT NULL DEFAULT 1,
  ADD COLUMN parent_meal_id integer,
  ADD COLUMN is_default     boolean NOT NULL DEFAULT true,
  ADD COLUMN archived_at    timestamp(3);

UPDATE meals SET recipe_id = id;

ALTER TABLE meals
  ALTER COLUMN recipe_id SET NOT NULL,
  ADD CONSTRAINT meals_parent_meal_id_fkey
    FOREIGN KEY (parent_meal_id) REFERENCES meals(id) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX meals_recipe_id_idx ON meals (recipe_id);
CREATE INDEX meals_recipe_default_active_idx ON meals (recipe_id, archived_at, is_default);
```

- [ ] **Step 3: Apply the migration locally**

```bash
cd server && npm run db:migrate -- --name recipe_versioning
```

Expected: migration applies cleanly; Prisma generates a fresh client. Verify with `psql` or Prisma Studio that every existing `meals` row has `recipe_id = id`, `is_default = true`, `archived_at IS NULL`.

- [ ] **Step 4: Type-check the server**

```bash
cd server && npm run build
```

Expected: clean build. Existing references to `Meal` continue to work because the new columns default sensibly.

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/007_recipe_versioning/
git commit -m "feat(db): add version/variant/archive columns to meals"
```

---

## Task 2: Pure helpers in `mealVersioning.ts`

These two functions encapsulate the two non-trivial rules in the spec. Extracting them keeps `mealService.ts` simple and makes them unit-testable in the existing pure-function pattern.

**Files:**
- Create: `server/src/services/mealVersioning.ts`
- Create: `server/src/__tests__/mealVersioning.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/src/__tests__/mealVersioning.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  pickNextDefaultAfterArchive,
  resolvePlannedMealForShopping,
  type FamilyMember,
  type PlannedMealRef,
} from "../services/mealVersioning.js";

const m = (id: number, isDefault: boolean, archivedAt: Date | null, updatedAt: number): FamilyMember => ({
  id, isDefault, archivedAt, updatedAt: new Date(updatedAt),
});

describe("pickNextDefaultAfterArchive", () => {
  it("returns null when no other active members exist", () => {
    const fam = [m(1, true, null, 100)];
    expect(pickNextDefaultAfterArchive(fam, 1)).toBeNull();
  });

  it("returns null when the archived row was not the default", () => {
    const fam = [m(1, true, null, 100), m(2, false, null, 200)];
    expect(pickNextDefaultAfterArchive(fam, 2)).toBeNull();
  });

  it("picks the most-recently-updated active sibling when archiving the default", () => {
    const fam = [
      m(1, true,  null, 100),
      m(2, false, null, 300),
      m(3, false, null, 200),
    ];
    expect(pickNextDefaultAfterArchive(fam, 1)?.id).toBe(2);
  });

  it("ignores archived siblings when promoting", () => {
    const fam = [
      m(1, true,  null,            100),
      m(2, false, new Date(999),   500),
      m(3, false, null,            200),
    ];
    expect(pickNextDefaultAfterArchive(fam, 1)?.id).toBe(3);
  });
});

describe("resolvePlannedMealForShopping", () => {
  const recipeId = 7;
  const oldVersion = { id: 10, recipeId, isDefault: false, archivedAt: new Date(1) };
  const newVersion = { id: 11, recipeId, isDefault: true,  archivedAt: null };

  it("returns the row pointed at directly when status is cooked", () => {
    const ref: PlannedMealRef = { mealId: 10, status: "cooked" };
    expect(resolvePlannedMealForShopping(ref, [oldVersion, newVersion])?.id).toBe(10);
  });

  it("returns the row pointed at directly when status is skipped", () => {
    const ref: PlannedMealRef = { mealId: 10, status: "skipped" };
    expect(resolvePlannedMealForShopping(ref, [oldVersion, newVersion])?.id).toBe(10);
  });

  it("returns the row pointed at directly when status is swapped", () => {
    const ref: PlannedMealRef = { mealId: 10, status: "swapped" };
    expect(resolvePlannedMealForShopping(ref, [oldVersion, newVersion])?.id).toBe(10);
  });

  it("resolves to the family's current default when status is planned", () => {
    const ref: PlannedMealRef = { mealId: 10, status: "planned" };
    expect(resolvePlannedMealForShopping(ref, [oldVersion, newVersion])?.id).toBe(11);
  });

  it("falls back to the row pointed at when family has no active default", () => {
    const fullyArchived = { id: 11, recipeId, isDefault: false, archivedAt: new Date(2) };
    const ref: PlannedMealRef = { mealId: 10, status: "planned" };
    expect(resolvePlannedMealForShopping(ref, [oldVersion, fullyArchived])?.id).toBe(10);
  });

  it("returns null when the referenced row is unknown", () => {
    const ref: PlannedMealRef = { mealId: 99, status: "planned" };
    expect(resolvePlannedMealForShopping(ref, [oldVersion, newVersion])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests; expect failure**

```bash
cd server && npx vitest run src/__tests__/mealVersioning.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helpers**

Create `server/src/services/mealVersioning.ts`:

```typescript
export interface FamilyMember {
  id: number;
  isDefault: boolean;
  archivedAt: Date | null;
  updatedAt: Date;
}

export interface VersionRow {
  id: number;
  recipeId: number;
  isDefault: boolean;
  archivedAt: Date | null;
}

export interface PlannedMealRef {
  mealId: number;
  status: "planned" | "cooked" | "skipped" | "swapped";
}

// When archiving a row that is currently the family's default, pick the
// next-most-recently-updated active sibling to promote. Returns null if
// the archived row was not the default, or no other active members exist.
export function pickNextDefaultAfterArchive(
  family: FamilyMember[],
  archivingId: number,
): FamilyMember | null {
  const archiving = family.find((m) => m.id === archivingId);
  if (!archiving || !archiving.isDefault) return null;

  const candidates = family
    .filter((m) => m.id !== archivingId && m.archivedAt === null)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  return candidates[0] ?? null;
}

// Resolve which version row a PlannedMeal points at for shopping aggregation.
// Status `cooked` / `skipped` / `swapped` freeze to the referenced row;
// `planned` floats to the family's current active default. Falls back to
// the referenced row if no active default exists (entire family archived).
export function resolvePlannedMealForShopping(
  ref: PlannedMealRef,
  allRows: VersionRow[],
): VersionRow | null {
  const referenced = allRows.find((r) => r.id === ref.mealId);
  if (!referenced) return null;

  if (ref.status !== "planned") return referenced;

  const currentDefault = allRows.find(
    (r) => r.recipeId === referenced.recipeId && r.isDefault && r.archivedAt === null,
  );
  return currentDefault ?? referenced;
}
```

- [ ] **Step 4: Run the tests; expect pass**

```bash
cd server && npx vitest run src/__tests__/mealVersioning.test.ts
```

Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/mealVersioning.ts server/src/__tests__/mealVersioning.test.ts
git commit -m "feat(meals): pure helpers for default-promotion and planned-meal resolution"
```

---

## Task 3: List filter + `recipeId` self-set on create + variant count

The Recipes list switches to "default + active per family." `createMeal` self-sets `recipe_id = id` post-insert so new families get a stable family identifier without a separate sequence.

**Files:**
- Modify: `server/src/services/mealService.ts`

- [ ] **Step 1: Add the active-default filter and variant count to `getAllMeals`**

In `server/src/services/mealService.ts`, replace `getAllMeals`:

```typescript
export async function getAllMeals() {
  const rows = await prisma.meal.findMany({
    where: { isDefault: true, archivedAt: null },
    include: mealWithIngredients,
    orderBy: { name: "asc" },
  });

  // Annotate each row with a count of *active* variants in its family.
  const recipeIds = rows.map((r) => r.recipeId);
  const variantCounts = await prisma.meal.groupBy({
    by: ["recipeId"],
    where: { recipeId: { in: recipeIds }, archivedAt: null },
    _count: { _all: true },
  });
  const countByRecipe = new Map(variantCounts.map((g) => [g.recipeId, g._count._all]));

  return rows.map((r) => ({ ...r, variantCount: countByRecipe.get(r.recipeId) ?? 1 }));
}
```

- [ ] **Step 2: Make `createMeal` self-set `recipe_id = id`**

In the same file, replace `createMeal`:

```typescript
export async function createMeal(data: CreateMealInput) {
  const { ingredients, instructions, canBatch, canFresh, ...rest } = data;
  const capability = resolveCapabilityWrite({ canBatch, canFresh }, null)!;

  return prisma.$transaction(async (tx) => {
    const created = await tx.meal.create({
      data: {
        ...rest,
        ...capability,
        instructions: JSON.stringify(instructions),
        recipeId: 0, // overwritten below; non-null required.
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

    return tx.meal.update({
      where: { id: created.id },
      data: { recipeId: created.id },
      include: mealWithIngredients,
    });
  });
}
```

- [ ] **Step 3: Type-check + run existing meal-related tests**

```bash
cd server && npm run build && npx vitest run src/__tests__/mealService.test.ts
```

Expected: clean build; existing `resolveCapabilityWrite` tests still pass.

- [ ] **Step 4: Smoke-test `getAllMeals` against local DB**

Restart the dev server and hit:

```bash
curl -s http://localhost:3001/api/meals | head -c 500
```

Expected: each returned row includes `variantCount: 1` (since every backfilled meal is its own family). No archived rows in the response.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/mealService.ts
git commit -m "feat(meals): filter list to active default variants + self-set recipeId on create"
```

---

## Task 4: Asset-copy helper + `getFamily`

Both helpers are needed by upcoming version/variant tasks. Pull them out first so the next tasks stay tight.

**Files:**
- Modify: `server/src/services/mealService.ts`
- Modify: `server/src/routes/meals.ts`

- [ ] **Step 1: Add `copyMealAssets` helper to `mealService.ts`**

Append to `server/src/services/mealService.ts`:

```typescript
import { stat } from "fs/promises";

// Copies the photo + PDF (whichever exist) from src to dst. Used when
// creating a new version or variant so the new row has its own self-contained
// storage directory matching the rest of the codebase.
export async function copyMealAssets(srcId: number, dstId: number): Promise<{
  imagePath: string | null;
  imageSource: string | null;
  pdfPath: string | null;
}> {
  const src = await prisma.meal.findUniqueOrThrow({
    where: { id: srcId },
    select: { imagePath: true, imageSource: true, pdfPath: true },
  });

  await ensureMealDir(dstId);
  const out: { imagePath: string | null; imageSource: string | null; pdfPath: string | null } = {
    imagePath: null, imageSource: null, pdfPath: null,
  };

  if (src.imagePath) {
    const srcAbs = path.resolve(process.cwd(), src.imagePath);
    if (await fileExists(srcAbs)) {
      const dstAbs = mealThumbPath(dstId);
      await copyFile(srcAbs, dstAbs);
      out.imagePath = relStoragePath(dstAbs);
      out.imageSource = src.imageSource;
    }
  }

  if (src.pdfPath) {
    const srcAbs = path.resolve(process.cwd(), src.pdfPath);
    if (await fileExists(srcAbs)) {
      const dstAbs = mealPdfPath(dstId);
      await copyFile(srcAbs, dstAbs);
      out.pdfPath = relStoragePath(dstAbs);
    }
  }

  return out;
}

async function fileExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}
```

- [ ] **Step 2: Add `getFamily` service**

Append to `server/src/services/mealService.ts`:

```typescript
// Returns the active variants of the family containing the given meal id,
// ordered with the default first then by name. The argument may be any row
// in the family; the server resolves to its recipe_id.
export async function getFamily(anyMemberId: number) {
  const member = await prisma.meal.findUnique({
    where: { id: anyMemberId },
    select: { recipeId: true },
  });
  if (!member) return [];

  return prisma.meal.findMany({
    where: { recipeId: member.recipeId, archivedAt: null },
    include: mealWithIngredients,
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}
```

- [ ] **Step 3: Wire up the family route**

In `server/src/routes/meals.ts`, add (above `export default router;`):

```typescript
router.get("/:id/family", async (req, res) => {
  const family = await mealService.getFamily(Number(req.params.id));
  res.json(family);
});
```

- [ ] **Step 4: Type-check + manual smoke**

```bash
cd server && npm run build
```

Then with the dev server running, pick a known meal id and hit:

```bash
curl -s http://localhost:3001/api/meals/1/family | head -c 500
```

Expected: returns `[meal-1]` (a single-row family at this stage).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/mealService.ts server/src/routes/meals.ts
git commit -m "feat(meals): asset-copy helper + getFamily service and route"
```

---

## Task 5: `supersedeMeal` — "Save as new version"

**Files:**
- Modify: `server/src/services/mealService.ts`
- Modify: `server/src/routes/meals.ts`

- [ ] **Step 1: Add `supersedeMeal` to `mealService.ts`**

```typescript
export async function supersedeMeal(sourceId: number, data: Partial<CreateMealInput>) {
  const source = await prisma.meal.findUniqueOrThrow({
    where: { id: sourceId },
    include: mealWithIngredients,
  });

  const { ingredients, instructions, canBatch, canFresh, ...rest } = data;
  const capability = resolveCapabilityWrite(
    { canBatch, canFresh },
    { canBatch: source.canBatch, canFresh: source.canFresh },
  ) ?? { canBatch: source.canBatch, canFresh: source.canFresh };

  const created = await prisma.$transaction(async (tx) => {
    // Insert the new version, default=true, parent=source, version+1.
    const inserted = await tx.meal.create({
      data: {
        // start from the source's content, then overlay the patch
        name:         data.name         ?? source.name,
        description:  data.description  ?? source.description,
        source:       source.source,
        sourceUrl:    data.sourceUrl    ?? source.sourceUrl,
        servings:     data.servings     ?? source.servings,
        prepTime:     data.prepTime     ?? source.prepTime,
        cookTime:     data.cookTime     ?? source.cookTime,
        tags:         data.tags         ?? source.tags,
        instructions: JSON.stringify(instructions ?? JSON.parse(source.instructions as string)),
        calories:     data.calories     ?? source.calories,
        proteinG:     data.proteinG     ?? source.proteinG,
        carbsG:       data.carbsG       ?? source.carbsG,
        fatG:         data.fatG         ?? source.fatG,
        fiberG:       data.fiberG       ?? source.fiberG,
        sodiumMg:     data.sodiumMg     ?? source.sodiumMg,
        ...capability,
        recipeId:      source.recipeId,
        versionNumber: source.versionNumber + 1,
        parentMealId:  source.id,
        isDefault:     true,
        ingredients: {
          create: (ingredients ?? source.ingredients.map((mi) => ({
            ingredientId: mi.ingredientId,
            quantity:     mi.quantity,
            unit:         mi.unit,
            preparation:  mi.preparation ?? undefined,
          }))).map((ing) => ({
            ingredientId: ing.ingredientId,
            quantity:     ing.quantity,
            unit:         ing.unit,
            preparation:  ing.preparation,
          })),
        },
      },
    });

    // Demote + archive the previous default in the same transaction.
    await tx.meal.update({
      where: { id: source.id },
      data: { isDefault: false, archivedAt: new Date() },
    });

    return inserted;
  });

  // Copy assets after the transaction commits — file IO outside the txn.
  const assetUpdate = await copyMealAssets(sourceId, created.id);
  return prisma.meal.update({
    where: { id: created.id },
    data: assetUpdate,
    include: mealWithIngredients,
  });
}
```

- [ ] **Step 2: Wire the route**

In `server/src/routes/meals.ts`:

```typescript
router.post("/:id/version", async (req, res) => {
  try {
    const meal = await mealService.supersedeMeal(Number(req.params.id), req.body);
    res.status(201).json(meal);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 3: Type-check + smoke test the round-trip**

```bash
cd server && npm run build
```

With the dev server running, pick a meal id and supersede with a name change:

```bash
curl -s -X POST http://localhost:3001/api/meals/1/version \
  -H "Content-Type: application/json" \
  -d '{"name":"Test v2"}' | head -c 500
```

Expected:
- Response is the new meal row with `versionNumber: 2`, `isDefault: true`, `parentMealId: 1`, same `recipeId`.
- The original (id 1) is now `isDefault: false`, `archivedAt: <timestamp>` — verify with a second curl: `curl -s http://localhost:3001/api/meals/1 | head -c 400`.
- `GET /api/meals` no longer returns id 1; it returns the new version.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/mealService.ts server/src/routes/meals.ts
git commit -m "feat(meals): supersedeMeal service + POST /meals/:id/version route"
```

---

## Task 6: `createVariant` — "Save as variant"

**Files:**
- Modify: `server/src/services/mealService.ts`
- Modify: `server/src/routes/meals.ts`

- [ ] **Step 1: Add `createVariant` to `mealService.ts`**

```typescript
export async function createVariant(sourceId: number, data: Partial<CreateMealInput>) {
  const source = await prisma.meal.findUniqueOrThrow({
    where: { id: sourceId },
    include: mealWithIngredients,
  });

  const { ingredients, instructions, canBatch, canFresh, ...rest } = data;
  const capability = resolveCapabilityWrite(
    { canBatch, canFresh },
    { canBatch: source.canBatch, canFresh: source.canFresh },
  ) ?? { canBatch: source.canBatch, canFresh: source.canFresh };

  const created = await prisma.meal.create({
    data: {
      name:         data.name         ?? source.name,
      description:  data.description  ?? source.description,
      source:       source.source,
      sourceUrl:    data.sourceUrl    ?? source.sourceUrl,
      servings:     data.servings     ?? source.servings,
      prepTime:     data.prepTime     ?? source.prepTime,
      cookTime:     data.cookTime     ?? source.cookTime,
      tags:         data.tags         ?? source.tags,
      instructions: JSON.stringify(instructions ?? JSON.parse(source.instructions as string)),
      calories:     data.calories     ?? source.calories,
      proteinG:     data.proteinG     ?? source.proteinG,
      carbsG:       data.carbsG       ?? source.carbsG,
      fatG:         data.fatG         ?? source.fatG,
      fiberG:       data.fiberG       ?? source.fiberG,
      sodiumMg:     data.sodiumMg     ?? source.sodiumMg,
      ...capability,
      recipeId:      source.recipeId,
      versionNumber: 1,
      parentMealId:  null,
      isDefault:     false,
      ingredients: {
        create: (ingredients ?? source.ingredients.map((mi) => ({
          ingredientId: mi.ingredientId,
          quantity:     mi.quantity,
          unit:         mi.unit,
          preparation:  mi.preparation ?? undefined,
        }))).map((ing) => ({
          ingredientId: ing.ingredientId,
          quantity:     ing.quantity,
          unit:         ing.unit,
          preparation:  ing.preparation,
        })),
      },
    },
  });

  const assetUpdate = await copyMealAssets(sourceId, created.id);
  return prisma.meal.update({
    where: { id: created.id },
    data: assetUpdate,
    include: mealWithIngredients,
  });
}
```

- [ ] **Step 2: Wire the route**

```typescript
router.post("/:id/variant", async (req, res) => {
  try {
    const meal = await mealService.createVariant(Number(req.params.id), req.body);
    res.status(201).json(meal);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 3: Smoke test**

```bash
cd server && npm run build
```

Pick the v2 meal id from Task 5 and create a variant:

```bash
curl -s -X POST http://localhost:3001/api/meals/<v2-id>/variant \
  -H "Content-Type: application/json" \
  -d '{"name":"Turkey variant"}' | head -c 500
```

Expected:
- New row, same `recipeId`, `versionNumber: 1`, `parentMealId: null`, `isDefault: false`.
- Default did not change (the v2 row is still default).
- `GET /api/meals/<v2-id>/family` now returns 2 rows.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/mealService.ts server/src/routes/meals.ts
git commit -m "feat(meals): createVariant service + POST /meals/:id/variant route"
```

---

## Task 7: `archiveMeal` (variant-level) with default-promotion

**Files:**
- Modify: `server/src/services/mealService.ts`
- Modify: `server/src/routes/meals.ts`

- [ ] **Step 1: Add `archiveMeal` to `mealService.ts`**

```typescript
import { pickNextDefaultAfterArchive } from "./mealVersioning.js";

export async function archiveMeal(id: number) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.meal.findUniqueOrThrow({
      where: { id },
      select: { id: true, recipeId: true, isDefault: true },
    });

    const family = await tx.meal.findMany({
      where: { recipeId: target.recipeId },
      select: { id: true, isDefault: true, archivedAt: true, updatedAt: true },
    });

    const promoteTo = pickNextDefaultAfterArchive(family, id);

    await tx.meal.update({
      where: { id },
      data: { isDefault: false, archivedAt: new Date() },
    });

    if (promoteTo) {
      await tx.meal.update({
        where: { id: promoteTo.id },
        data: { isDefault: true },
      });
    }

    return tx.meal.findUniqueOrThrow({
      where: { id },
      include: mealWithIngredients,
    });
  });
}
```

- [ ] **Step 2: Wire the route**

```typescript
router.post("/:id/archive", async (req, res) => {
  try {
    const meal = await mealService.archiveMeal(Number(req.params.id));
    res.json(meal);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 3: Smoke test default promotion**

```bash
cd server && npm run build
```

Using the family from Task 6 (one default + one variant), archive the *default*:

```bash
curl -s -X POST http://localhost:3001/api/meals/<v2-id>/archive | head -c 300
curl -s http://localhost:3001/api/meals/<variant-id> | head -c 300
```

Expected: the variant is now `isDefault: true`. The archived row's response has `isDefault: false, archivedAt: <ts>`.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/mealService.ts server/src/routes/meals.ts
git commit -m "feat(meals): archiveMeal with transactional default-promotion"
```

---

## Task 8: `archiveFamily`

**Files:**
- Modify: `server/src/services/mealService.ts`
- Modify: `server/src/routes/meals.ts`

- [ ] **Step 1: Add `archiveFamily` to `mealService.ts`**

```typescript
// Archives every active row in the family containing the given meal id.
// `id` may be any row in the family; the server resolves to its recipe_id.
export async function archiveFamily(anyMemberId: number) {
  const member = await prisma.meal.findUniqueOrThrow({
    where: { id: anyMemberId },
    select: { recipeId: true },
  });
  const result = await prisma.meal.updateMany({
    where: { recipeId: member.recipeId, archivedAt: null },
    data: { archivedAt: new Date(), isDefault: false },
  });
  return { recipeId: member.recipeId, archivedCount: result.count };
}
```

- [ ] **Step 2: Wire the route**

```typescript
router.post("/:id/archive-family", async (req, res) => {
  try {
    const result = await mealService.archiveFamily(Number(req.params.id));
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 3: Smoke**

Pick a family with ≥1 active row:

```bash
curl -s -X POST http://localhost:3001/api/meals/<id>/archive-family
curl -s http://localhost:3001/api/meals | grep -c "<recipe-name>"
```

Expected: `archivedCount` matches the count of previously-active rows; the recipe disappears from `GET /api/meals`.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/mealService.ts server/src/routes/meals.ts
git commit -m "feat(meals): archiveFamily service + route"
```

---

## Task 9: `unarchiveMeal` + `setDefault`

**Files:**
- Modify: `server/src/services/mealService.ts`
- Modify: `server/src/routes/meals.ts`

- [ ] **Step 1: Add both services**

```typescript
export async function unarchiveMeal(id: number) {
  return prisma.meal.update({
    where: { id },
    data: { archivedAt: null },
    include: mealWithIngredients,
  });
}

export async function setDefault(id: number) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.meal.findUniqueOrThrow({
      where: { id },
      select: { id: true, recipeId: true, archivedAt: true },
    });
    if (target.archivedAt !== null) {
      throw Object.assign(new Error("cannot set archived meal as default"), { status: 409 });
    }
    await tx.meal.updateMany({
      where: { recipeId: target.recipeId, isDefault: true, NOT: { id: target.id } },
      data: { isDefault: false },
    });
    return tx.meal.update({
      where: { id: target.id },
      data: { isDefault: true },
      include: mealWithIngredients,
    });
  });
}
```

- [ ] **Step 2: Wire the routes**

```typescript
router.post("/:id/unarchive", async (req, res) => {
  try {
    res.json(await mealService.unarchiveMeal(Number(req.params.id)));
  } catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});

router.post("/:id/set-default", async (req, res) => {
  try {
    res.json(await mealService.setDefault(Number(req.params.id)));
  } catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});
```

- [ ] **Step 3: Smoke**

Unarchive an archived row from earlier tasks, then make a sibling the default:

```bash
curl -s -X POST http://localhost:3001/api/meals/<archived-id>/unarchive | head -c 200
curl -s -X POST http://localhost:3001/api/meals/<sibling-id>/set-default | head -c 200
```

Expected: unarchive clears `archivedAt`. Setting default flips `isDefault` on this row and clears it on whoever was previously default in the family.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/mealService.ts server/src/routes/meals.ts
git commit -m "feat(meals): unarchiveMeal + setDefault services and routes"
```

---

## Task 10: `getArchivedMeals`

**Files:**
- Modify: `server/src/services/mealService.ts`
- Modify: `server/src/routes/meals.ts`

- [ ] **Step 1: Add `getArchivedMeals` service**

```typescript
// Returns archived rows grouped into "archived families" (families where
// every row is archived) and "archived variants" (archived rows in
// families that still have ≥1 active row).
export async function getArchivedMeals() {
  const archived = await prisma.meal.findMany({
    where: { archivedAt: { not: null } },
    include: mealWithIngredients,
    orderBy: { updatedAt: "desc" },
  });
  if (archived.length === 0) return { archivedFamilies: [], archivedVariants: [] };

  const recipeIds = [...new Set(archived.map((m) => m.recipeId))];
  const activeCounts = await prisma.meal.groupBy({
    by: ["recipeId"],
    where: { recipeId: { in: recipeIds }, archivedAt: null },
    _count: { _all: true },
  });
  const activeByRecipe = new Map(activeCounts.map((g) => [g.recipeId, g._count._all]));

  const archivedFamilies: typeof archived = [];
  const archivedVariants: typeof archived = [];

  // For families with no active rows, surface the most recently archived row
  // as the "family card" representative.
  const seenFamilies = new Set<number>();
  for (const m of archived) {
    const familyHasActive = (activeByRecipe.get(m.recipeId) ?? 0) > 0;
    if (familyHasActive) {
      archivedVariants.push(m);
    } else if (!seenFamilies.has(m.recipeId)) {
      archivedFamilies.push(m);
      seenFamilies.add(m.recipeId);
    }
  }

  return { archivedFamilies, archivedVariants };
}
```

- [ ] **Step 2: Wire the route**

In `server/src/routes/meals.ts`, add this **before** the `router.get("/:id", ...)` route — Express matches the first route, and `/:id` would otherwise swallow `/archived`:

```typescript
router.get("/archived", async (_req, res) => {
  res.json(await mealService.getArchivedMeals());
});
```

- [ ] **Step 3: Smoke**

```bash
curl -s http://localhost:3001/api/meals/archived | head -c 600
```

Expected: response shape `{ archivedFamilies: [...], archivedVariants: [...] }`. Verify ordering and grouping by hand based on the rows you've created/archived through prior tasks.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/mealService.ts server/src/routes/meals.ts
git commit -m "feat(meals): getArchivedMeals service + GET /meals/archived route"
```

---

## Task 11: Shopping list version resolution

The pure resolver was unit-tested in Task 2; this task wires it into `generateShoppingList`.

**Files:**
- Modify: `server/src/services/shoppingService.ts`

- [ ] **Step 1: Update `generateShoppingList` to resolve per status**

Replace `generateShoppingList` in `server/src/services/shoppingService.ts`:

```typescript
import { resolvePlannedMealForShopping, type VersionRow } from "./mealVersioning.js";

export async function generateShoppingList(planId: number) {
  await prisma.shoppingItem.deleteMany({ where: { planId } });

  const plannedMeals = await prisma.plannedMeal.findMany({
    where: { planId, cookStyle: { not: "leftovers" } },
    select: { id: true, mealId: true, status: true, cookStyle: true, servings: true },
  });

  // Pull every meal that's even potentially relevant to this plan: each
  // PlannedMeal's row plus every other row sharing its recipeId so the
  // resolver can pick "current default."
  const referencedIds = [...new Set(plannedMeals.map((pm) => pm.mealId))];
  const referencedMeals = await prisma.meal.findMany({
    where: { id: { in: referencedIds } },
    select: { id: true, recipeId: true },
  });
  const recipeIds = [...new Set(referencedMeals.map((m) => m.recipeId))];

  const allFamilyMeals = await prisma.meal.findMany({
    where: { recipeId: { in: recipeIds } },
    include: { ingredients: true },
  });

  const versionRows: (VersionRow & {
    servings: number;
    ingredients: { ingredientId: number; quantity: number; unit: string }[];
  })[] = allFamilyMeals.map((m) => ({
    id: m.id,
    recipeId: m.recipeId,
    isDefault: m.isDefault,
    archivedAt: m.archivedAt,
    servings: m.servings,
    ingredients: m.ingredients.map((mi) => ({
      ingredientId: mi.ingredientId,
      quantity: mi.quantity,
      unit: mi.unit,
    })),
  }));

  // Resolve each PlannedMeal to the right version per Q2 of the spec.
  const aggregateInput = plannedMeals.flatMap((pm) => {
    const resolved = resolvePlannedMealForShopping(
      { mealId: pm.mealId, status: pm.status as any },
      versionRows,
    );
    if (!resolved) return [];
    const row = versionRows.find((r) => r.id === resolved.id)!;
    return [{
      cookStyle: pm.cookStyle as any,
      servings: pm.servings,
      meal: { servings: row.servings, ingredients: row.ingredients },
    }];
  });

  // Status filter for "do this row's ingredients count?" stays as today —
  // generateShoppingList already excludes nothing here; the existing pure
  // aggregator handles `leftovers` exclusion. Status filtering for shopping
  // is unchanged: `planned` and `cooked` both contribute (cooked because
  // we want to retain "what we needed for this week" even after cook).
  // We skip `skipped` and `swapped` to match prior behavior.
  const statusFilteredInput = aggregateInput.filter((_, i) => {
    const status = plannedMeals[i].status;
    return status === "planned" || status === "cooked";
  });

  const pantryItems = await prisma.pantryItem.findMany();
  const aggregated = aggregateShoppingItems({
    plannedMeals: statusFilteredInput,
    pantryItems: pantryItems.map((p) => ({ ingredientId: p.ingredientId, quantity: p.quantity })),
  });

  await prisma.shoppingItem.createMany({
    data: aggregated.map((a) => ({
      planId,
      ingredientId:   a.ingredientId,
      quantityNeeded: a.quantityNeeded,
      quantityOnHand: a.quantityOnHand,
      quantityToBuy:  a.quantityToBuy,
    })),
  });

  return prisma.shoppingItem.findMany({
    where: { planId },
    include: { ingredient: true },
    orderBy: { ingredient: { category: "asc" } },
  });
}
```

- [ ] **Step 2: Run the existing shopping-service tests**

```bash
cd server && npx vitest run src/__tests__/shoppingService.test.ts
```

Expected: PASS — the pure aggregator is untouched, only `generateShoppingList` (which the existing tests don't cover) changed.

- [ ] **Step 3: Manual smoke after a supersede**

With a plan in your DB that includes a meal you've superseded:
1. Note the existing shopping list for the plan.
2. Supersede the recipe with a different ingredient set (Task 5 endpoint).
3. POST to whatever route triggers `generateShoppingList` for that plan (existing UI: regen button).
4. Inspect the new shopping list — it should reflect the new ingredients for `planned` cooks and old ingredients for any `cooked` rows.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/shoppingService.ts
git commit -m "feat(shopping): resolve PlannedMeal version by status"
```

---

## Task 12: Auto-planner candidate-pool filter

The auto-planner candidate pool is queried in `server/src/routes/plans.ts:64` and the chat agent's meal context in `server/src/services/chatService.ts:9`. Both need the active+default filter.

**Files:**
- Modify: `server/src/routes/plans.ts`
- Modify: `server/src/services/chatService.ts`

- [ ] **Step 1: Update the planner candidate pool**

In `server/src/routes/plans.ts`, locate the `prisma.meal.findMany` call at line ~64 and add the filter:

```typescript
const allMeals = await prisma.meal.findMany({
  where: { isDefault: true, archivedAt: null },
  // ... rest of the existing options unchanged ...
});
```

- [ ] **Step 2: Update the chat agent's meal context**

In `server/src/services/chatService.ts`, locate the `prisma.meal.findMany` at line ~9 and apply the same filter:

```typescript
const meals = await prisma.meal.findMany({
  where: { isDefault: true, archivedAt: null },
  // ... rest of the existing options unchanged ...
});
```

- [ ] **Step 3: Type-check**

```bash
cd server && npm run build
```

Expected: clean build.

- [ ] **Step 4: Smoke — generate a plan**

Trigger a plan generation through the existing UI path. Confirm that no archived recipe and no non-default variant ever appears in the suggested plan.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/plans.ts server/src/services/chatService.ts
git commit -m "feat(planner): filter candidate pool to active default variants"
```

---

## Task 13: Frontend API client

**Files:**
- Modify: `client/src/api/meals.ts`

- [ ] **Step 1: Extend the `Meal` type and add new client functions**

Replace `client/src/api/meals.ts` with:

```typescript
import { apiFetch } from "./client";

export interface Ingredient {
  id: number;
  name: string;
  category: string;
  defaultUnit: string;
}

export interface MealIngredient {
  id: number;
  quantity: number;
  unit: string;
  preparation: string | null;
  ingredient: Ingredient;
}

export interface Meal {
  id: number;
  name: string;
  description: string | null;
  source: string;
  canBatch: boolean;
  canFresh: boolean;
  servings: number;
  prepTime: number | null;
  cookTime: number | null;
  tags: string[];
  instructions: string;
  imageUrl: string | null;
  pdfPath: string | null;
  imagePath: string | null;
  imageSource: "embedded" | "rasterized" | "manual" | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
  recipeId: number;
  versionNumber: number;
  parentMealId: number | null;
  isDefault: boolean;
  archivedAt: string | null;
  variantCount?: number;
  updatedAt?: string;
  ingredients: MealIngredient[];
}

export interface ArchivedMealsResponse {
  archivedFamilies: Meal[];
  archivedVariants: Meal[];
}

export const getMeals = () => apiFetch<Meal[]>("/meals");
export const getMeal  = (id: number) => apiFetch<Meal>(`/meals/${id}`);

export const createMeal = (data: any) =>
  apiFetch<Meal>("/meals", { method: "POST", body: JSON.stringify(data) });
export const updateMeal = (id: number, data: any) =>
  apiFetch<Meal>(`/meals/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteMeal = (id: number) =>
  apiFetch<void>(`/meals/${id}`, { method: "DELETE" });

export const supersedeMeal = (id: number, data: any) =>
  apiFetch<Meal>(`/meals/${id}/version`, { method: "POST", body: JSON.stringify(data) });
export const createVariant = (id: number, data: any) =>
  apiFetch<Meal>(`/meals/${id}/variant`, { method: "POST", body: JSON.stringify(data) });

export const archiveMeal = (id: number) =>
  apiFetch<Meal>(`/meals/${id}/archive`, { method: "POST" });
export const archiveFamily = (id: number) =>
  apiFetch<{ recipeId: number; archivedCount: number }>(
    `/meals/${id}/archive-family`, { method: "POST" });
export const unarchiveMeal = (id: number) =>
  apiFetch<Meal>(`/meals/${id}/unarchive`, { method: "POST" });
export const setDefaultMeal = (id: number) =>
  apiFetch<Meal>(`/meals/${id}/set-default`, { method: "POST" });

export const getMealFamily = (id: number) => apiFetch<Meal[]>(`/meals/${id}/family`);
export const getArchivedMeals = () => apiFetch<ArchivedMealsResponse>(`/meals/archived`);

export interface ImportRecipeResult {
  parsed: any;
  ingredientMap: Record<string, number>;
  importSessionId: string;
}

export async function importRecipe(file: File): Promise<ImportRecipeResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/meals/import", { method: "POST", body: form });
  if (!res.ok) throw new Error("Import failed");
  return res.json();
}

export async function uploadMealPhoto(id: number, file: File): Promise<Meal> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/meals/${id}/photo`, { method: "POST", body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "upload failed");
  return res.json();
}

export async function uploadMealPdf(id: number, file: File): Promise<Meal> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/meals/${id}/pdf`, { method: "POST", body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "upload failed");
  return res.json();
}

export async function extractMealThumbnail(id: number, force = false): Promise<Meal> {
  const q = force ? "?force=true" : "";
  const res = await fetch(`/api/meals/${id}/extract-thumbnail${q}`, { method: "POST" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "extraction failed");
  return res.json();
}
```

Also add the `getIngredients` export used by the new ingredient editor:

```typescript
export const getIngredients = () => apiFetch<Ingredient[]>("/ingredients");
```

- [ ] **Step 2: Type-check the client**

```bash
cd client && npx tsc --noEmit
```

Expected: clean. Existing call sites still type-check; new types compile.

- [ ] **Step 3: Commit**

```bash
git add client/src/api/meals.ts
git commit -m "feat(client): API client for versioning, variant, archive endpoints"
```

---

## Task 14: `IngredientEditor` component

The current `MealForm` displays ingredients read-only. We need an editable component that supports search-typeahead from the existing pool plus a "Create new ingredient" path.

**Files:**
- Create: `client/src/components/IngredientEditor.tsx`

- [ ] **Step 1: Create the component**

Create `client/src/components/IngredientEditor.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Plus, X, Search } from "lucide-react";
import { getIngredients, type Ingredient } from "../api/meals";

export interface DraftIngredient {
  ingredientId?: number;
  name: string;
  quantity: number;
  unit: string;
  preparation?: string;
  category?: string;
}

interface Props {
  value: DraftIngredient[];
  onChange: (next: DraftIngredient[]) => void;
}

const FIELD =
  "rounded-[10px] border border-line bg-surface-2 px-3 py-2 text-[13.5px] text-ink-1 outline-none focus:border-accent focus:bg-surface-1 transition";

export default function IngredientEditor({ value, onChange }: Props) {
  const [pool, setPool] = useState<Ingredient[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => { getIngredients().then(setPool).catch(() => setPool([])); }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return pool.slice(0, 12);
    return pool.filter((p) => p.name.toLowerCase().includes(s)).slice(0, 12);
  }, [pool, search]);

  const updateRow = (idx: number, patch: Partial<DraftIngredient>) => {
    const next = value.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const removeRow = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const addExisting = (ing: Ingredient) => {
    onChange([
      ...value,
      { ingredientId: ing.id, name: ing.name, quantity: 1, unit: ing.defaultUnit, category: ing.category },
    ]);
    setPickerOpen(false);
    setSearch("");
  };

  const addNew = () => {
    const name = search.trim();
    if (!name) return;
    onChange([
      ...value,
      { name, quantity: 1, unit: "count" },
    ]);
    setPickerOpen(false);
    setSearch("");
  };

  return (
    <div className="flex flex-col gap-2">
      {value.map((row, i) => (
        <div key={i} className="grid grid-cols-[80px_80px_1fr_140px_28px] gap-2 items-center">
          <input
            type="number"
            value={row.quantity}
            onChange={(e) => updateRow(i, { quantity: Number(e.target.value) })}
            className={`${FIELD} tabular-nums`}
            min={0}
            step="0.01"
          />
          <input
            value={row.unit}
            onChange={(e) => updateRow(i, { unit: e.target.value })}
            className={FIELD}
            placeholder="unit"
          />
          <input
            value={row.name}
            onChange={(e) => updateRow(i, { name: e.target.value })}
            className={FIELD}
            placeholder="ingredient name"
          />
          <input
            value={row.preparation ?? ""}
            onChange={(e) => updateRow(i, { preparation: e.target.value || undefined })}
            className={FIELD}
            placeholder="prep (optional)"
          />
          <button
            type="button"
            onClick={() => removeRow(i)}
            className="text-ink-3 hover:text-danger w-7 h-7 grid place-items-center"
            aria-label="Remove ingredient"
          >
            <X size={14} />
          </button>
        </div>
      ))}

      {pickerOpen ? (
        <div className="bg-surface-1 border border-line rounded-[12px] p-3">
          <div className="flex items-center gap-2 mb-2">
            <Search size={14} className="text-ink-3" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ingredients…"
              className={`${FIELD} flex-1`}
            />
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => addExisting(p)}
                className="text-[12px] px-3 py-[5px] rounded-full bg-surface-2 border border-line hover:border-accent-line"
              >
                {p.name}
              </button>
            ))}
          </div>
          {search.trim() && !pool.some((p) => p.name.toLowerCase() === search.trim().toLowerCase()) && (
            <button
              type="button"
              onClick={addNew}
              className="text-[12.5px] text-accent-ink hover:underline"
            >
              + Create new ingredient: <strong>{search.trim()}</strong>
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="self-start inline-flex items-center gap-1.5 text-[13px] text-accent-ink font-medium hover:underline"
        >
          <Plus size={14} /> Add ingredient
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd client && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/IngredientEditor.tsx
git commit -m "feat(client): IngredientEditor component for manual ingredient editing"
```

---

## Task 15: Extend `MealForm` to use the ingredient editor and emit dirty state

The existing `MealForm` is read-only on ingredients and doesn't track diff vs. initial. The new editor and the three save buttons both need richer behavior.

**Files:**
- Modify: `client/src/components/MealForm.tsx`

- [ ] **Step 1: Replace `MealForm.tsx`**

Replace the entire file with:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import IngredientEditor, { type DraftIngredient } from "./IngredientEditor";

export interface MealFormData {
  name: string;
  description: string | null;
  canBatch: boolean;
  canFresh: boolean;
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
  ingredients: DraftIngredient[];
  sourceUrl?: string | null;
}

interface Props {
  initialData?: Partial<MealFormData>;
  onChange?: (data: MealFormData, dirty: boolean) => void;
  formId?: string;
  onSubmit?: (data: MealFormData) => void;
}

const FIELD =
  "w-full rounded-[10px] border border-line bg-surface-2 px-3 py-2 text-[13.5px] text-ink-1 outline-none focus:border-accent focus:bg-surface-1 transition";
const LABEL = "text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold mb-1.5 block";

const EMPTY: MealFormData = {
  name: "", description: null, canBatch: false, canFresh: true,
  servings: 2, prepTime: null, cookTime: null, tags: [], instructions: [],
  calories: null, proteinG: null, carbsG: null, fatG: null, fiberG: null, sodiumMg: null,
  ingredients: [], sourceUrl: null,
};

export default function MealForm({ initialData, onChange, formId, onSubmit }: Props) {
  const [form, setForm] = useState<MealFormData>(() => ({ ...EMPTY, ...(initialData ?? {}) }));
  const initialRef = useRef<MealFormData>(form);

  // If parent swaps initialData (e.g., after async load), reset.
  useEffect(() => {
    if (!initialData) return;
    const next = { ...EMPTY, ...initialData };
    initialRef.current = next;
    setForm(next);
  }, [initialData]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initialRef.current), [form]);

  useEffect(() => { onChange?.(form, dirty); }, [form, dirty, onChange]);

  const update = (patch: Partial<MealFormData>) => setForm((prev) => ({ ...prev, ...patch }));

  return (
    <form
      id={formId}
      onSubmit={(e) => { e.preventDefault(); onSubmit?.(form); }}
      className="flex flex-col gap-4"
    >
      <div>
        <label className={LABEL}>Name</label>
        <input value={form.name} onChange={(e) => update({ name: e.target.value })} className={FIELD} required />
      </div>
      <div>
        <label className={LABEL}>Description</label>
        <textarea value={form.description ?? ""} onChange={(e) => update({ description: e.target.value || null })} className={FIELD} rows={2} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Cook Styles</label>
          <div className="flex flex-col gap-1.5 pt-1">
            <label className="inline-flex items-center gap-2 text-[13.5px] text-ink-1">
              <input type="checkbox" checked={form.canFresh} onChange={(e) => update({ canFresh: e.target.checked })} />
              Cook Fresh
            </label>
            <label className="inline-flex items-center gap-2 text-[13.5px] text-ink-1">
              <input type="checkbox" checked={form.canBatch} onChange={(e) => update({ canBatch: e.target.checked })} />
              Batch Prep
            </label>
          </div>
        </div>
        <div>
          <label className={LABEL}>Servings</label>
          <input type="number" value={form.servings} onChange={(e) => update({ servings: Number(e.target.value) })} className={`${FIELD} tabular-nums`} min={1} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Prep Time (min)</label>
          <input type="number" value={form.prepTime ?? ""} onChange={(e) => update({ prepTime: e.target.value ? Number(e.target.value) : null })} className={`${FIELD} tabular-nums`} />
        </div>
        <div>
          <label className={LABEL}>Cook Time (min)</label>
          <input type="number" value={form.cookTime ?? ""} onChange={(e) => update({ cookTime: e.target.value ? Number(e.target.value) : null })} className={`${FIELD} tabular-nums`} />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div><label className={LABEL}>Calories</label>
          <input type="number" value={form.calories ?? ""} onChange={(e) => update({ calories: e.target.value ? Number(e.target.value) : null })} className={`${FIELD} tabular-nums`} />
        </div>
        <div><label className={LABEL}>Protein (g)</label>
          <input type="number" value={form.proteinG ?? ""} onChange={(e) => update({ proteinG: e.target.value ? Number(e.target.value) : null })} className={`${FIELD} tabular-nums`} />
        </div>
        <div><label className={LABEL}>Carbs (g)</label>
          <input type="number" value={form.carbsG ?? ""} onChange={(e) => update({ carbsG: e.target.value ? Number(e.target.value) : null })} className={`${FIELD} tabular-nums`} />
        </div>
        <div><label className={LABEL}>Fat (g)</label>
          <input type="number" value={form.fatG ?? ""} onChange={(e) => update({ fatG: e.target.value ? Number(e.target.value) : null })} className={`${FIELD} tabular-nums`} />
        </div>
      </div>
      <div>
        <label className={LABEL}>Tags (comma-separated)</label>
        <input
          value={form.tags.join(", ")}
          onChange={(e) => update({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
          className={FIELD}
        />
      </div>
      <div>
        <label className={LABEL}>Ingredients · {form.ingredients.length}</label>
        <IngredientEditor value={form.ingredients} onChange={(next) => update({ ingredients: next })} />
      </div>
      <div>
        <label className={LABEL}>Instructions (one per line)</label>
        <textarea
          value={form.instructions.join("\n")}
          onChange={(e) => update({ instructions: e.target.value.split("\n").filter(Boolean) })}
          className={FIELD}
          rows={6}
        />
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Update `RecipeImport.tsx` to match the new MealForm signature**

In `client/src/pages/RecipeImport.tsx`, the existing `MealForm` no longer supports `submitLabel` directly and no longer hosts its own submit button. Replace the relevant block:

```tsx
{stage === "review" && parsed && (
  <div className="flex flex-col gap-4 amp-fade-in">
    <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] bg-accent-soft border border-accent-line text-accent-ink text-[13px]">
      <CheckCircle2 size={15} />
      Parsed successfully. Review and save to your library.
    </div>
    <div className="bg-surface-1 border border-line rounded-[14px] p-5">
      <MealForm
        formId="import-form"
        initialData={parsed}
        onSubmit={handleSave}
      />
      <div className="flex gap-2 mt-4 flex-wrap">
        <Button type="submit" form="import-form" variant="primary" icon={Check}>
          Save to Library
        </Button>
        <Button variant="ghost" onClick={() => setStage("upload")}>
          Start over
        </Button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 3: Type-check + smoke the import flow**

```bash
cd client && npx tsc --noEmit
```

Then run the dev server and walk an import end-to-end. Expected: import → review → save still works; ingredients now show editable rows.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/MealForm.tsx client/src/pages/RecipeImport.tsx
git commit -m "feat(client): MealForm with editable ingredients + dirty tracking + external submit"
```

---

## Task 16: `RecipeEditor` page

Single editor page used by `/recipes/new`, `/recipes/:id/edit`, `/recipes/:id/variant`. Routes are wired in the next task.

**Files:**
- Create: `client/src/pages/RecipeEditor.tsx`

- [ ] **Step 1: Create the page**

Create `client/src/pages/RecipeEditor.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Save, GitBranch, GitCommit } from "lucide-react";
import {
  getMeal, getIngredients, createMeal, updateMeal, supersedeMeal, createVariant, type Meal,
} from "../api/meals";
import { apiFetch } from "../api/client";
import MealForm, { type MealFormData } from "../components/MealForm";
import Button from "../components/ui/Button";

type Mode = "new" | "edit" | "variant";

interface Props { mode: Mode; }

function instructionsArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try { const j = JSON.parse(raw); if (Array.isArray(j)) return j.map(String); } catch {}
    return raw.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function mealToForm(m: Meal): Partial<MealFormData> {
  return {
    name: m.name,
    description: m.description,
    canBatch: m.canBatch,
    canFresh: m.canFresh,
    servings: m.servings,
    prepTime: m.prepTime,
    cookTime: m.cookTime,
    tags: m.tags,
    instructions: instructionsArray(m.instructions),
    calories: m.calories,
    proteinG: m.proteinG,
    carbsG:   m.carbsG,
    fatG:     m.fatG,
    fiberG:   m.fiberG,
    sodiumMg: m.sodiumMg,
    ingredients: m.ingredients.map((mi) => ({
      ingredientId: mi.ingredient.id,
      name:         mi.ingredient.name,
      quantity:     mi.quantity,
      unit:         mi.unit,
      preparation:  mi.preparation ?? undefined,
      category:     mi.ingredient.category,
    })),
  };
}

// Server expects ingredients as { ingredientId, quantity, unit, preparation }.
// Rows from IngredientEditor that the user typed-in fresh have no id —
// POST to /ingredients to mint one. POST returns 409 if the name already
// exists (race against typeahead pool); on 409, refetch the pool and look
// up by name.
async function ensureIngredientIds(rows: MealFormData["ingredients"]) {
  const out: { ingredientId: number; quantity: number; unit: string; preparation?: string }[] = [];
  for (const r of rows) {
    let id = r.ingredientId;
    if (!id) {
      try {
        const created = await apiFetch<{ id: number }>("/ingredients", {
          method: "POST",
          body: JSON.stringify({ name: r.name, category: r.category ?? "other", defaultUnit: r.unit }),
        });
        id = created.id;
      } catch (e: any) {
        // Resolve the race: the ingredient already exists, find it by name.
        const all = await getIngredients();
        const found = all.find((i) => i.name.toLowerCase() === r.name.toLowerCase());
        if (!found) throw e;
        id = found.id;
      }
    }
    out.push({ ingredientId: id, quantity: r.quantity, unit: r.unit, preparation: r.preparation });
  }
  return out;
}

export default function RecipeEditor({ mode }: Props) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [source, setSource] = useState<Meal | null>(null);
  const [data, setData] = useState<MealFormData | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "version" | "variant">(null);

  useEffect(() => {
    if (mode === "new") return;
    if (!id) return;
    getMeal(Number(id)).then(setSource).catch(() => setSource(null));
  }, [mode, id]);

  const initialData = useMemo<Partial<MealFormData> | undefined>(() => {
    if (mode === "new") return undefined;
    if (!source) return undefined;
    return mealToForm(source);
  }, [mode, source]);

  const onChange = (next: MealFormData, isDirty: boolean) => {
    setData(next);
    setDirty(isDirty);
  };

  const titleByMode: Record<Mode, string> = {
    new:     "New recipe",
    edit:    source ? `Edit · ${source.name}` : "Edit recipe",
    variant: source ? `New variant of · ${source.name}` : "New variant",
  };

  const submit = async (which: NonNullable<typeof busy>) => {
    if (!data) return;
    setBusy(which);
    try {
      const ingredients = await ensureIngredientIds(data.ingredients);
      const payload = { ...data, ingredients };
      let result: Meal;
      if (which === "save" && mode === "new") {
        result = await createMeal(payload);
      } else if (which === "save" && mode === "edit") {
        result = await updateMeal(Number(id), payload);
      } else if (which === "version") {
        result = await supersedeMeal(Number(id), payload);
      } else if (which === "variant") {
        result = await createVariant(Number(id), payload);
      } else {
        return;
      }
      navigate(`/recipes/${result.id}`);
    } catch (e: any) {
      alert(e.message ?? "Save failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5 max-w-[760px]">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink-1">
          <ChevronLeft size={14} /> Back
        </button>
      </div>
      <h1 className="text-[26px] font-semibold -tracking-[0.02em] text-ink-1">{titleByMode[mode]}</h1>

      {mode !== "new" && !source ? (
        <div className="text-ink-3 text-[14px]">Loading recipe…</div>
      ) : (
        <div className="bg-surface-1 border border-line rounded-[14px] p-5">
          <MealForm
            formId="recipe-editor-form"
            initialData={initialData}
            onChange={onChange}
          />
          <div className="flex gap-2 mt-5 flex-wrap">
            {mode === "new" && (
              <Button variant="primary" icon={Save} onClick={() => submit("save")} disabled={!dirty || busy !== null}>
                {busy === "save" ? "Saving…" : "Save"}
              </Button>
            )}
            {mode === "edit" && (
              <>
                <Button variant="primary" icon={Save} onClick={() => submit("save")} disabled={!dirty || busy !== null}>
                  {busy === "save" ? "Saving…" : "Save"}
                </Button>
                <Button variant="ghost" icon={GitCommit} onClick={() => submit("version")} disabled={!dirty || busy !== null}>
                  {busy === "version" ? "Saving…" : "Save as new version"}
                </Button>
                <Button variant="ghost" icon={GitBranch} onClick={() => submit("variant")} disabled={!dirty || busy !== null}>
                  {busy === "variant" ? "Saving…" : "Save as variant"}
                </Button>
              </>
            )}
            {mode === "variant" && (
              <Button variant="primary" icon={GitBranch} onClick={() => submit("variant")} disabled={!dirty || busy !== null}>
                {busy === "variant" ? "Saving…" : "Save as variant"}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd client && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/RecipeEditor.tsx
git commit -m "feat(client): RecipeEditor page with three save modes"
```

---

## Task 17: Wire up routes + entry buttons

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/pages/Recipes.tsx`
- Modify: `client/src/pages/RecipeDetail.tsx`

- [ ] **Step 1: Register routes in `App.tsx`**

```tsx
import RecipeEditor from "./pages/RecipeEditor";
// ... inside <Route element={<Layout />}> ...
<Route path="/recipes/new"            element={<RecipeEditor mode="new" />} />
<Route path="/recipes/:id/edit"       element={<RecipeEditor mode="edit" />} />
<Route path="/recipes/:id/variant"    element={<RecipeEditor mode="variant" />} />
```

Order: register `/recipes/new` **before** `/recipes/:id` and `/recipes/import` so the literal segment matches first. Same for `/edit` and `/variant` — they're distinct enough not to clash, but keep `/recipes/:id` after them for safety.

- [ ] **Step 2: Add "+ New recipe" button to `Recipes.tsx`**

In `Recipes.tsx`, in the header where "Import recipe" lives, add a sibling button:

```tsx
import { Plus } from "lucide-react";

// in JSX, replace the existing <Button variant="primary" icon={Upload} ...> block with:
<div className="flex gap-2 flex-wrap">
  <Button variant="ghost" icon={Plus} onClick={() => navigate("/recipes/new")}>
    New recipe
  </Button>
  <Button variant="primary" icon={Upload} onClick={() => navigate("/recipes/import")}>
    Import recipe
  </Button>
</div>
```

- [ ] **Step 3: Add Edit + Create variant buttons to `RecipeDetail.tsx`**

In the existing button row near "Add to plan", add:

```tsx
import { Pencil, GitBranch } from "lucide-react";

// alongside the existing Add-to-plan + PDF buttons:
<Button variant="ghost" icon={Pencil} onClick={() => navigate(`/recipes/${meal.id}/edit`)}>
  Edit
</Button>
<Button variant="ghost" icon={GitBranch} onClick={() => navigate(`/recipes/${meal.id}/variant`)}>
  Create variant
</Button>
```

- [ ] **Step 4: Smoke the round-trip**

Start the client + server, then:

1. Click "New recipe" on Recipes — fill in name, ingredients, an instruction, save. Expect navigation to detail page with the new recipe.
2. Open an existing recipe. Click "Edit" — change a name, click "Save". Expect the in-place edit to reflect on detail.
3. Edit again — change something more substantial, click "Save as new version". Expect a new meal id, parent_meal_id pointing at the previous, the previous archived.
4. Edit again on the new version, click "Save as variant". Expect a sibling row, default unchanged.

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx client/src/pages/Recipes.tsx client/src/pages/RecipeDetail.tsx
git commit -m "feat(client): wire RecipeEditor routes + entry buttons"
```

---

## Task 18: Variant chips + overflow actions on `RecipeDetail`

**Files:**
- Modify: `client/src/pages/RecipeDetail.tsx`

- [ ] **Step 1: Fetch family + render chips**

At the top of `RecipeDetail` (above existing content), add a state hook + effect for siblings, and render the chip strip:

```tsx
import { getMealFamily, archiveMeal, archiveFamily, setDefaultMeal } from "../api/meals";

// inside RecipeDetail:
const [family, setFamily] = useState<Meal[]>([]);
useEffect(() => {
  if (!meal) return;
  getMealFamily(meal.id).then(setFamily).catch(() => setFamily([]));
}, [meal?.id]);

// In JSX, above the variant pill row (or wherever fits the design):
{family.length > 1 && (
  <div className="flex gap-1.5 flex-wrap">
    {family.map((v) => {
      const active = v.id === meal.id;
      return (
        <button
          key={v.id}
          onClick={() => navigate(`/recipes/${v.id}`)}
          className={`text-[12px] px-3 py-[5px] rounded-full font-medium border transition ${
            active ? "bg-accent text-accent-on border-accent" : "bg-surface-1 text-ink-2 border-line hover:border-accent-line"
          }`}
        >
          {v.isDefault ? "★ " : ""}{v.name}
        </button>
      );
    })}
  </div>
)}
```

- [ ] **Step 2: Replace the existing Delete button with an overflow menu**

Replace the top-right Delete button in `RecipeDetail` with a small overflow trigger that shows: Set as default, Archive variant, Archive recipe.

```tsx
import { MoreHorizontal } from "lucide-react";

// state:
const [menuOpen, setMenuOpen] = useState(false);

// in the header row (replacing the Delete button):
<div className="relative">
  <button
    onClick={() => setMenuOpen((v) => !v)}
    className="inline-flex items-center gap-1.5 text-[12px] text-ink-3 hover:text-ink-1"
  >
    <MoreHorizontal size={16} /> More
  </button>
  {menuOpen && (
    <div className="absolute right-0 top-7 z-10 bg-surface-1 border border-line rounded-[10px] shadow-[var(--shadow-card)] min-w-[200px] py-1.5">
      {!meal.isDefault && (
        <button
          onClick={async () => {
            const updated = await setDefaultMeal(meal.id);
            setMeal(updated);
            setMenuOpen(false);
            toast({ message: `Set "${updated.name}" as default variant` });
          }}
          className="w-full text-left px-3 py-2 text-[13px] hover:bg-surface-2"
        >
          Set as default
        </button>
      )}
      <button
        onClick={async () => {
          if (!window.confirm(`Archive this variant ("${meal.name}")?`)) return;
          await archiveMeal(meal.id);
          navigate("/recipes");
        }}
        className="w-full text-left px-3 py-2 text-[13px] hover:bg-surface-2"
      >
        Archive variant
      </button>
      <button
        onClick={async () => {
          if (!window.confirm(`Archive this recipe and all ${family.length} variant${family.length === 1 ? "" : "s"}?`)) return;
          await archiveFamily(meal.id);
          navigate("/recipes");
        }}
        className="w-full text-left px-3 py-2 text-[13px] text-danger hover:bg-surface-2"
      >
        Archive recipe (whole family)
      </button>
    </div>
  )}
</div>
```

Remove the top-right `<button onClick={async () => { await deleteMeal(meal.id); ... }}>` block entirely. Also remove the `Trash2` and `deleteMeal` imports if nothing else references them.

- [ ] **Step 3: Show "archived" badge if viewing an archived row**

Just below the variant chip row, render:

```tsx
{meal.archivedAt && (
  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-warn-soft border border-warn-line text-warn-ink text-[12px]">
    Archived {new Date(meal.archivedAt).toLocaleDateString()}
  </div>
)}
```

- [ ] **Step 4: Smoke**

1. Open a recipe with siblings — chips appear with star next to the default.
2. Click "Set as default" on a non-default variant — default updates.
3. Click "Archive variant" — confirm, returns to list, gone from list, default promotes if needed.
4. Open a family with one variant — "Archive recipe" archives the whole thing.
5. Visit a known-archived row directly via URL — archived badge shows.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/RecipeDetail.tsx
git commit -m "feat(client): variant chips + archive/default actions on recipe detail"
```

---

## Task 19: "N variants" pill on `MealCard`

**Files:**
- Modify: `client/src/components/MealCard.tsx`

- [ ] **Step 1: Add the pill**

In the pill row inside `MealCard`, add:

```tsx
import { GitBranch } from "lucide-react";

// inside the existing flex row that holds Batch/Fresh pills:
{(meal.variantCount ?? 1) > 1 && (
  <Pill tone="ghost" size="sm">
    <GitBranch size={11} />
    {meal.variantCount} variants
  </Pill>
)}
```

- [ ] **Step 2: Type-check + visual smoke**

```bash
cd client && npx tsc --noEmit
```

Then look at the Recipes page after creating a variant via Task 17's flow. Expected: the parent recipe's card shows "2 variants" pill.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/MealCard.tsx
git commit -m "feat(client): variant count pill on MealCard"
```

---

## Task 20: Archive page

**Files:**
- Create: `client/src/pages/RecipeArchive.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/pages/Recipes.tsx`

- [ ] **Step 1: Create the page**

Create `client/src/pages/RecipeArchive.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, RotateCcw } from "lucide-react";
import { getArchivedMeals, unarchiveMeal, type ArchivedMealsResponse, type Meal } from "../api/meals";
import Button from "../components/ui/Button";

export default function RecipeArchive() {
  const [data, setData] = useState<ArchivedMealsResponse>({ archivedFamilies: [], archivedVariants: [] });

  const reload = () => getArchivedMeals().then(setData).catch(() => setData({ archivedFamilies: [], archivedVariants: [] }));
  useEffect(() => { reload(); }, []);

  const unarchive = async (m: Meal) => {
    await unarchiveMeal(m.id);
    reload();
  };

  return (
    <div className="flex flex-col gap-6 max-w-[920px]">
      <div className="flex items-center justify-between">
        <Link to="/recipes" className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink-1">
          <ChevronLeft size={14} /> Back to recipes
        </Link>
      </div>
      <h1 className="text-[26px] font-semibold -tracking-[0.02em] text-ink-1">Archive</h1>

      <Section title="Archived recipes" empty="No fully-archived recipes." rows={data.archivedFamilies} onUnarchive={unarchive} />
      <Section title="Archived variants" empty="No archived variants." rows={data.archivedVariants} onUnarchive={unarchive} />
    </div>
  );
}

function Section({
  title, empty, rows, onUnarchive,
}: { title: string; empty: string; rows: Meal[]; onUnarchive: (m: Meal) => void }) {
  return (
    <div>
      <h2 className="text-[16px] font-semibold text-ink-1 mb-3">{title}</h2>
      {rows.length === 0 ? (
        <div className="text-[13px] text-ink-3">{empty}</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 bg-surface-1 border border-line rounded-[12px] px-4 py-3">
              <div>
                <div className="text-[14px] font-semibold text-ink-1">{m.name}</div>
                <div className="text-[12px] text-ink-3">
                  Archived {m.archivedAt ? new Date(m.archivedAt).toLocaleDateString() : "—"}
                </div>
              </div>
              <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => onUnarchive(m)}>
                Unarchive
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register the route**

In `client/src/App.tsx`, add:

```tsx
import RecipeArchive from "./pages/RecipeArchive";

// inside the layout routes, BEFORE <Route path="/recipes/:id" ...>:
<Route path="/recipes/archived" element={<RecipeArchive />} />
```

- [ ] **Step 3: Add a link from `Recipes.tsx`**

In the Recipes header area (next to the "Library · N recipes" subtitle), add:

```tsx
import { Archive } from "lucide-react";

// to the right of the search/filter row, or in the header:
<Link to="/recipes/archived" className="inline-flex items-center gap-1.5 text-[12px] text-ink-3 hover:text-ink-1">
  <Archive size={12} /> Archive
</Link>
```

(Use `import { Link } from "react-router-dom";` if not already imported.)

- [ ] **Step 4: Smoke**

Visit `/recipes/archived` — archived families and variants render. Click Unarchive — the row disappears from this page. Visit `/recipes` — the unarchived row is present (or not, if it's a non-default variant).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/RecipeArchive.tsx client/src/App.tsx client/src/pages/Recipes.tsx
git commit -m "feat(client): archive page with unarchive action"
```

---

## Task 21: "Archived" pill on past planned meals

The planner API already includes the full `meal` row on each `PlannedMeal`
(via Prisma `include: { meal: true }`), so once Task 1 adds the `archived_at`
column it appears on `pm.meal` in the response automatically. The client's
`PlannedMeal` type — defined in `client/src/api/plans.ts` — references
`Meal`, which now has `archivedAt: string | null` (Task 13).

**Files:**
- Modify: `client/src/components/PlanDayColumn.tsx`
- Verify: `client/src/api/plans.ts` — confirm `PlannedMeal.meal` is typed as
  the `Meal` from `./meals` (no edit if already correct; if it inlines a
  smaller shape, switch it to `Meal` from `./meals`).

- [ ] **Step 1: Add the pill in `PlanDayColumn.tsx`**

Locate the line that renders the meal name (currently
`<p className="font-medium text-gray-900">{pm.meal.name}</p>`) and replace
it with:

```tsx
<p className="font-medium text-gray-900 inline-flex items-center gap-1.5">
  {pm.meal.name}
  {pm.meal.archivedAt && (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-warn-soft text-warn-ink text-[10px] font-medium">
      archived
    </span>
  )}
</p>
```

- [ ] **Step 2: If `client/src/api/plans.ts` inlines its own meal shape, swap it to use the shared `Meal` type**

Open `client/src/api/plans.ts`. If `PlannedMeal.meal` is typed as a local
inline interface, replace that field with:

```typescript
import type { Meal } from "./meals";

export interface PlannedMeal {
  // ... existing fields ...
  meal: Meal;
}
```

If it's already typed as `Meal` from `./meals`, skip this step.

- [ ] **Step 3: Type-check**

```bash
cd client && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Smoke**

Open the planner with a week containing a meal whose family was later
archived. Expected: the meal name renders with a small "archived" pill
next to it, indicating why this meal isn't in the active recipe list.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/PlanDayColumn.tsx client/src/api/plans.ts
git commit -m "feat(client): archived indicator on planned-meal cells"
```

---

## Task 22: Final type-check + test sweep

**Files:** none (verification only).

- [ ] **Step 1: Server build + tests**

```bash
cd server && npm run build && npx vitest run
```

Expected: clean build; all tests pass (existing + new pure helper tests from Task 2).

- [ ] **Step 2: Client type-check + lint**

```bash
cd client && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: End-to-end manual walkthrough**

Walk the full user story:

1. Import a recipe via existing flow → it appears on Recipes.
2. From Recipes, click "+ New recipe" → fill the editor → Save → appears on Recipes.
3. Open the imported recipe, click Edit, change one ingredient quantity, click "Save as new version" → detail page shows the new version; old version no longer in list; navigating to the old id directly shows archived badge.
4. Edit the new version, click "Save as variant" → variant chips appear; default unchanged.
5. Click "Set as default" on the variant → default switches.
6. Plan a week containing this recipe; supersede it again; regen the shopping list; confirm new ingredients appear for `planned` cooks; cooked rows from prior weeks still reflect the old ingredients.
7. Archive an entire family from the overflow menu → it disappears from Recipes; visit `/recipes/archived` → it's listed; click Unarchive → returns to Recipes.

- [ ] **Step 4: Commit (if any housekeeping changes)**

If you only made fixes, commit them:

```bash
git add -A
git commit -m "chore: end-to-end fixups for recipe versioning"
```

Otherwise, this task is complete with no commit.

---

## Spec coverage checklist

Use this to confirm every spec section is implemented:

- [x] Schema (5 columns + indexes) — Task 1
- [x] `recipe_id` self-set on create — Task 3
- [x] `getAllMeals` filter (default+active) + variantCount — Task 3
- [x] `getMealById` unchanged behavior — implicitly preserved (no changes in Task 3 to `getMealById`)
- [x] `getFamily` + `GET /api/meals/:id/family` — Task 4
- [x] `copyMealAssets` helper — Task 4
- [x] `supersedeMeal` + `POST /api/meals/:id/version` — Task 5
- [x] `createVariant` + `POST /api/meals/:id/variant` — Task 6
- [x] `archiveMeal` + default-promotion + `POST /api/meals/:id/archive` — Task 7
- [x] `archiveFamily` + `POST /api/meals/:id/archive-family` — Task 8
- [x] `unarchiveMeal` + `POST /api/meals/:id/unarchive` — Task 9
- [x] `setDefault` + `POST /api/meals/:id/set-default` — Task 9
- [x] `getArchivedMeals` + `GET /api/meals/archived` (route order!) — Task 10
- [x] Shopping resolution per status (planned floats, others freeze) — Tasks 2 + 11
- [x] Auto-planner candidate-pool filter (plans.ts + chatService.ts) — Task 12
- [x] API client + `Meal` type extensions — Task 13
- [x] `IngredientEditor` — Task 14
- [x] `MealForm` editable ingredients + dirty + external submit — Task 15
- [x] `RecipeEditor` page + three save modes — Task 16
- [x] Routes + entry buttons (`/recipes/new`, `/recipes/:id/edit`, `/recipes/:id/variant`) — Task 17
- [x] Variant chips + overflow menu (Set default / Archive variant / Archive recipe) — Task 18
- [x] Archived badge on detail when viewing archived row — Task 18
- [x] "N variants" pill — Task 19
- [x] Archive page + Unarchive — Task 20
- [x] "Archived" pill on planner past meals — Task 21
- [x] Final verification — Task 22
