# Pantry Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Pantry from a flat status display into a managed inventory: per-batch tracking under one card per ingredient, smart unit conversions, custom items, soft-delete with undo, and active stock signals. See spec: `docs/superpowers/specs/2026-05-05-pantry-overhaul-design.md`.

**Architecture:** Additive Prisma migration on `Ingredient` and `pantry_items`. New `server/src/lib/units.ts` does all unit math; never on the client. `GET /api/pantry` returns server-aggregated cards with filters/sort/search query params. New `/api/pantry/batches` routes for batch-level writes; soft-delete via `consumedAt` with a `/restore` endpoint and a nightly purge job. UI replaces three columns with one filter-chip grid, and adds a side-panel drawer for batch detail and edits.

**Tech Stack:** Prisma + PostgreSQL, Express, Vitest (server), React 18 + Vite + TailwindCSS (client), `lucide-react`, existing `ToastProvider`. New runtime dep: `node-cron` (server).

---

## Phase 1 — Foundation: units engine and schema

### Task 1: Unit conversion engine

Pure module. No DB, no IO. All recipe deduction and card aggregation goes through this.

**Files:**
- Create: `server/src/lib/units.ts`
- Create: `server/src/__tests__/units.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/__tests__/units.test.ts
import { describe, it, expect } from "vitest";
import { convert, UnitConversionError, type DensityHint } from "../lib/units.js";

describe("convert", () => {
  it("same-unit returns the same value", () => {
    expect(convert(2, "lb", "lb")).toBe(2);
  });

  it("mass: lb -> oz", () => {
    expect(convert(1, "lb", "oz")).toBeCloseTo(16, 5);
  });

  it("mass: oz -> g", () => {
    expect(convert(1, "oz", "g")).toBeCloseTo(28.3495, 3);
  });

  it("volume: cup -> tbsp", () => {
    expect(convert(1, "cup", "tbsp")).toBeCloseTo(16, 5);
  });

  it("volume: tbsp -> tsp", () => {
    expect(convert(1, "tbsp", "tsp")).toBeCloseTo(3, 5);
  });

  it("volume: cup -> mL", () => {
    expect(convert(1, "cup", "mL")).toBeCloseTo(236.588, 2);
  });

  it("count -> count", () => {
    expect(convert(3, "count", "count")).toBe(3);
  });

  it("normalizes unit aliases (LB, lbs, fl oz)", () => {
    expect(convert(1, "LB", "oz")).toBeCloseTo(16, 5);
    expect(convert(1, "lbs", "oz")).toBeCloseTo(16, 5);
    expect(convert(8, "fl oz", "cup")).toBeCloseTo(0.9858, 3);
  });

  it("cross-type mass<->volume requires density", () => {
    const hint: DensityHint = { densityGPerMl: 0.529 }; // ~flour
    expect(convert(1, "cup", "g", hint)).toBeCloseTo(125.16, 1);
  });

  it("cross-type count<->mass requires gramsPerCount", () => {
    const hint: DensityHint = { gramsPerCount: 50 }; // egg
    expect(convert(3, "count", "g", hint)).toBeCloseTo(150, 5);
  });

  it("cross-type without density throws UnitConversionError", () => {
    expect(() => convert(1, "cup", "g")).toThrow(UnitConversionError);
  });

  it("UnitConversionError carries which field is missing", () => {
    try {
      convert(1, "cup", "g");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UnitConversionError);
      expect((e as UnitConversionError).missing).toBe("densityGPerMl");
      expect((e as UnitConversionError).fromUnit).toBe("cup");
      expect((e as UnitConversionError).toUnit).toBe("g");
    }
  });

  it("unknown unit throws UnitConversionError", () => {
    expect(() => convert(1, "blarg", "g")).toThrow(UnitConversionError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd server && npx vitest run src/__tests__/units.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the unit conversion module**

```typescript
// server/src/lib/units.ts
export type UnitType = "mass" | "volume" | "count";

export interface DensityHint {
  densityGPerMl?: number | null;
  gramsPerCount?: number | null;
}

export class UnitConversionError extends Error {
  constructor(
    public fromUnit: string,
    public toUnit: string,
    public missing: "densityGPerMl" | "gramsPerCount" | "unknownUnit",
    message?: string,
  ) {
    super(message ?? `Cannot convert ${fromUnit} to ${toUnit}: ${missing}`);
    this.name = "UnitConversionError";
  }
}

// Canonical bases: g (mass), mL (volume), count.
// Each entry: how many canonical-base units one of these units represents.
const MASS: Record<string, number> = {
  g: 1,
  kg: 1000,
  mg: 0.001,
  oz: 28.3495,
  lb: 453.592,
};

const VOLUME: Record<string, number> = {
  ml: 1,
  l: 1000,
  tsp: 4.92892,
  tbsp: 14.7868,
  fl_oz: 29.5735,
  cup: 236.588,
  pt: 473.176,
  qt: 946.353,
  gal: 3785.41,
};

const COUNT: Record<string, number> = {
  count: 1,
  ea: 1,
  unit: 1,
};

// Aliases users actually type. Lowercased, stripped of dots and spaces.
const ALIASES: Record<string, string> = {
  pound: "lb",
  pounds: "lb",
  lbs: "lb",
  ounce: "oz",
  ounces: "oz",
  ozs: "oz",
  gram: "g",
  grams: "g",
  gs: "g",
  kilogram: "kg",
  kilograms: "kg",
  kgs: "kg",
  milliliter: "ml",
  milliliters: "ml",
  liter: "l",
  liters: "l",
  ls: "l",
  teaspoon: "tsp",
  teaspoons: "tsp",
  tsps: "tsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tbsps: "tbsp",
  tbs: "tbsp",
  "fluidounce": "fl_oz",
  "flounce": "fl_oz",
  floz: "fl_oz",
  cups: "cup",
  c: "cup",
  pint: "pt",
  pints: "pt",
  quart: "qt",
  quarts: "qt",
  gallon: "gal",
  gallons: "gal",
  each: "count",
  pcs: "count",
  pieces: "count",
  piece: "count",
  ct: "count",
  units: "unit",
};

function normalize(u: string): string {
  const k = u.toLowerCase().replace(/\./g, "").replace(/\s+/g, "");
  return ALIASES[k] ?? k;
}

function classify(u: string): { type: UnitType; canonicalPerUnit: number } {
  const n = normalize(u);
  if (n in MASS) return { type: "mass", canonicalPerUnit: MASS[n] };
  if (n in VOLUME) return { type: "volume", canonicalPerUnit: VOLUME[n] };
  if (n in COUNT) return { type: "count", canonicalPerUnit: COUNT[n] };
  throw new UnitConversionError(u, u, "unknownUnit", `Unknown unit: ${u}`);
}

export function convert(
  value: number,
  fromUnit: string,
  toUnit: string,
  hint: DensityHint = {},
): number {
  if (fromUnit === toUnit) return value;
  const from = classify(fromUnit);
  const to = classify(toUnit);
  // Convert to canonical base of `from.type`.
  const canonicalFrom = value * from.canonicalPerUnit;

  if (from.type === to.type) {
    return canonicalFrom / to.canonicalPerUnit;
  }

  // Cross-type. Need to bridge through grams using density / gramsPerCount.
  let grams: number | null = null;
  if (from.type === "mass") {
    grams = canonicalFrom;
  } else if (from.type === "volume") {
    if (hint.densityGPerMl == null) {
      throw new UnitConversionError(fromUnit, toUnit, "densityGPerMl");
    }
    grams = canonicalFrom * hint.densityGPerMl;
  } else if (from.type === "count") {
    if (hint.gramsPerCount == null) {
      throw new UnitConversionError(fromUnit, toUnit, "gramsPerCount");
    }
    grams = canonicalFrom * hint.gramsPerCount;
  }

  // Now convert grams -> to.type's canonical -> toUnit.
  if (to.type === "mass") {
    return grams! / to.canonicalPerUnit;
  } else if (to.type === "volume") {
    if (hint.densityGPerMl == null) {
      throw new UnitConversionError(fromUnit, toUnit, "densityGPerMl");
    }
    const mL = grams! / hint.densityGPerMl;
    return mL / to.canonicalPerUnit;
  } else {
    // count
    if (hint.gramsPerCount == null) {
      throw new UnitConversionError(fromUnit, toUnit, "gramsPerCount");
    }
    return grams! / hint.gramsPerCount;
  }
}

export function unitTypeOf(u: string): UnitType {
  return classify(u).type;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
cd server && npx vitest run src/__tests__/units.test.ts
```
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/units.ts server/src/__tests__/units.test.ts
git commit -m "feat(server): unit conversion engine with cross-type support"
```

---

### Task 2: Schema migration — add fields, rename model

**Files:**
- Modify: `server/prisma/schema.prisma`
- Run: `npx prisma migrate dev --name pantry_overhaul`

- [ ] **Step 1: Update `Ingredient` model with new fields**

In `server/prisma/schema.prisma`, replace the `Ingredient` model with:

```prisma
model Ingredient {
  id          Int                @id @default(autoincrement())
  name        String             @unique
  category    IngredientCategory @default(other)
  defaultUnit String             @default("count") @map("default_unit")

  defaultLocation        PantryLocation? @map("default_location")
  densityGPerMl          Float?          @map("density_g_per_ml")
  gramsPerCount          Float?          @map("grams_per_count")
  shelfLifeFridgeDays    Int?            @map("shelf_life_fridge_days")
  shelfLifeFreezerDays   Int?            @map("shelf_life_freezer_days")
  shelfLifePantryDays    Int?            @map("shelf_life_pantry_days")
  lowStockThreshold      Float?          @map("low_stock_threshold")
  lowStockUnit           String?         @map("low_stock_unit")
  isOneOff               Boolean         @default(false) @map("is_one_off")

  mealIngredients MealIngredient[]
  pantryBatches   PantryBatch[]
  shoppingItems   ShoppingItem[]
  receiptItems    ReceiptItem[]

  @@map("ingredients")
}
```

- [ ] **Step 2: Replace `PantryItem` model with `PantryBatch` (table stays `pantry_items`)**

```prisma
model PantryBatch {
  id              Int             @id @default(autoincrement())
  ingredientId    Int             @map("ingredient_id")
  quantity        Float
  unit            String
  location        PantryLocation  @default(pantry)
  expirationDate  DateTime?       @map("expiration_date")
  purchaseDate    DateTime?       @map("purchase_date")
  costAtPurchase  Decimal?        @db.Decimal(10, 2) @map("cost_at_purchase")
  tags            String[]        @default([])
  receiptItemId   Int?            @map("receipt_item_id")
  consumedAt      DateTime?       @map("consumed_at")
  createdAt       DateTime        @default(now()) @map("created_at")
  updatedAt       DateTime        @updatedAt @map("updated_at")

  ingredient   Ingredient   @relation(fields: [ingredientId], references: [id])
  receiptItem  ReceiptItem? @relation(fields: [receiptItemId], references: [id])

  @@index([ingredientId, location, consumedAt])
  @@index([consumedAt])
  @@map("pantry_items")
}
```

- [ ] **Step 3: Add back-relation on `ReceiptItem`**

In the existing `ReceiptItem` model, add:

```prisma
  pantryBatches PantryBatch[]
```

- [ ] **Step 4: Generate the migration**

```
cd server && npx prisma migrate dev --name pantry_overhaul
```
Expected: prisma generates a migration that ALTERs `ingredients` and `pantry_items` adding the new columns and renames nothing at the SQL level (the Prisma model rename is code-only). It will also generate the indexes.

- [ ] **Step 5: Verify the generated SQL is additive only**

Read the new migration in `server/prisma/migrations/<timestamp>_pantry_overhaul/migration.sql`. Expected: no `DROP COLUMN`, no `DROP TABLE`, no `RENAME TABLE`. Only `ALTER TABLE ... ADD COLUMN`, `CREATE INDEX`. If the diff includes anything destructive, abort, fix the schema, and re-run.

- [ ] **Step 6: Update server-side code that references `prisma.pantryItem`**

`prisma.pantryItem` is now `prisma.pantryBatch`. Replace every occurrence. Search-and-replace across `server/src`:

```
git grep -l "prisma\.pantryItem" server/src
```

Expected files to touch (verify against your search):
- `server/src/services/pantryService.ts`
- `server/src/services/receiptService.ts`
- `server/src/services/shoppingService.ts` (if it reads the table)
- any tests that mock/touch the model

For each, change `prisma.pantryItem` → `prisma.pantryBatch`, `tx.pantryItem` → `tx.pantryBatch`, and any `PantryItem` type imports → `PantryBatch`.

- [ ] **Step 7: Run all server tests to verify nothing broke**

```
cd server && npx vitest run
```
Expected: all existing tests pass. The change is mechanical; behavior is unchanged for now.

- [ ] **Step 8: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations server/src
git commit -m "feat(server): pantry schema additions and PantryBatch rename"
```

---

## Phase 2 — Server: card aggregation read

### Task 3: Card aggregation pure function

Pulled out of the route as a pure function so we can test it in isolation.

**Files:**
- Create: `server/src/services/pantryAggregation.ts`
- Create: `server/src/__tests__/pantryAggregation.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/__tests__/pantryAggregation.test.ts
import { describe, it, expect } from "vitest";
import { aggregateCards, type AggregateCardsInput } from "../services/pantryAggregation.js";

const ing = (over: Partial<AggregateCardsInput["ingredients"][number]> = {}) => ({
  id: 1,
  name: "Milk",
  category: "dairy" as const,
  defaultUnit: "gal",
  defaultLocation: "fridge" as const,
  densityGPerMl: null,
  gramsPerCount: null,
  shelfLifeFridgeDays: 10,
  shelfLifeFreezerDays: null,
  shelfLifePantryDays: null,
  lowStockThreshold: 1,
  lowStockUnit: "gal",
  isOneOff: false,
  ...over,
});

const batch = (over: Partial<AggregateCardsInput["batches"][number]> = {}) => ({
  id: 100,
  ingredientId: 1,
  quantity: 1,
  unit: "gal",
  location: "fridge" as const,
  expirationDate: null,
  purchaseDate: null,
  costAtPurchase: null,
  tags: [],
  receiptItemId: null,
  consumedAt: null,
  createdAt: new Date("2026-05-01T00:00:00Z"),
  updatedAt: new Date("2026-05-01T00:00:00Z"),
  ...over,
});

describe("aggregateCards", () => {
  it("groups batches by ingredient and sums same-unit quantities", () => {
    const result = aggregateCards({
      ingredients: [ing()],
      batches: [
        batch({ id: 100, quantity: 1, unit: "gal" }),
        batch({ id: 101, quantity: 0.5, unit: "gal" }),
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].batchCount).toBe(2);
    expect(result[0].totalsByUnit).toEqual([{ unit: "gal", qty: 1.5 }]);
    expect(result[0].canonicalTotal).toEqual({ qty: 1.5, unit: "gal" });
    expect(result[0].partialTotal).toBe(false);
  });

  it("returns soonestExpiration as min of batches", () => {
    const result = aggregateCards({
      ingredients: [ing()],
      batches: [
        batch({ id: 100, expirationDate: new Date("2026-05-15T00:00:00Z") }),
        batch({ id: 101, expirationDate: new Date("2026-05-08T00:00:00Z") }),
      ],
    });
    expect(result[0].soonestExpiration).toEqual(new Date("2026-05-08T00:00:00Z"));
  });

  it("isLowStock=true when canonical total below threshold", () => {
    const result = aggregateCards({
      ingredients: [ing({ lowStockThreshold: 1, lowStockUnit: "gal" })],
      batches: [batch({ quantity: 0.25, unit: "gal" })],
    });
    expect(result[0].isLowStock).toBe(true);
  });

  it("isLowStock=false when threshold not set", () => {
    const result = aggregateCards({
      ingredients: [ing({ lowStockThreshold: null, lowStockUnit: null })],
      batches: [batch()],
    });
    expect(result[0].isLowStock).toBe(false);
  });

  it("partialTotal=true when a batch can't convert to defaultUnit", () => {
    // Milk default gal, one batch in cups, no density set => partial.
    const result = aggregateCards({
      ingredients: [ing({ densityGPerMl: null })],
      batches: [
        batch({ quantity: 0.5, unit: "gal" }),
        batch({ id: 102, quantity: 200, unit: "g" }),
      ],
    });
    expect(result[0].partialTotal).toBe(true);
    // canonicalTotal includes only the convertible batch.
    expect(result[0].canonicalTotal?.qty).toBeCloseTo(0.5, 5);
  });

  it("excludes consumed (soft-deleted) batches", () => {
    const result = aggregateCards({
      ingredients: [ing()],
      batches: [
        batch({ id: 100, quantity: 1, consumedAt: null }),
        batch({ id: 101, quantity: 1, consumedAt: new Date("2026-05-01T00:00:00Z") }),
      ],
    });
    expect(result[0].batchCount).toBe(1);
    expect(result[0].totalsByUnit).toEqual([{ unit: "gal", qty: 1 }]);
  });

  it("orders batches FEFO with use_first first", () => {
    const result = aggregateCards({
      ingredients: [ing()],
      batches: [
        batch({ id: 100, expirationDate: new Date("2026-05-15Z") }),
        batch({ id: 101, expirationDate: new Date("2026-05-10Z"), tags: ["use_first"] }),
        batch({ id: 102, expirationDate: new Date("2026-05-05Z") }),
      ],
    });
    expect(result[0].batches.map((b) => b.id)).toEqual([101, 102, 100]);
  });

  it("ingredient with zero active batches still appears (with empty totals)", () => {
    const result = aggregateCards({
      ingredients: [ing()],
      batches: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0].batchCount).toBe(0);
    expect(result[0].totalsByUnit).toEqual([]);
    expect(result[0].canonicalTotal).toBeNull();
    expect(result[0].soonestExpiration).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd server && npx vitest run src/__tests__/pantryAggregation.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the aggregation module**

```typescript
// server/src/services/pantryAggregation.ts
import { convert, UnitConversionError } from "../lib/units.js";

export interface AggregateCardsInput {
  ingredients: Array<{
    id: number;
    name: string;
    category: string;
    defaultUnit: string;
    defaultLocation: "fridge" | "freezer" | "pantry" | null;
    densityGPerMl: number | null;
    gramsPerCount: number | null;
    shelfLifeFridgeDays: number | null;
    shelfLifeFreezerDays: number | null;
    shelfLifePantryDays: number | null;
    lowStockThreshold: number | null;
    lowStockUnit: string | null;
    isOneOff: boolean;
  }>;
  batches: Array<{
    id: number;
    ingredientId: number;
    quantity: number;
    unit: string;
    location: "fridge" | "freezer" | "pantry";
    expirationDate: Date | null;
    purchaseDate: Date | null;
    costAtPurchase: unknown; // Decimal | null
    tags: string[];
    receiptItemId: number | null;
    consumedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

export interface PantryCard {
  ingredient: AggregateCardsInput["ingredients"][number];
  batches: AggregateCardsInput["batches"];
  totalsByUnit: Array<{ unit: string; qty: number }>;
  canonicalTotal: { qty: number; unit: string } | null;
  partialTotal: boolean;
  soonestExpiration: Date | null;
  nextExpirationDays: number | null;
  isLowStock: boolean;
  batchCount: number;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function fefoCompare(
  a: AggregateCardsInput["batches"][number],
  b: AggregateCardsInput["batches"][number],
): number {
  const aFirst = a.tags.includes("use_first") ? 0 : 1;
  const bFirst = b.tags.includes("use_first") ? 0 : 1;
  if (aFirst !== bFirst) return aFirst - bFirst;
  // Earlier expirationDate first; null exp goes to the end.
  const ae = a.expirationDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const be = b.expirationDate?.getTime() ?? Number.POSITIVE_INFINITY;
  return ae - be;
}

export function aggregateCards(input: AggregateCardsInput): PantryCard[] {
  const byIngredient = new Map<number, AggregateCardsInput["batches"]>();
  for (const b of input.batches) {
    if (b.consumedAt != null) continue;
    const list = byIngredient.get(b.ingredientId) ?? [];
    list.push(b);
    byIngredient.set(b.ingredientId, list);
  }

  return input.ingredients.map((ingredient) => {
    const batches = (byIngredient.get(ingredient.id) ?? []).slice().sort(fefoCompare);

    const totals = new Map<string, number>();
    for (const b of batches) {
      totals.set(b.unit, (totals.get(b.unit) ?? 0) + b.quantity);
    }
    const totalsByUnit = Array.from(totals.entries()).map(([unit, qty]) => ({ unit, qty }));

    let canonicalQty = 0;
    let partial = false;
    for (const b of batches) {
      try {
        canonicalQty += convert(b.quantity, b.unit, ingredient.defaultUnit, {
          densityGPerMl: ingredient.densityGPerMl,
          gramsPerCount: ingredient.gramsPerCount,
        });
      } catch (e) {
        if (e instanceof UnitConversionError) {
          partial = true;
        } else {
          throw e;
        }
      }
    }
    const canonicalTotal = batches.length === 0 ? null : { qty: canonicalQty, unit: ingredient.defaultUnit };

    const soonest = batches
      .map((b) => b.expirationDate)
      .filter((d): d is Date => d != null)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const nextExpirationDays = soonest
      ? Math.max(0, Math.ceil((soonest.getTime() - Date.now()) / MS_PER_DAY))
      : null;

    let isLowStock = false;
    if (ingredient.lowStockThreshold != null && ingredient.lowStockUnit != null && canonicalTotal) {
      try {
        const totalInThresholdUnit = convert(
          canonicalTotal.qty,
          canonicalTotal.unit,
          ingredient.lowStockUnit,
          { densityGPerMl: ingredient.densityGPerMl, gramsPerCount: ingredient.gramsPerCount },
        );
        isLowStock = totalInThresholdUnit < ingredient.lowStockThreshold;
      } catch {
        // If we can't convert, don't claim "low" — just skip the signal.
        isLowStock = false;
      }
    }

    return {
      ingredient,
      batches,
      totalsByUnit,
      canonicalTotal,
      partialTotal: partial,
      soonestExpiration: soonest,
      nextExpirationDays,
      isLowStock,
      batchCount: batches.length,
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
cd server && npx vitest run src/__tests__/pantryAggregation.test.ts
```
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/pantryAggregation.ts server/src/__tests__/pantryAggregation.test.ts
git commit -m "feat(server): pure card-aggregation function over batches"
```

---

### Task 4: `GET /api/pantry` returns aggregated cards with filters/sort/search

**Files:**
- Modify: `server/src/services/pantryService.ts`
- Modify: `server/src/routes/pantry.ts`

- [ ] **Step 1: Replace `getAllPantryItems` with `getPantryCards`**

In `server/src/services/pantryService.ts`, replace `getAllPantryItems` with:

```typescript
import { aggregateCards, type PantryCard } from "./pantryAggregation.js";

export interface PantryQuery {
  location?: "fridge" | "freezer" | "pantry";
  category?: string;
  q?: string;            // free-text search on ingredient.name
  sort?: "name" | "expiring" | "added" | "lowstock";
  showConsumed?: boolean;
  lowOnly?: boolean;
}

export async function getPantryCards(query: PantryQuery = {}): Promise<PantryCard[]> {
  // We pull all ingredients (excluding orphan one-offs with no active batches)
  // and all active batches, then aggregate in memory. Pantry is small.
  const ingredientWhere: any = {};
  if (query.category) ingredientWhere.category = query.category;
  if (query.q) ingredientWhere.name = { contains: query.q, mode: "insensitive" };

  const [ingredientRows, batchRows] = await Promise.all([
    prisma.ingredient.findMany({ where: ingredientWhere }),
    prisma.pantryBatch.findMany({
      where: query.showConsumed ? {} : { consumedAt: null },
    }),
  ]);

  let cards = aggregateCards({
    ingredients: ingredientRows,
    batches: batchRows,
  });

  // Hide ingredients that have no active batches AND aren't one-offs explicitly
  // listed: actually, hide all ingredients with no active batches by default,
  // since those are pantry "ghosts" left over from old receipts. Keep them
  // queryable through ingredients API.
  cards = cards.filter((c) => c.batchCount > 0);

  // Hide one-offs that no longer have active batches (already covered above).
  // Hide one-offs from search results by default — they're personal notes.
  // (No flag needed: one-offs with active batches still surface.)

  if (query.location) {
    cards = cards.filter((c) =>
      c.batches.some((b) => b.location === query.location),
    );
  }

  if (query.lowOnly) {
    cards = cards.filter((c) => c.isLowStock);
  }

  switch (query.sort ?? "name") {
    case "expiring":
      cards.sort((a, b) => {
        const ae = a.soonestExpiration?.getTime() ?? Number.POSITIVE_INFINITY;
        const be = b.soonestExpiration?.getTime() ?? Number.POSITIVE_INFINITY;
        return ae - be;
      });
      break;
    case "added":
      cards.sort((a, b) => {
        const aLatest = Math.max(...a.batches.map((x) => x.createdAt.getTime()), 0);
        const bLatest = Math.max(...b.batches.map((x) => x.createdAt.getTime()), 0);
        return bLatest - aLatest;
      });
      break;
    case "lowstock":
      cards.sort((a, b) => Number(b.isLowStock) - Number(a.isLowStock));
      break;
    case "name":
    default:
      cards.sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name));
      break;
  }

  return cards;
}
```

Keep `addPantryItem`, `updatePantryItem`, `deletePantryItem`, `deductIngredientsForMeal` as-is for now — they'll be replaced in later tasks. But rename their internal `prisma.pantryItem.*` → `prisma.pantryBatch.*` if Task 2's grep didn't already catch them.

- [ ] **Step 2: Update `GET /api/pantry` route**

Replace `server/src/routes/pantry.ts`:

```typescript
import { Router } from "express";
import * as pantryService from "../services/pantryService.js";

const router = Router();

router.get("/", async (req, res) => {
  const cards = await pantryService.getPantryCards({
    location: req.query.location as any,
    category: req.query.category as any,
    q: req.query.q as string | undefined,
    sort: req.query.sort as any,
    showConsumed: req.query.showConsumed === "true",
    lowOnly: req.query.lowOnly === "true",
  });
  res.json(cards);
});

// Legacy endpoints intentionally removed — replaced by /api/pantry/batches.

export default router;
```

- [ ] **Step 3: Smoke test the endpoint**

```
cd server && npm run dev
# in another terminal:
curl 'http://localhost:3001/api/pantry'
```
Expected: JSON array of `PantryCard` objects (may be empty if pantry is empty).
Try with filters:
```
curl 'http://localhost:3001/api/pantry?location=fridge&sort=expiring'
```
Expected: 200, array.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/pantryService.ts server/src/routes/pantry.ts
git commit -m "feat(server): GET /api/pantry returns aggregated cards with filter/sort/search"
```

---

## Phase 3 — Server: batch writes

### Task 5: `POST /api/pantry/batches` (with optional inline ingredient creation)

**Files:**
- Create: `server/src/services/pantryBatchService.ts`
- Modify: `server/src/routes/pantry.ts`
- Create: `server/src/__tests__/pantryBatchService.test.ts`

- [ ] **Step 1: Write failing tests for the pure helpers**

```typescript
// server/src/__tests__/pantryBatchService.test.ts
import { describe, it, expect } from "vitest";
import { suggestExpirationDate } from "../services/pantryBatchService.js";

describe("suggestExpirationDate", () => {
  const tripDate = new Date("2026-05-01T00:00:00Z");

  it("uses fridge shelf-life when location is fridge", () => {
    expect(
      suggestExpirationDate({
        tripDate,
        location: "fridge",
        ingredient: { shelfLifeFridgeDays: 7, shelfLifeFreezerDays: 30, shelfLifePantryDays: null },
      }),
    ).toEqual(new Date("2026-05-08T00:00:00Z"));
  });

  it("uses freezer shelf-life when location is freezer", () => {
    expect(
      suggestExpirationDate({
        tripDate,
        location: "freezer",
        ingredient: { shelfLifeFridgeDays: 7, shelfLifeFreezerDays: 30, shelfLifePantryDays: null },
      }),
    ).toEqual(new Date("2026-05-31T00:00:00Z"));
  });

  it("returns null when shelf-life for the location is missing", () => {
    expect(
      suggestExpirationDate({
        tripDate,
        location: "pantry",
        ingredient: { shelfLifeFridgeDays: 7, shelfLifeFreezerDays: 30, shelfLifePantryDays: null },
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```
cd server && npx vitest run src/__tests__/pantryBatchService.test.ts
```

- [ ] **Step 3: Implement the service**

```typescript
// server/src/services/pantryBatchService.ts
import { PrismaClient, Prisma, type PantryLocation } from "@prisma/client";

const prisma = new PrismaClient();

export interface CreateBatchInput {
  ingredientId?: number;
  newIngredient?: {
    name: string;
    category: string;
    defaultUnit: string;
    defaultLocation?: PantryLocation;
    densityGPerMl?: number | null;
    gramsPerCount?: number | null;
    shelfLifeFridgeDays?: number | null;
    shelfLifeFreezerDays?: number | null;
    shelfLifePantryDays?: number | null;
    lowStockThreshold?: number | null;
    lowStockUnit?: string | null;
    isOneOff?: boolean;
  };
  quantity: number;
  unit: string;
  location: PantryLocation;
  expirationDate?: string | null;
  purchaseDate?: string | null;
  costAtPurchase?: number | null;
  tags?: string[];
  receiptItemId?: number | null;
}

export async function createBatch(input: CreateBatchInput) {
  return prisma.$transaction(async (tx) => {
    let ingredientId = input.ingredientId;
    if (!ingredientId) {
      if (!input.newIngredient) {
        throw new Error("Either ingredientId or newIngredient is required");
      }
      const created = await tx.ingredient.upsert({
        where: { name: input.newIngredient.name.toLowerCase() },
        update: {},
        create: {
          name: input.newIngredient.name.toLowerCase(),
          category: input.newIngredient.category as any,
          defaultUnit: input.newIngredient.defaultUnit,
          defaultLocation: input.newIngredient.defaultLocation ?? null,
          densityGPerMl: input.newIngredient.densityGPerMl ?? null,
          gramsPerCount: input.newIngredient.gramsPerCount ?? null,
          shelfLifeFridgeDays: input.newIngredient.shelfLifeFridgeDays ?? null,
          shelfLifeFreezerDays: input.newIngredient.shelfLifeFreezerDays ?? null,
          shelfLifePantryDays: input.newIngredient.shelfLifePantryDays ?? null,
          lowStockThreshold: input.newIngredient.lowStockThreshold ?? null,
          lowStockUnit: input.newIngredient.lowStockUnit ?? null,
          isOneOff: input.newIngredient.isOneOff ?? false,
        },
      });
      ingredientId = created.id;
    }

    return tx.pantryBatch.create({
      data: {
        ingredientId,
        quantity: input.quantity,
        unit: input.unit,
        location: input.location,
        expirationDate: input.expirationDate ? new Date(input.expirationDate) : null,
        purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : null,
        costAtPurchase: input.costAtPurchase != null ? new Prisma.Decimal(input.costAtPurchase) : null,
        tags: input.tags ?? [],
        receiptItemId: input.receiptItemId ?? null,
      },
      include: { ingredient: true },
    });
  });
}

export interface SuggestExpirationInput {
  tripDate: Date;
  location: PantryLocation;
  ingredient: {
    shelfLifeFridgeDays: number | null;
    shelfLifeFreezerDays: number | null;
    shelfLifePantryDays: number | null;
  };
}

export function suggestExpirationDate(input: SuggestExpirationInput): Date | null {
  const days =
    input.location === "fridge" ? input.ingredient.shelfLifeFridgeDays
    : input.location === "freezer" ? input.ingredient.shelfLifeFreezerDays
    : input.ingredient.shelfLifePantryDays;
  if (days == null) return null;
  return new Date(input.tripDate.getTime() + days * 24 * 60 * 60 * 1000);
}
```

- [ ] **Step 4: Run, expect PASS for the helper test**

```
cd server && npx vitest run src/__tests__/pantryBatchService.test.ts
```

- [ ] **Step 5: Add the route**

In `server/src/routes/pantry.ts`, append:

```typescript
import * as pantryBatchService from "../services/pantryBatchService.js";

router.post("/batches", async (req, res) => {
  try {
    const batch = await pantryBatchService.createBatch(req.body);
    res.status(201).json(batch);
  } catch (e: any) {
    res.status(400).json({ error: e.message ?? "Bad request" });
  }
});
```

- [ ] **Step 6: Smoke test**

```
curl -X POST http://localhost:3001/api/pantry/batches \
  -H 'content-type: application/json' \
  -d '{"newIngredient":{"name":"test_milk","category":"dairy","defaultUnit":"gal"},"quantity":1,"unit":"gal","location":"fridge"}'
```
Expected: 201, JSON of the created batch with `ingredient` populated.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/pantryBatchService.ts server/src/routes/pantry.ts server/src/__tests__/pantryBatchService.test.ts
git commit -m "feat(server): POST /api/pantry/batches with inline ingredient creation"
```

---

### Task 6: `PATCH /api/pantry/batches/:id`

**Files:**
- Modify: `server/src/services/pantryBatchService.ts`
- Modify: `server/src/routes/pantry.ts`

- [ ] **Step 1: Add `updateBatch` to the service**

In `server/src/services/pantryBatchService.ts`, add:

```typescript
export interface UpdateBatchInput {
  quantity?: number;
  unit?: string;
  location?: PantryLocation;
  expirationDate?: string | null;
  purchaseDate?: string | null;
  costAtPurchase?: number | null;
  tags?: string[];
}

export async function updateBatch(id: number, input: UpdateBatchInput) {
  const data: any = {};
  if (input.quantity != null) data.quantity = Math.max(0, input.quantity);
  if (input.unit != null) data.unit = input.unit;
  if (input.location != null) data.location = input.location;
  if (input.expirationDate !== undefined) data.expirationDate = input.expirationDate ? new Date(input.expirationDate) : null;
  if (input.purchaseDate !== undefined) data.purchaseDate = input.purchaseDate ? new Date(input.purchaseDate) : null;
  if (input.costAtPurchase !== undefined) data.costAtPurchase = input.costAtPurchase != null ? new Prisma.Decimal(input.costAtPurchase) : null;
  if (input.tags != null) data.tags = input.tags;

  // If quantity drops to 0, soft-delete instead.
  if (data.quantity === 0) {
    return prisma.pantryBatch.update({
      where: { id },
      data: { ...data, consumedAt: new Date() },
      include: { ingredient: true },
    });
  }

  return prisma.pantryBatch.update({
    where: { id },
    data,
    include: { ingredient: true },
  });
}
```

- [ ] **Step 2: Add the route**

```typescript
router.patch("/batches/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const batch = await pantryBatchService.updateBatch(id, req.body);
    res.json(batch);
  } catch (e: any) {
    if (e?.code === "P2025") {
      res.status(404).json({ error: "Batch not found" });
      return;
    }
    res.status(400).json({ error: e.message ?? "Bad request" });
  }
});
```

- [ ] **Step 3: Smoke test**

```
curl -X PATCH http://localhost:3001/api/pantry/batches/<id> \
  -H 'content-type: application/json' \
  -d '{"tags":["use_first","opened"]}'
```
Expected: 200, updated batch.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/pantryBatchService.ts server/src/routes/pantry.ts
git commit -m "feat(server): PATCH /api/pantry/batches/:id"
```

---

### Task 7: Soft-delete + restore

**Files:**
- Modify: `server/src/services/pantryBatchService.ts`
- Modify: `server/src/routes/pantry.ts`

- [ ] **Step 1: Add `softDeleteBatch` and `restoreBatch`**

```typescript
const RESTORE_WINDOW_DAYS = 30;

export async function softDeleteBatch(id: number) {
  return prisma.pantryBatch.update({
    where: { id },
    data: { consumedAt: new Date() },
    include: { ingredient: true },
  });
}

export async function restoreBatch(id: number) {
  const batch = await prisma.pantryBatch.findUnique({ where: { id } });
  if (!batch || !batch.consumedAt) return null;
  const ageMs = Date.now() - batch.consumedAt.getTime();
  if (ageMs > RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000) return null;
  return prisma.pantryBatch.update({
    where: { id },
    data: { consumedAt: null },
    include: { ingredient: true },
  });
}
```

- [ ] **Step 2: Add the routes**

```typescript
router.delete("/batches/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const batch = await pantryBatchService.softDeleteBatch(id);
    res.json(batch);
  } catch (e: any) {
    if (e?.code === "P2025") {
      res.status(404).json({ error: "Batch not found" });
      return;
    }
    throw e;
  }
});

router.post("/batches/:id/restore", async (req, res) => {
  const id = Number(req.params.id);
  const batch = await pantryBatchService.restoreBatch(id);
  if (!batch) {
    res.status(404).json({ error: "Cannot restore (not found, not consumed, or past 30-day window)" });
    return;
  }
  res.json(batch);
});
```

- [ ] **Step 3: Smoke test**

```
curl -X DELETE http://localhost:3001/api/pantry/batches/<id>
# response includes consumedAt timestamp
curl -X POST http://localhost:3001/api/pantry/batches/<id>/restore
# response: same batch, consumedAt: null
```

- [ ] **Step 4: Commit**

```bash
git add server/src/services/pantryBatchService.ts server/src/routes/pantry.ts
git commit -m "feat(server): soft-delete + 30-day restore for pantry batches"
```

---

### Task 8: Extend ingredient endpoints (PATCH + new fields on POST)

**Files:**
- Modify: `server/src/routes/ingredients.ts`

- [ ] **Step 1: Replace the route file**

```typescript
import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

const FIELDS = [
  "name", "category", "defaultUnit",
  "defaultLocation", "densityGPerMl", "gramsPerCount",
  "shelfLifeFridgeDays", "shelfLifeFreezerDays", "shelfLifePantryDays",
  "lowStockThreshold", "lowStockUnit", "isOneOff",
] as const;

function pickFields(body: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, f)) out[f] = body[f];
  }
  return out;
}

router.get("/", async (req, res) => {
  const includeOneOffs = req.query.includeOneOffs === "true";
  const ingredients = await prisma.ingredient.findMany({
    where: includeOneOffs ? {} : { isOneOff: false },
    orderBy: { name: "asc" },
  });
  res.json(ingredients);
});

router.post("/", async (req, res) => {
  const data = pickFields(req.body);
  if (typeof data.name === "string") data.name = (data.name as string).toLowerCase();
  try {
    const ingredient = await prisma.ingredient.create({ data: data as any });
    res.status(201).json(ingredient);
  } catch (err: any) {
    if (err.code === "P2002") {
      res.status(409).json({ error: "Ingredient already exists" });
      return;
    }
    throw err;
  }
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const data = pickFields(req.body);
  try {
    const ingredient = await prisma.ingredient.update({ where: { id }, data: data as any });
    res.json(ingredient);
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "Ingredient not found" });
      return;
    }
    throw err;
  }
});

export default router;
```

- [ ] **Step 2: Smoke test**

```
curl -X PATCH http://localhost:3001/api/ingredients/1 \
  -H 'content-type: application/json' \
  -d '{"shelfLifeFridgeDays": 10, "lowStockThreshold": 1, "lowStockUnit": "gal"}'
```
Expected: 200, updated ingredient with the new fields.

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/ingredients.ts
git commit -m "feat(server): PATCH /api/ingredients/:id and pantry-overhaul fields on POST"
```

---

## Phase 4 — Server: behavior changes

### Task 9: Rewrite recipe deduction with FEFO + use_first + conversions

**Files:**
- Modify: `server/src/services/pantryService.ts`
- Create: `server/src/__tests__/pantryDeduction.test.ts`

- [ ] **Step 1: Write failing tests for the deduction selector**

```typescript
// server/src/__tests__/pantryDeduction.test.ts
import { describe, it, expect } from "vitest";
import { selectBatchesToDrain, type DrainPlan } from "../services/pantryService.js";

const batch = (over: any = {}) => ({
  id: 1,
  quantity: 1,
  unit: "lb",
  expirationDate: null as Date | null,
  tags: [] as string[],
  ...over,
});

describe("selectBatchesToDrain", () => {
  const ingredient = { defaultUnit: "lb", densityGPerMl: null, gramsPerCount: null };

  it("drains the soonest-expiring batch first (FEFO)", () => {
    const plan = selectBatchesToDrain({
      needed: 0.5,
      neededUnit: "lb",
      ingredient,
      batches: [
        batch({ id: 1, quantity: 1, expirationDate: new Date("2026-06-01Z") }),
        batch({ id: 2, quantity: 1, expirationDate: new Date("2026-05-10Z") }),
      ],
    });
    expect(plan.consumed.map((c) => c.batchId)).toEqual([2]);
    expect(plan.consumed[0].partial).toBe(true);
    expect(plan.consumed[0].newQuantity).toBeCloseTo(0.5, 5);
    expect(plan.shortfall).toBe(0);
  });

  it("use_first tag overrides FEFO", () => {
    const plan = selectBatchesToDrain({
      needed: 0.5,
      neededUnit: "lb",
      ingredient,
      batches: [
        batch({ id: 1, quantity: 1, expirationDate: new Date("2026-05-01Z") }),
        batch({ id: 2, quantity: 1, expirationDate: new Date("2026-06-01Z"), tags: ["use_first"] }),
      ],
    });
    expect(plan.consumed[0].batchId).toBe(2);
  });

  it("walks multiple batches when one isn't enough", () => {
    const plan = selectBatchesToDrain({
      needed: 1.5,
      neededUnit: "lb",
      ingredient,
      batches: [
        batch({ id: 1, quantity: 1, expirationDate: new Date("2026-05-01Z") }),
        batch({ id: 2, quantity: 1, expirationDate: new Date("2026-05-15Z") }),
      ],
    });
    expect(plan.consumed.map((c) => c.batchId)).toEqual([1, 2]);
    expect(plan.consumed[0].partial).toBe(false);
    expect(plan.consumed[1].partial).toBe(true);
    expect(plan.consumed[1].newQuantity).toBeCloseTo(0.5, 5);
  });

  it("converts units when batch unit differs from recipe unit", () => {
    const plan = selectBatchesToDrain({
      needed: 8,
      neededUnit: "oz",
      ingredient,
      batches: [batch({ id: 1, quantity: 1, unit: "lb" })],
    });
    expect(plan.consumed[0].batchId).toBe(1);
    expect(plan.consumed[0].newQuantity).toBeCloseTo(0.5, 5); // 1 lb - 8 oz = 0.5 lb
  });

  it("returns shortfall when pantry can't cover", () => {
    const plan = selectBatchesToDrain({
      needed: 5,
      neededUnit: "lb",
      ingredient,
      batches: [batch({ id: 1, quantity: 1 })],
    });
    expect(plan.consumed.map((c) => c.batchId)).toEqual([1]);
    expect(plan.shortfall).toBeCloseTo(4, 5);
    expect(plan.shortfallUnit).toBe("lb");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (functions don't exist yet)

```
cd server && npx vitest run src/__tests__/pantryDeduction.test.ts
```

- [ ] **Step 3: Implement `selectBatchesToDrain` and rewrite `deductIngredientsForMeal`**

In `server/src/services/pantryService.ts`, replace `deductIngredientsForMeal` and add the selector:

```typescript
import { convert, UnitConversionError } from "../lib/units.js";

export interface DrainPlan {
  consumed: Array<{ batchId: number; partial: boolean; newQuantity: number }>;
  shortfall: number;
  shortfallUnit: string;
}

export function selectBatchesToDrain(input: {
  needed: number;
  neededUnit: string;
  ingredient: { defaultUnit: string; densityGPerMl: number | null; gramsPerCount: number | null };
  batches: Array<{ id: number; quantity: number; unit: string; expirationDate: Date | null; tags: string[] }>;
}): DrainPlan {
  const hint = { densityGPerMl: input.ingredient.densityGPerMl, gramsPerCount: input.ingredient.gramsPerCount };
  // Sort: use_first first, then FEFO ASC, then null-exp last.
  const ordered = input.batches.slice().sort((a, b) => {
    const aFirst = a.tags.includes("use_first") ? 0 : 1;
    const bFirst = b.tags.includes("use_first") ? 0 : 1;
    if (aFirst !== bFirst) return aFirst - bFirst;
    const ae = a.expirationDate?.getTime() ?? Number.POSITIVE_INFINITY;
    const be = b.expirationDate?.getTime() ?? Number.POSITIVE_INFINITY;
    return ae - be;
  });

  let remaining = input.needed; // in input.neededUnit
  const consumed: DrainPlan["consumed"] = [];

  for (const b of ordered) {
    if (remaining <= 0) break;
    // How much of this batch (expressed in neededUnit) is available?
    const batchInNeededUnit = convert(b.quantity, b.unit, input.neededUnit, hint);
    if (batchInNeededUnit <= remaining) {
      // Drain entirely.
      remaining -= batchInNeededUnit;
      consumed.push({ batchId: b.id, partial: false, newQuantity: 0 });
    } else {
      // Partial drain: convert remaining (in neededUnit) back to batch.unit.
      const drainInBatchUnit = convert(remaining, input.neededUnit, b.unit, hint);
      consumed.push({ batchId: b.id, partial: true, newQuantity: b.quantity - drainInBatchUnit });
      remaining = 0;
    }
  }

  return { consumed, shortfall: remaining, shortfallUnit: input.neededUnit };
}

export async function deductIngredientsForMeal(mealId: number, servingMultiplier: number) {
  const mealIngredients = await prisma.mealIngredient.findMany({
    where: { mealId },
    include: { ingredient: true },
  });

  const shortfalls: Array<{ ingredientId: number; ingredientName: string; missing: number; unit: string }> = [];

  for (const mi of mealIngredients) {
    const needed = mi.quantity * servingMultiplier;
    const ingredient = mi.ingredient;
    const batchRows = await prisma.pantryBatch.findMany({
      where: { ingredientId: mi.ingredientId, consumedAt: null },
    });

    let plan: DrainPlan;
    try {
      plan = selectBatchesToDrain({
        needed,
        neededUnit: mi.unit,
        ingredient,
        batches: batchRows.map((b) => ({
          id: b.id,
          quantity: b.quantity,
          unit: b.unit,
          expirationDate: b.expirationDate,
          tags: b.tags,
        })),
      });
    } catch (e) {
      if (e instanceof UnitConversionError) {
        // Cannot deduct — record as shortfall and move on.
        shortfalls.push({ ingredientId: mi.ingredientId, ingredientName: ingredient.name, missing: needed, unit: mi.unit });
        continue;
      }
      throw e;
    }

    await prisma.$transaction(
      plan.consumed.map((c) =>
        c.partial
          ? prisma.pantryBatch.update({ where: { id: c.batchId }, data: { quantity: c.newQuantity } })
          : prisma.pantryBatch.update({ where: { id: c.batchId }, data: { quantity: 0, consumedAt: new Date() } }),
      ),
    );

    if (plan.shortfall > 0) {
      shortfalls.push({ ingredientId: mi.ingredientId, ingredientName: ingredient.name, missing: plan.shortfall, unit: plan.shortfallUnit });
    }
  }

  return { shortfalls };
}
```

Remove the old `addPantryItem`, `updatePantryItem`, `deletePantryItem` exports — they're replaced by the batch service. (Find callers via `git grep`; the only external caller should be the legacy route, which is gone.)

- [ ] **Step 4: Run all tests**

```
cd server && npx vitest run
```
Expected: PASS, including new deduction tests and existing ones.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/pantryService.ts server/src/__tests__/pantryDeduction.test.ts
git commit -m "feat(server): FEFO+use_first deduction with cross-unit conversion"
```

---

### Task 10: Receipt commit creates one batch per line, no merge

**Files:**
- Modify: `server/src/services/receiptService.ts`

- [ ] **Step 1: Replace the merge logic in `commitReceipt`**

In `server/src/services/receiptService.ts`, locate the loop body that calls `computeMergeDecision` (around line 270). Replace the merge-or-create branch with: always create a fresh `PantryBatch` and link it back to the `ReceiptItem`.

Find this block:

```typescript
      const incoming: IncomingPantryRow = { ... };
      const decision = computeMergeDecision(incoming, workingPantry);

      if (decision.action === "increment") { ... }
      else { ... }
```

Replace with:

```typescript
      const ingredient = await tx.ingredient.findUnique({ where: { id: ingredientId } });
      const expirationDate =
        edit.expirationDate ? new Date(edit.expirationDate)
        : ingredient ? suggestExpirationDate({
            tripDate: new Date(input.tripDate),
            location: (edit.locationGuess ?? "pantry") as PantryLocation,
            ingredient: {
              shelfLifeFridgeDays: ingredient.shelfLifeFridgeDays,
              shelfLifeFreezerDays: ingredient.shelfLifeFreezerDays,
              shelfLifePantryDays: ingredient.shelfLifePantryDays,
            },
          })
        : null;

      const newBatch = await tx.pantryBatch.create({
        data: {
          ingredientId,
          quantity: edit.quantity,
          unit: edit.unit,
          location: (edit.locationGuess ?? "pantry") as any,
          expirationDate,
          purchaseDate: new Date(input.tripDate),
          costAtPurchase: edit.price != null ? new Prisma.Decimal(edit.price) : null,
          tags: [],
          receiptItemId: receiptItemRow.id,
        },
      });
```

Note: this requires capturing the `tx.receiptItem.create` return value as `receiptItemRow` (it currently isn't captured — adjust the `await tx.receiptItem.create(...)` line into `const receiptItemRow = await tx.receiptItem.create(...)`).

Add at the top of the file:

```typescript
import { suggestExpirationDate } from "./pantryBatchService.js";
import type { PantryLocation } from "@prisma/client";
```

Remove the now-unused imports of `computeMergeDecision`, `IncomingPantryRow`, `ExistingPantryItem`, and the `existingPantry` / `workingPantry` setup at the top of the loop. The merge-decision pure helpers (`computeMergeDecision` etc.) and their tests stay in the codebase but are no longer wired in — this is OK; if they're unused after this change, remove them in a follow-up commit.

- [ ] **Step 2: Update the corresponding tests**

`server/src/__tests__/receiptService.test.ts` likely tests the merge behavior. Update those tests to assert the new behavior: every committed item creates a new batch with `purchaseDate = tripDate`, `costAtPurchase = price`, and `receiptItemId` set. Run:

```
cd server && npx vitest run src/__tests__/receiptService.test.ts
```

Expected: tests pass after updates. If a test specifically validates "two same-trip items merge," delete it; that behavior is removed by Q5.

- [ ] **Step 3: Smoke test through the UI**

Start `npm run dev` in both `server` and `client`. Use the existing receipt flow with a sample receipt; commit it. Verify in the database that each receipt item produced a separate `pantry_items` row with `purchase_date`, `cost_at_purchase`, and `receipt_item_id` populated.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/receiptService.ts server/src/__tests__/receiptService.test.ts
git commit -m "feat(server): receipt commit creates one batch per line with purchaseDate/cost"
```

---

### Task 11: 30-day soft-delete purge cron job

**Files:**
- Modify: `server/package.json`
- Create: `server/src/jobs/purgeConsumedBatches.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Install `node-cron`**

```
cd server && npm install node-cron
npm install --save-dev @types/node-cron
```

- [ ] **Step 2: Create the job module**

```typescript
// server/src/jobs/purgeConsumedBatches.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function purgeConsumedBatches(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const result = await prisma.pantryBatch.deleteMany({
    where: { consumedAt: { lt: cutoff } },
  });
  return result.count;
}
```

- [ ] **Step 3: Register the cron in `index.ts`**

In `server/src/index.ts`, after the `app.use(...)` block and before the `app.listen` call:

```typescript
import cron from "node-cron";
import { purgeConsumedBatches } from "./jobs/purgeConsumedBatches.js";

// Nightly at 03:00 server time. Skipped under NODE_ENV=test.
if (process.env.NODE_ENV !== "test") {
  cron.schedule("0 3 * * *", async () => {
    try {
      const count = await purgeConsumedBatches();
      console.log(`[purge] removed ${count} consumed pantry batches older than 30 days`);
    } catch (e) {
      console.error("[purge] failed:", e);
    }
  });
}
```

- [ ] **Step 4: Write a quick test for the pure helper**

```typescript
// server/src/__tests__/purgeConsumedBatches.test.ts
import { describe, it, expect, vi } from "vitest";
// This test validates the cutoff math; the deleteMany is mocked.

vi.mock("@prisma/client", () => {
  return {
    PrismaClient: vi.fn().mockImplementation(() => ({
      pantryBatch: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
    })),
  };
});

import { purgeConsumedBatches } from "../jobs/purgeConsumedBatches.js";

describe("purgeConsumedBatches", () => {
  it("uses a 30-day cutoff from `now`", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const count = await purgeConsumedBatches(now);
    expect(count).toBe(3);
  });
});
```

- [ ] **Step 5: Run tests**

```
cd server && npx vitest run src/__tests__/purgeConsumedBatches.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/package-lock.json server/src/jobs/purgeConsumedBatches.ts server/src/index.ts server/src/__tests__/purgeConsumedBatches.test.ts
git commit -m "feat(server): nightly cron purges consumed pantry batches older than 30 days"
```

---

## Phase 5 — Client: API layer

### Task 12: Rewrite `client/src/api/pantry.ts`

**Files:**
- Modify: `client/src/api/pantry.ts`

- [ ] **Step 1: Replace contents**

```typescript
// client/src/api/pantry.ts
import { apiFetch } from "./client";
import type { Ingredient } from "./ingredients";

export type PantryLocation = "fridge" | "freezer" | "pantry";

export interface PantryBatch {
  id: number;
  ingredientId: number;
  quantity: number;
  unit: string;
  location: PantryLocation;
  expirationDate: string | null;
  purchaseDate: string | null;
  costAtPurchase: string | null; // Decimal serialized as string
  tags: string[];
  receiptItemId: number | null;
  consumedAt: string | null;
  createdAt: string;
  updatedAt: string;
  ingredient?: Ingredient;
}

export interface PantryCard {
  ingredient: Ingredient;
  batches: PantryBatch[];
  totalsByUnit: Array<{ unit: string; qty: number }>;
  canonicalTotal: { qty: number; unit: string } | null;
  partialTotal: boolean;
  soonestExpiration: string | null;
  nextExpirationDays: number | null;
  isLowStock: boolean;
  batchCount: number;
}

export interface PantryQuery {
  location?: PantryLocation;
  category?: string;
  q?: string;
  sort?: "name" | "expiring" | "added" | "lowstock";
  lowOnly?: boolean;
}

export const getPantry = (q: PantryQuery = {}): Promise<PantryCard[]> => {
  const params = new URLSearchParams();
  if (q.location) params.set("location", q.location);
  if (q.category) params.set("category", q.category);
  if (q.q) params.set("q", q.q);
  if (q.sort) params.set("sort", q.sort);
  if (q.lowOnly) params.set("lowOnly", "true");
  const qs = params.toString();
  return apiFetch<PantryCard[]>(`/pantry${qs ? `?${qs}` : ""}`);
};

export interface CreateBatchInput {
  ingredientId?: number;
  newIngredient?: {
    name: string;
    category: string;
    defaultUnit: string;
    defaultLocation?: PantryLocation;
    densityGPerMl?: number | null;
    gramsPerCount?: number | null;
    shelfLifeFridgeDays?: number | null;
    shelfLifeFreezerDays?: number | null;
    shelfLifePantryDays?: number | null;
    lowStockThreshold?: number | null;
    lowStockUnit?: string | null;
    isOneOff?: boolean;
  };
  quantity: number;
  unit: string;
  location: PantryLocation;
  expirationDate?: string | null;
  purchaseDate?: string | null;
  costAtPurchase?: number | null;
  tags?: string[];
}

export const createBatch = (input: CreateBatchInput) =>
  apiFetch<PantryBatch>("/pantry/batches", { method: "POST", body: JSON.stringify(input) });

export interface UpdateBatchInput {
  quantity?: number;
  unit?: string;
  location?: PantryLocation;
  expirationDate?: string | null;
  purchaseDate?: string | null;
  costAtPurchase?: number | null;
  tags?: string[];
}

export const updateBatch = (id: number, input: UpdateBatchInput) =>
  apiFetch<PantryBatch>(`/pantry/batches/${id}`, { method: "PATCH", body: JSON.stringify(input) });

export const deleteBatch = (id: number) =>
  apiFetch<PantryBatch>(`/pantry/batches/${id}`, { method: "DELETE" });

export const restoreBatch = (id: number) =>
  apiFetch<PantryBatch>(`/pantry/batches/${id}/restore`, { method: "POST" });
```

- [ ] **Step 2: Verify the client builds** (downstream type errors are expected — they'll be fixed in later tasks)

```
cd client && npm run build
```
Expected: type errors in `Pantry.tsx`, `AddFromReceiptModal.tsx`, etc. — those are addressed in later tasks. Just confirm there are no errors *inside* `pantry.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add client/src/api/pantry.ts
git commit -m "feat(client): rewrite pantry API client for new endpoint shape"
```

---

### Task 13: Extend `client/src/api/ingredients.ts`

**Files:**
- Modify: `client/src/api/ingredients.ts`

- [ ] **Step 1: Replace contents**

```typescript
// client/src/api/ingredients.ts
import { apiFetch } from "./client";

export type IngredientCategory =
  | "produce" | "protein" | "dairy" | "pantry_staple" | "grain"
  | "spice" | "condiment" | "frozen" | "other";

export type PantryLocation = "fridge" | "freezer" | "pantry";

export interface Ingredient {
  id: number;
  name: string;
  category: IngredientCategory;
  defaultUnit: string;
  defaultLocation: PantryLocation | null;
  densityGPerMl: number | null;
  gramsPerCount: number | null;
  shelfLifeFridgeDays: number | null;
  shelfLifeFreezerDays: number | null;
  shelfLifePantryDays: number | null;
  lowStockThreshold: number | null;
  lowStockUnit: string | null;
  isOneOff: boolean;
}

export interface IngredientUpdate {
  name?: string;
  category?: IngredientCategory;
  defaultUnit?: string;
  defaultLocation?: PantryLocation | null;
  densityGPerMl?: number | null;
  gramsPerCount?: number | null;
  shelfLifeFridgeDays?: number | null;
  shelfLifeFreezerDays?: number | null;
  shelfLifePantryDays?: number | null;
  lowStockThreshold?: number | null;
  lowStockUnit?: string | null;
  isOneOff?: boolean;
}

export const getIngredients = (opts: { includeOneOffs?: boolean } = {}) =>
  apiFetch<Ingredient[]>(`/ingredients${opts.includeOneOffs ? "?includeOneOffs=true" : ""}`);

export const createIngredient = (data: Partial<Ingredient> & { name: string; category: IngredientCategory; defaultUnit: string }) =>
  apiFetch<Ingredient>("/ingredients", { method: "POST", body: JSON.stringify(data) });

export const updateIngredient = (id: number, data: IngredientUpdate) =>
  apiFetch<Ingredient>(`/ingredients/${id}`, { method: "PATCH", body: JSON.stringify(data) });
```

- [ ] **Step 2: Build check**

```
cd client && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add client/src/api/ingredients.ts
git commit -m "feat(client): extend ingredients API with new fields and PATCH"
```

---

## Phase 6 — Client: read UI (grid + cards)

### Task 14: `PantryCard` component (read-only)

**Files:**
- Create: `client/src/components/pantry/PantryCard.tsx`

- [ ] **Step 1: Create the component**

```typescript
// client/src/components/pantry/PantryCard.tsx
import { Refrigerator, Snowflake, BookMarked, Package, AlertTriangle } from "lucide-react";
import type { PantryCard as PantryCardData } from "../../api/pantry";
import Pill from "../ui/Pill";

const LOC_ICON: Record<string, typeof Refrigerator> = {
  fridge: Refrigerator,
  freezer: Snowflake,
  pantry: BookMarked,
};

const CATEGORY_LABELS: Record<string, string> = {
  produce: "Produce",
  protein: "Protein",
  dairy: "Dairy",
  pantry_staple: "Pantry",
  grain: "Grains",
  spice: "Spices",
  condiment: "Condiments",
  frozen: "Frozen",
  other: "Other",
};

interface Props {
  card: PantryCardData;
  onOpen: (card: PantryCardData) => void;
}

function dominantLocation(card: PantryCardData): "fridge" | "freezer" | "pantry" | "mixed" {
  const counts = new Map<string, number>();
  for (const b of card.batches) counts.set(b.location, (counts.get(b.location) ?? 0) + 1);
  if (counts.size > 1) return "mixed";
  const [loc] = counts.keys();
  return (loc as any) ?? "pantry";
}

export default function PantryCard({ card, onOpen }: Props) {
  const loc = dominantLocation(card);
  const Icon = loc === "mixed" ? Package : LOC_ICON[loc];
  const total = card.canonicalTotal;
  const days = card.nextExpirationDays;

  return (
    <button
      onClick={() => onOpen(card)}
      className="text-left bg-surface-1 border border-line rounded-[14px] p-4 hover:border-accent-line transition flex flex-col gap-2"
    >
      <div className="flex items-start gap-2">
        <div className="w-7 h-7 rounded-[8px] bg-accent-soft text-accent-ink grid place-items-center shrink-0">
          <Icon size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-ink-1 truncate capitalize">{card.ingredient.name}</div>
          <div className="text-[11px] text-ink-3">{CATEGORY_LABELS[card.ingredient.category] ?? card.ingredient.category}</div>
        </div>
        <Pill tone="ghost" size="sm">{card.batchCount}</Pill>
      </div>

      <div className="flex items-end justify-between gap-2 mt-1">
        <div className="text-[15px] tabular-nums text-ink-1">
          {total
            ? `${card.partialTotal ? "~" : ""}${formatQty(total.qty)} ${total.unit}`
            : <span className="text-ink-3">—</span>}
        </div>
        <div className="flex gap-1.5">
          {card.isLowStock && <Pill tone="warn" size="sm">Low</Pill>}
          {days != null && (
            <Pill tone={days <= 0 ? "danger" : days <= 3 ? "warn" : "ghost"} size="sm">
              {days <= 0 ? "expired" : `${days}d`}
            </Pill>
          )}
          {loc === "mixed" && <Pill tone="ghost" size="sm">Mixed</Pill>}
        </div>
      </div>

      {card.partialTotal && (
        <div className="flex items-center gap-1 text-[10.5px] text-ink-3">
          <AlertTriangle size={11} />
          <span>Some batches couldn't be summed (missing density)</span>
        </div>
      )}
    </button>
  );
}

function formatQty(q: number): string {
  if (Math.abs(q - Math.round(q)) < 1e-6) return String(Math.round(q));
  return q.toFixed(2).replace(/\.?0+$/, "");
}
```

- [ ] **Step 2: Build check**

```
cd client && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/pantry/PantryCard.tsx
git commit -m "feat(client): PantryCard read-only component"
```

---

### Task 15: `FilterChips` component

**Files:**
- Create: `client/src/components/pantry/FilterChips.tsx`

- [ ] **Step 1: Create the component**

```typescript
// client/src/components/pantry/FilterChips.tsx
import { Search } from "lucide-react";
import type { PantryQuery, PantryLocation } from "../../api/pantry";
import type { IngredientCategory } from "../../api/ingredients";

const LOCATIONS: Array<PantryLocation | "all"> = ["all", "fridge", "freezer", "pantry"];
const CATEGORIES: Array<IngredientCategory | "all"> = [
  "all", "produce", "protein", "dairy", "pantry_staple", "grain", "spice", "condiment", "frozen", "other",
];
const CATEGORY_LABELS: Record<string, string> = {
  all: "All",
  produce: "Produce",
  protein: "Protein",
  dairy: "Dairy",
  pantry_staple: "Pantry",
  grain: "Grains",
  spice: "Spices",
  condiment: "Condiments",
  frozen: "Frozen",
  other: "Other",
};

const SORTS: Array<{ value: NonNullable<PantryQuery["sort"]>; label: string }> = [
  { value: "name", label: "Name" },
  { value: "expiring", label: "Expiring soon" },
  { value: "added", label: "Recently added" },
  { value: "lowstock", label: "Low stock first" },
];

interface Props {
  value: PantryQuery;
  onChange: (next: PantryQuery) => void;
}

export default function FilterChips({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          type="search"
          value={value.q ?? ""}
          onChange={(e) => onChange({ ...value, q: e.target.value || undefined })}
          placeholder="Search…"
          className="h-9 w-48 rounded-[10px] border border-line bg-surface-2 pl-8 pr-3 text-[13px] text-ink-1 placeholder:text-ink-3 focus:outline-none focus:border-accent"
        />
      </label>

      <select
        value={value.location ?? "all"}
        onChange={(e) => onChange({ ...value, location: e.target.value === "all" ? undefined : (e.target.value as PantryLocation) })}
        className="h-9 rounded-[10px] border border-line bg-surface-2 px-2.5 text-[13px] text-ink-1 focus:outline-none focus:border-accent capitalize"
      >
        {LOCATIONS.map((l) => <option key={l} value={l}>{l === "all" ? "All locations" : l}</option>)}
      </select>

      <select
        value={value.category ?? "all"}
        onChange={(e) => onChange({ ...value, category: e.target.value === "all" ? undefined : e.target.value })}
        className="h-9 rounded-[10px] border border-line bg-surface-2 px-2.5 text-[13px] text-ink-1 focus:outline-none focus:border-accent"
      >
        {CATEGORIES.map((c) => <option key={c} value={c}>{c === "all" ? "All categories" : CATEGORY_LABELS[c]}</option>)}
      </select>

      <select
        value={value.sort ?? "name"}
        onChange={(e) => onChange({ ...value, sort: e.target.value as PantryQuery["sort"] })}
        className="h-9 rounded-[10px] border border-line bg-surface-2 px-2.5 text-[13px] text-ink-1 focus:outline-none focus:border-accent"
      >
        {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>

      <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
        <input
          type="checkbox"
          checked={!!value.lowOnly}
          onChange={(e) => onChange({ ...value, lowOnly: e.target.checked || undefined })}
        />
        Running low only
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/pantry/FilterChips.tsx
git commit -m "feat(client): FilterChips component for pantry"
```

---

### Task 16: Rewrite `Pantry.tsx` — unified grid + filter chips + card grid

Drawer is added in Task 17 — for this task the page is read-only with a no-op `onOpen`.

**Files:**
- Modify: `client/src/pages/Pantry.tsx`

- [ ] **Step 1: Replace `Pantry.tsx`**

```typescript
// client/src/pages/Pantry.tsx
import { useEffect, useState } from "react";
import { Plus, Receipt as ReceiptIcon } from "lucide-react";
import { getPantry, type PantryCard, type PantryQuery } from "../api/pantry";
import Button from "../components/ui/Button";
import AddFromReceiptModal from "../components/AddFromReceiptModal";
import SpendingStrip from "../components/SpendingStrip";
import RecentReceiptsStrip from "../components/RecentReceiptsStrip";
import PantryCardComp from "../components/pantry/PantryCard";
import FilterChips from "../components/pantry/FilterChips";

export default function Pantry() {
  const [cards, setCards] = useState<PantryCard[]>([]);
  const [query, setQuery] = useState<PantryQuery>({ sort: "name" });
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [receiptRefreshKey, setReceiptRefreshKey] = useState(0);

  const load = () => {
    getPantry(query).then(setCards).catch(() => setCards([]));
  };
  useEffect(load, [JSON.stringify(query), receiptRefreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalItems = cards.reduce((acc, c) => acc + c.batchCount, 0);

  return (
    <div className="flex flex-col gap-7">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[12px] uppercase tracking-[0.1em] text-ink-3 mb-1.5">
            {totalItems} item{totalItems === 1 ? "" : "s"} on hand · {cards.length} ingredient{cards.length === 1 ? "" : "s"}
          </div>
          <h1 className="text-[26px] sm:text-[30px] font-semibold -tracking-[0.02em] text-ink-1">Pantry</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon={ReceiptIcon} onClick={() => setShowReceiptModal(true)}>
            Add from receipt
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => { /* AddItemModal — Task 22 */ }}>
            Add item
          </Button>
        </div>
      </div>

      <SpendingStrip refreshKey={receiptRefreshKey} />
      <RecentReceiptsStrip
        refreshKey={receiptRefreshKey}
        onChanged={() => setReceiptRefreshKey((k) => k + 1)}
      />

      <FilterChips value={query} onChange={setQuery} />

      {cards.length === 0 ? (
        <div className="bg-surface-1 border border-line rounded-[14px] p-10 text-center text-[13px] text-ink-3">
          Nothing matches. Try clearing filters, or add an item.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {cards.map((c) => (
            <PantryCardComp key={c.ingredient.id} card={c} onOpen={() => { /* drawer — Task 17 */ }} />
          ))}
        </div>
      )}

      {showReceiptModal && (
        <AddFromReceiptModal
          onClose={() => setShowReceiptModal(false)}
          onCommitted={() => {
            setReceiptRefreshKey((k) => k + 1);
            load();
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build check + visual smoke**

```
cd client && npm run build
# in dev:
npm run dev
```
Open `/pantry` in a browser. Expected: cards render in a grid; filters/search/sort work end-to-end. The Add Item button is a no-op for now; clicking a card does nothing.

- [ ] **Step 3: Delete `client/src/components/PantryItemRow.tsx`**

It's no longer referenced.

```
git rm client/src/components/PantryItemRow.tsx
```

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Pantry.tsx
git commit -m "feat(client): unified pantry grid with filter chips"
```

---

## Phase 7 — Client: drawer + edits

### Task 17: `PantryDrawer` shell

**Files:**
- Create: `client/src/components/pantry/PantryDrawer.tsx`
- Modify: `client/src/pages/Pantry.tsx`

- [ ] **Step 1: Create the drawer shell**

```typescript
// client/src/components/pantry/PantryDrawer.tsx
import { useEffect } from "react";
import { X, Settings } from "lucide-react";
import type { PantryCard } from "../../api/pantry";
import Button from "../ui/Button";

interface Props {
  card: PantryCard | null;
  onClose: () => void;
  onChanged: () => void;
}

export default function PantryDrawer({ card, onClose, onChanged }: Props) {
  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, onClose]);

  if (!card) return null;

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[180] bg-black/30 amp-fade-in" />
      <aside className="fixed top-0 right-0 z-[190] h-full w-full sm:w-[480px] bg-surface-1 border-l border-line flex flex-col shadow-2xl amp-slide-in-right">
        <header className="flex items-start gap-3 px-5 py-4 border-b border-line-soft">
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-semibold text-ink-1 capitalize truncate">{card.ingredient.name}</div>
            <div className="text-[11px] text-ink-3 capitalize">
              {card.ingredient.category} · default unit: {card.ingredient.defaultUnit}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 grid place-items-center rounded-[8px] text-ink-2 hover:bg-surface-2">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
          <div>
            <Button variant="ghost" size="sm" icon={Settings} onClick={() => {/* IngredientEditForm — Task 20 */}}>
              Edit ingredient
            </Button>
          </div>

          <section>
            <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold mb-1.5">Summary</div>
            <div className="text-[13px] text-ink-2 flex flex-col gap-1">
              <div>Total on hand: {card.canonicalTotal ? `${card.partialTotal ? "~" : ""}${card.canonicalTotal.qty.toFixed(2)} ${card.canonicalTotal.unit}` : "—"}</div>
              <div>Soonest expiration: {card.nextExpirationDays != null ? `${card.nextExpirationDays}d` : "—"}</div>
              <div>Running low: {card.isLowStock ? "yes" : "no"}</div>
            </div>
          </section>

          <section>
            <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold mb-1.5">
              Batches ({card.batchCount})
            </div>
            <div className="flex flex-col gap-2">
              {/* BatchRow per batch — Task 18 */}
              {card.batches.map((b) => (
                <div key={b.id} className="bg-surface-2 border border-line-soft rounded-[10px] p-3 text-[13px] text-ink-2">
                  {b.quantity} {b.unit} · {b.location}
                  {b.expirationDate && ` · expires ${new Date(b.expirationDate).toLocaleDateString()}`}
                </div>
              ))}
            </div>
            <div className="mt-3">
              <Button variant="ghost" size="sm" onClick={() => {/* add batch — Task 21 */}}>
                + Add another batch
              </Button>
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 2: Wire it into `Pantry.tsx`**

```typescript
// in Pantry.tsx — add state and render
import PantryDrawer from "../components/pantry/PantryDrawer";

const [openCard, setOpenCard] = useState<PantryCard | null>(null);

// in PantryCardComp:
<PantryCardComp key={c.ingredient.id} card={c} onOpen={() => setOpenCard(c)} />

// at the end of the JSX, alongside the receipt modal:
<PantryDrawer card={openCard} onClose={() => setOpenCard(null)} onChanged={load} />
```

When the user reloads, refresh `openCard` from the latest `cards` so the drawer reflects fresh data:

```typescript
// after `getPantry().then(setCards)` lands, also:
useEffect(() => {
  if (!openCard) return;
  const fresh = cards.find((c) => c.ingredient.id === openCard.ingredient.id);
  if (fresh) setOpenCard(fresh);
}, [cards]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 3: Add slide-in animation**

In `client/src/index.css` (or wherever `amp-fade-in` is defined), add:

```css
@keyframes amp-slide-in-right {
  from { transform: translateX(20px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
.amp-slide-in-right { animation: amp-slide-in-right 180ms ease-out; }
```

(If a similar animation already exists, reuse it — search `amp-fade-in` to find the file.)

- [ ] **Step 4: Commit**

```bash
git add client/src/components/pantry/PantryDrawer.tsx client/src/pages/Pantry.tsx client/src/index.css
git commit -m "feat(client): pantry drawer shell wired to card click"
```

---

### Task 18: `BatchRow` component (read + delete)

**Files:**
- Create: `client/src/components/pantry/BatchRow.tsx`
- Modify: `client/src/components/pantry/PantryDrawer.tsx`

- [ ] **Step 1: Create the row**

```typescript
// client/src/components/pantry/BatchRow.tsx
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { PantryBatch } from "../../api/pantry";
import Pill from "../ui/Pill";

interface Props {
  batch: PantryBatch;
  onEdit: () => void;
  onDelete: () => void;
}

export default function BatchRow({ batch, onEdit, onDelete }: Props) {
  const exp = batch.expirationDate ? new Date(batch.expirationDate) : null;
  const days = exp ? Math.max(0, Math.ceil((exp.getTime() - Date.now()) / 86400000)) : null;
  const purchase = batch.purchaseDate ? new Date(batch.purchaseDate).toLocaleDateString() : null;
  const cost = batch.costAtPurchase ? `$${parseFloat(batch.costAtPurchase).toFixed(2)}` : null;

  return (
    <div className="bg-surface-2 border border-line-soft rounded-[10px] p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] text-ink-1 tabular-nums">
          {batch.quantity} {batch.unit} · <span className="capitalize">{batch.location}</span>
        </div>
        <div className="flex gap-1.5">
          {days != null && (
            <Pill tone={days <= 0 ? "danger" : days <= 3 ? "warn" : "ghost"} size="sm">
              {days <= 0 ? "expired" : `${days}d`}
            </Pill>
          )}
        </div>
      </div>

      {batch.tags.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {batch.tags.map((t) => (
            <Pill key={t} tone={t === "use_first" ? "warn" : "ghost"} size="sm">
              {t.replace(/_/g, " ")}
            </Pill>
          ))}
        </div>
      )}

      {(purchase || cost) && (
        <div className="text-[11px] text-ink-3">
          {purchase && `Bought ${purchase}`}{purchase && cost ? " · " : ""}{cost}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button onClick={onEdit} className="text-[11px] text-accent flex items-center gap-1 hover:underline">
          <Pencil size={11} /> Edit
        </button>
        <button onClick={onDelete} className="text-[11px] text-danger flex items-center gap-1 hover:underline">
          <Trash2 size={11} /> Delete
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace the placeholder list in `PantryDrawer.tsx`**

```typescript
// add to imports:
import BatchRow from "./BatchRow";
import { deleteBatch } from "../../api/pantry";

// inside the drawer JSX, replace the placeholder map block with:
<div className="flex flex-col gap-2">
  {card.batches.map((b) => (
    <BatchRow
      key={b.id}
      batch={b}
      onEdit={() => setEditingBatchId(b.id)}
      onDelete={async () => {
        await deleteBatch(b.id);
        onChanged();
      }}
    />
  ))}
</div>
```

Also add `const [editingBatchId, setEditingBatchId] = useState<number | null>(null);` to the drawer (used by Task 19's edit form).

- [ ] **Step 3: Commit**

```bash
git add client/src/components/pantry/BatchRow.tsx client/src/components/pantry/PantryDrawer.tsx
git commit -m "feat(client): BatchRow with edit/delete affordances"
```

---

### Task 19: `BatchEditForm` (inline expansion in drawer)

**Files:**
- Create: `client/src/components/pantry/BatchEditForm.tsx`
- Modify: `client/src/components/pantry/PantryDrawer.tsx`

- [ ] **Step 1: Create the form**

```typescript
// client/src/components/pantry/BatchEditForm.tsx
import { useState } from "react";
import type { PantryBatch, PantryLocation } from "../../api/pantry";
import { updateBatch } from "../../api/pantry";
import Button from "../ui/Button";

const TAG_PRESETS = ["use_first", "opened", "thawing"] as const;

interface Props {
  batch: PantryBatch;
  onCancel: () => void;
  onSaved: () => void;
}

export default function BatchEditForm({ batch, onCancel, onSaved }: Props) {
  const [quantity, setQuantity] = useState(batch.quantity);
  const [unit, setUnit] = useState(batch.unit);
  const [location, setLocation] = useState<PantryLocation>(batch.location);
  const [expirationDate, setExpirationDate] = useState(batch.expirationDate?.slice(0, 10) ?? "");
  const [purchaseDate, setPurchaseDate] = useState(batch.purchaseDate?.slice(0, 10) ?? "");
  const [costAtPurchase, setCostAtPurchase] = useState(batch.costAtPurchase ?? "");
  const [tags, setTags] = useState<string[]>(batch.tags);
  const [customTag, setCustomTag] = useState("");

  const toggleTag = (t: string) => {
    setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
  };

  const save = async () => {
    await updateBatch(batch.id, {
      quantity,
      unit,
      location,
      expirationDate: expirationDate || null,
      purchaseDate: purchaseDate || null,
      costAtPurchase: costAtPurchase === "" ? null : Number(costAtPurchase),
      tags,
    });
    onSaved();
  };

  return (
    <div className="bg-surface-2 border border-accent-line rounded-[10px] p-3 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Quantity">
          <input type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className={inputCls} />
        </Field>
        <Field label="Unit">
          <input type="text" value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Location">
          <select value={location} onChange={(e) => setLocation(e.target.value as PantryLocation)} className={inputCls + " capitalize"}>
            <option value="fridge">Fridge</option>
            <option value="freezer">Freezer</option>
            <option value="pantry">Pantry</option>
          </select>
        </Field>
        <Field label="Expiration">
          <input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Purchased">
          <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Cost ($)">
          <input type="number" step="0.01" min={0} value={costAtPurchase as any} onChange={(e) => setCostAtPurchase(e.target.value)} className={inputCls} />
        </Field>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">Tags</label>
        <div className="flex flex-wrap gap-1.5">
          {TAG_PRESETS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggleTag(t)}
              className={`text-[11px] px-2 py-1 rounded-[8px] border ${
                tags.includes(t) ? "bg-accent-soft border-accent text-accent-ink" : "bg-surface-1 border-line text-ink-2"
              }`}
            >
              {t.replace(/_/g, " ")}
            </button>
          ))}
          {tags.filter((t) => !TAG_PRESETS.includes(t as any)).map((t) => (
            <button key={t} type="button" onClick={() => toggleTag(t)} className="text-[11px] px-2 py-1 rounded-[8px] border bg-accent-soft border-accent text-accent-ink">
              {t} ×
            </button>
          ))}
        </div>
        <div className="flex gap-2 mt-1">
          <input
            type="text"
            value={customTag}
            onChange={(e) => setCustomTag(e.target.value)}
            placeholder="Custom tag"
            className={inputCls + " flex-1"}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const t = customTag.trim().toLowerCase().replace(/\s+/g, "_");
              if (t && !tags.includes(t)) setTags([...tags, t]);
              setCustomTag("");
            }}
          >
            Add tag
          </Button>
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={save}>Save</Button>
      </div>
    </div>
  );
}

const inputCls = "h-9 w-full rounded-[10px] border border-line bg-surface-1 px-2.5 text-[13px] text-ink-1 outline-none focus:border-accent";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">{label}</label>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Render the form in the drawer when `editingBatchId` is set**

In `PantryDrawer.tsx`, replace the batch list rendering:

```typescript
{card.batches.map((b) =>
  editingBatchId === b.id ? (
    <BatchEditForm
      key={b.id}
      batch={b}
      onCancel={() => setEditingBatchId(null)}
      onSaved={() => { setEditingBatchId(null); onChanged(); }}
    />
  ) : (
    <BatchRow
      key={b.id}
      batch={b}
      onEdit={() => setEditingBatchId(b.id)}
      onDelete={async () => { await deleteBatch(b.id); onChanged(); }}
    />
  ),
)}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/pantry/BatchEditForm.tsx client/src/components/pantry/PantryDrawer.tsx
git commit -m "feat(client): inline batch edit form in pantry drawer"
```

---

### Task 20: `IngredientEditForm` (card-level)

**Files:**
- Create: `client/src/components/pantry/IngredientEditForm.tsx`
- Modify: `client/src/components/pantry/PantryDrawer.tsx`

- [ ] **Step 1: Create the form**

```typescript
// client/src/components/pantry/IngredientEditForm.tsx
import { useState } from "react";
import type { Ingredient, IngredientCategory, PantryLocation } from "../../api/ingredients";
import { updateIngredient } from "../../api/ingredients";
import Button from "../ui/Button";

const CATEGORIES: IngredientCategory[] = [
  "produce", "protein", "dairy", "pantry_staple", "grain", "spice", "condiment", "frozen", "other",
];

interface Props {
  ingredient: Ingredient;
  onCancel: () => void;
  onSaved: () => void;
}

export default function IngredientEditForm({ ingredient, onCancel, onSaved }: Props) {
  const [name, setName] = useState(ingredient.name);
  const [category, setCategory] = useState<IngredientCategory>(ingredient.category);
  const [defaultUnit, setDefaultUnit] = useState(ingredient.defaultUnit);
  const [defaultLocation, setDefaultLocation] = useState<PantryLocation | "">(ingredient.defaultLocation ?? "");
  const [densityGPerMl, setDensityGPerMl] = useState<string>(ingredient.densityGPerMl?.toString() ?? "");
  const [gramsPerCount, setGramsPerCount] = useState<string>(ingredient.gramsPerCount?.toString() ?? "");
  const [shelfFridge, setShelfFridge] = useState<string>(ingredient.shelfLifeFridgeDays?.toString() ?? "");
  const [shelfFreezer, setShelfFreezer] = useState<string>(ingredient.shelfLifeFreezerDays?.toString() ?? "");
  const [shelfPantry, setShelfPantry] = useState<string>(ingredient.shelfLifePantryDays?.toString() ?? "");
  const [lowStockThreshold, setLowStockThreshold] = useState<string>(ingredient.lowStockThreshold?.toString() ?? "");
  const [lowStockUnit, setLowStockUnit] = useState(ingredient.lowStockUnit ?? "");

  const toNum = (s: string) => s === "" ? null : Number(s);

  const save = async () => {
    await updateIngredient(ingredient.id, {
      name: name.toLowerCase().trim(),
      category,
      defaultUnit: defaultUnit.trim(),
      defaultLocation: defaultLocation || null,
      densityGPerMl: toNum(densityGPerMl),
      gramsPerCount: toNum(gramsPerCount),
      shelfLifeFridgeDays: toNum(shelfFridge),
      shelfLifeFreezerDays: toNum(shelfFreezer),
      shelfLifePantryDays: toNum(shelfPantry),
      lowStockThreshold: toNum(lowStockThreshold),
      lowStockUnit: lowStockUnit || null,
    });
    onSaved();
  };

  return (
    <div className="bg-surface-2 border border-accent-line rounded-[10px] p-3 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
        <Field label="Category">
          <select value={category} onChange={(e) => setCategory(e.target.value as IngredientCategory)} className={inputCls}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Default unit"><input value={defaultUnit} onChange={(e) => setDefaultUnit(e.target.value)} className={inputCls} /></Field>
        <Field label="Default location">
          <select value={defaultLocation} onChange={(e) => setDefaultLocation(e.target.value as any)} className={inputCls + " capitalize"}>
            <option value="">—</option>
            <option value="fridge">Fridge</option>
            <option value="freezer">Freezer</option>
            <option value="pantry">Pantry</option>
          </select>
        </Field>
        <Field label="Density (g/mL)"><input type="number" step="0.001" value={densityGPerMl} onChange={(e) => setDensityGPerMl(e.target.value)} className={inputCls} /></Field>
        <Field label="Grams per count"><input type="number" step="0.1" value={gramsPerCount} onChange={(e) => setGramsPerCount(e.target.value)} className={inputCls} /></Field>
        <Field label="Shelf life (fridge, days)"><input type="number" min={0} value={shelfFridge} onChange={(e) => setShelfFridge(e.target.value)} className={inputCls} /></Field>
        <Field label="Shelf life (freezer, days)"><input type="number" min={0} value={shelfFreezer} onChange={(e) => setShelfFreezer(e.target.value)} className={inputCls} /></Field>
        <Field label="Shelf life (pantry, days)"><input type="number" min={0} value={shelfPantry} onChange={(e) => setShelfPantry(e.target.value)} className={inputCls} /></Field>
        <Field label="Low-stock threshold"><input type="number" step="0.01" min={0} value={lowStockThreshold} onChange={(e) => setLowStockThreshold(e.target.value)} className={inputCls} /></Field>
        <Field label="Low-stock unit"><input value={lowStockUnit} onChange={(e) => setLowStockUnit(e.target.value)} className={inputCls} /></Field>
      </div>

      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={save}>Save ingredient</Button>
      </div>
    </div>
  );
}

const inputCls = "h-9 w-full rounded-[10px] border border-line bg-surface-1 px-2.5 text-[13px] text-ink-1 outline-none focus:border-accent";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">{label}</label>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `PantryDrawer.tsx`**

```typescript
// add state:
const [editingIngredient, setEditingIngredient] = useState(false);
// add to imports:
import IngredientEditForm from "./IngredientEditForm";

// replace the "Edit ingredient" button + render:
{editingIngredient ? (
  <IngredientEditForm
    ingredient={card.ingredient}
    onCancel={() => setEditingIngredient(false)}
    onSaved={() => { setEditingIngredient(false); onChanged(); }}
  />
) : (
  <Button variant="ghost" size="sm" icon={Settings} onClick={() => setEditingIngredient(true)}>
    Edit ingredient
  </Button>
)}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/pantry/IngredientEditForm.tsx client/src/components/pantry/PantryDrawer.tsx
git commit -m "feat(client): card-level ingredient edit form in drawer"
```

---

### Task 21: "Add another batch" inside the drawer

**Files:**
- Create: `client/src/components/pantry/BatchAddForm.tsx`
- Modify: `client/src/components/pantry/PantryDrawer.tsx`

- [ ] **Step 1: Create the add form (mostly mirrors edit, but creates instead of patches)**

```typescript
// client/src/components/pantry/BatchAddForm.tsx
import { useState } from "react";
import type { Ingredient } from "../../api/ingredients";
import type { PantryLocation } from "../../api/pantry";
import { createBatch } from "../../api/pantry";
import Button from "../ui/Button";

interface Props {
  ingredient: Ingredient;
  onCancel: () => void;
  onSaved: () => void;
}

export default function BatchAddForm({ ingredient, onCancel, onSaved }: Props) {
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState(ingredient.defaultUnit);
  const [location, setLocation] = useState<PantryLocation>(ingredient.defaultLocation ?? "pantry");
  const [expirationDate, setExpirationDate] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [costAtPurchase, setCostAtPurchase] = useState("");

  const save = async () => {
    await createBatch({
      ingredientId: ingredient.id,
      quantity,
      unit,
      location,
      expirationDate: expirationDate || null,
      purchaseDate,
      costAtPurchase: costAtPurchase === "" ? null : Number(costAtPurchase),
      tags: [],
    });
    onSaved();
  };

  return (
    <div className="bg-surface-2 border border-accent-line rounded-[10px] p-3 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Quantity"><input type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className={inputCls} /></Field>
        <Field label="Unit"><input value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls} /></Field>
        <Field label="Location">
          <select value={location} onChange={(e) => setLocation(e.target.value as PantryLocation)} className={inputCls + " capitalize"}>
            <option value="fridge">Fridge</option>
            <option value="freezer">Freezer</option>
            <option value="pantry">Pantry</option>
          </select>
        </Field>
        <Field label="Expiration"><input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} className={inputCls} /></Field>
        <Field label="Purchased"><input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className={inputCls} /></Field>
        <Field label="Cost ($)"><input type="number" step="0.01" min={0} value={costAtPurchase} onChange={(e) => setCostAtPurchase(e.target.value)} className={inputCls} /></Field>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={save}>Add batch</Button>
      </div>
    </div>
  );
}

const inputCls = "h-9 w-full rounded-[10px] border border-line bg-surface-1 px-2.5 text-[13px] text-ink-1 outline-none focus:border-accent";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">{label}</label>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Wire into `PantryDrawer.tsx`**

```typescript
// add state:
const [addingBatch, setAddingBatch] = useState(false);
// add to imports:
import BatchAddForm from "./BatchAddForm";

// replace the "Add another batch" button:
{addingBatch ? (
  <BatchAddForm
    ingredient={card.ingredient}
    onCancel={() => setAddingBatch(false)}
    onSaved={() => { setAddingBatch(false); onChanged(); }}
  />
) : (
  <Button variant="ghost" size="sm" onClick={() => setAddingBatch(true)}>
    + Add another batch
  </Button>
)}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/pantry/BatchAddForm.tsx client/src/components/pantry/PantryDrawer.tsx
git commit -m "feat(client): add another batch from inside the drawer"
```

---

## Phase 8 — Client: Add Item modal

### Task 22: `AddItemModal` (existing ingredient + new ingredient tabs)

**Files:**
- Create: `client/src/components/pantry/AddItemModal.tsx`
- Modify: `client/src/pages/Pantry.tsx`

- [ ] **Step 1: Create the modal**

```typescript
// client/src/components/pantry/AddItemModal.tsx
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { getIngredients, type Ingredient, type IngredientCategory, type PantryLocation } from "../../api/ingredients";
import { createBatch } from "../../api/pantry";
import Button from "../ui/Button";

const CATEGORIES: IngredientCategory[] = [
  "produce", "protein", "dairy", "pantry_staple", "grain", "spice", "condiment", "frozen", "other",
];

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

type Tab = "existing" | "new";

export default function AddItemModal({ onClose, onAdded }: Props) {
  const [tab, setTab] = useState<Tab>("existing");
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [search, setSearch] = useState("");

  // Common batch fields
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState("");
  const [location, setLocation] = useState<PantryLocation>("pantry");
  const [expirationDate, setExpirationDate] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [costAtPurchase, setCostAtPurchase] = useState("");

  // Existing-tab state
  const [selected, setSelected] = useState<Ingredient | null>(null);

  // New-tab state
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<IngredientCategory>("other");
  const [newDefaultUnit, setNewDefaultUnit] = useState("count");
  const [newIsOneOff, setNewIsOneOff] = useState(false);

  useEffect(() => {
    getIngredients().then(setIngredients).catch(() => setIngredients([]));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ingredients.slice(0, 30);
    return ingredients.filter((i) => i.name.includes(q)).slice(0, 30);
  }, [ingredients, search]);

  const selectIngredient = (i: Ingredient) => {
    setSelected(i);
    setUnit(i.defaultUnit);
    setLocation(i.defaultLocation ?? "pantry");
  };

  const submit = async () => {
    if (tab === "existing") {
      if (!selected) return;
      await createBatch({
        ingredientId: selected.id,
        quantity,
        unit,
        location,
        expirationDate: expirationDate || null,
        purchaseDate,
        costAtPurchase: costAtPurchase === "" ? null : Number(costAtPurchase),
      });
    } else {
      if (!newName.trim()) return;
      await createBatch({
        newIngredient: {
          name: newName,
          category: newCategory,
          defaultUnit: newDefaultUnit,
          defaultLocation: location,
          isOneOff: newIsOneOff,
        },
        quantity,
        unit: unit || newDefaultUnit,
        location,
        expirationDate: expirationDate || null,
        purchaseDate,
        costAtPurchase: costAtPurchase === "" ? null : Number(costAtPurchase),
      });
    }
    onAdded();
    onClose();
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8 amp-fade-in" style={{ background: "rgba(30, 22, 10, 0.55)", backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} className="bg-surface-1 rounded-[16px] w-full max-w-[600px] max-h-[88vh] flex flex-col overflow-hidden border border-line">
        <div className="flex items-start gap-3 px-5 py-4 border-b border-line-soft">
          <div className="flex-1">
            <div className="text-[14px] font-semibold text-ink-1">Add item</div>
            <div className="text-[11px] text-ink-3">Pick an existing ingredient or create a new one</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 grid place-items-center rounded-[8px] text-ink-2 hover:bg-surface-2"><X size={16} /></button>
        </div>

        <div className="px-5 pt-4 flex gap-2">
          <TabButton active={tab === "existing"} onClick={() => setTab("existing")}>Existing</TabButton>
          <TabButton active={tab === "new"} onClick={() => setTab("new")}>New ingredient</TabButton>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3">
          {tab === "existing" ? (
            <>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ingredients…" className={inputCls} />
              <div className="max-h-40 overflow-y-auto border border-line-soft rounded-[10px]">
                {filtered.map((i) => (
                  <button key={i.id} onClick={() => selectIngredient(i)} className={`w-full text-left px-3 py-2 text-[13px] hover:bg-surface-2 ${selected?.id === i.id ? "bg-accent-soft text-accent-ink" : "text-ink-1"}`}>
                    <span className="capitalize">{i.name}</span>
                    <span className="text-[11px] text-ink-3 ml-2">{i.category}</span>
                  </button>
                ))}
                {filtered.length === 0 && <div className="px-3 py-2 text-[12px] text-ink-3">No matches.</div>}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Name"><input value={newName} onChange={(e) => setNewName(e.target.value)} className={inputCls} /></Field>
              <Field label="Category">
                <select value={newCategory} onChange={(e) => setNewCategory(e.target.value as IngredientCategory)} className={inputCls}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Default unit"><input value={newDefaultUnit} onChange={(e) => setNewDefaultUnit(e.target.value)} className={inputCls} /></Field>
              <div className="flex items-end">
                <label className="text-[12px] text-ink-2 flex items-center gap-1.5">
                  <input type="checkbox" checked={newIsOneOff} onChange={(e) => setNewIsOneOff(e.target.checked)} />
                  One-off (don't add to ingredient list)
                </label>
              </div>
            </div>
          )}

          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold mt-2">Batch</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Quantity"><input type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className={inputCls} /></Field>
            <Field label="Unit"><input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={tab === "new" ? newDefaultUnit : ""} className={inputCls} /></Field>
            <Field label="Location">
              <select value={location} onChange={(e) => setLocation(e.target.value as PantryLocation)} className={inputCls + " capitalize"}>
                <option value="fridge">Fridge</option>
                <option value="freezer">Freezer</option>
                <option value="pantry">Pantry</option>
              </select>
            </Field>
            <Field label="Expiration"><input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} className={inputCls} /></Field>
            <Field label="Purchased"><input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className={inputCls} /></Field>
            <Field label="Cost ($)"><input type="number" step="0.01" min={0} value={costAtPurchase} onChange={(e) => setCostAtPurchase(e.target.value)} className={inputCls} /></Field>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-line-soft">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={submit}>Add</Button>
        </div>
      </div>
    </div>
  );
}

const inputCls = "h-9 w-full rounded-[10px] border border-line bg-surface-2 px-2.5 text-[13px] text-ink-1 outline-none focus:border-accent";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">{label}</label>
      {children}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-[10px] text-[13px] ${active ? "bg-accent-soft text-accent-ink" : "text-ink-2 hover:bg-surface-2"}`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Wire into `Pantry.tsx`**

```typescript
import AddItemModal from "../components/pantry/AddItemModal";

const [showAddModal, setShowAddModal] = useState(false);

// Replace the no-op onClick on the "Add item" button:
<Button variant="primary" icon={Plus} onClick={() => setShowAddModal(true)}>Add item</Button>

// Render at end:
{showAddModal && <AddItemModal onClose={() => setShowAddModal(false)} onAdded={load} />}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/pantry/AddItemModal.tsx client/src/pages/Pantry.tsx
git commit -m "feat(client): AddItemModal with existing/new ingredient tabs"
```

---

## Phase 9 — Client: delete + undo + density-missing prompt

### Task 23: Undo toast wired into deletes

**Files:**
- Modify: `client/src/components/pantry/PantryDrawer.tsx`
- Verify: `client/src/components/ui/Toast.tsx` supports an action button (action label + onClick)

- [ ] **Step 1: Inspect `Toast.tsx` and add an action button if not already present**

Read `client/src/components/ui/Toast.tsx`. If `ToastData` doesn't already have an `action?: { label: string; onClick: () => void }`, extend it to include one and render a button on the right side of the toast that fires `action.onClick()` when clicked.

If the change is non-trivial, do it as a small standalone commit before continuing this task.

- [ ] **Step 2: Use the toast inside the drawer's delete handler**

```typescript
import { useToast } from "../ui/ToastProvider";
import { restoreBatch } from "../../api/pantry";

// inside PantryDrawer:
const showToast = useToast();

// the delete handler becomes:
onDelete={async () => {
  await deleteBatch(b.id);
  onChanged();
  showToast({
    kind: "info",
    message: `Deleted ${b.quantity} ${b.unit} of ${card.ingredient.name}.`,
    durationMs: 10000,
    action: {
      label: "Undo",
      onClick: async () => {
        await restoreBatch(b.id);
        onChanged();
      },
    },
  });
}}
```

(`kind` and `durationMs` are placeholders for the actual `ToastData` shape — match what `Toast.tsx` expects.)

- [ ] **Step 3: Commit**

```bash
git add client/src/components/pantry/PantryDrawer.tsx client/src/components/ui/Toast.tsx client/src/components/ui/ToastProvider.tsx
git commit -m "feat(client): undo toast for soft-deleted pantry batches"
```

---

### Task 24: Density-missing prompt when conversion errors surface

**Files:**
- Modify: `server/src/routes/pantry.ts` — surface `UnitConversionError` as 409 with structured body
- Modify: `client/src/components/pantry/PantryDrawer.tsx` — handle 409 by prompting

- [ ] **Step 1: Surface the error from `deductIngredientsForMeal` callers**

This needs server-side wiring wherever `deductIngredientsForMeal` is called from a route. Find callers:

```
git grep -n "deductIngredientsForMeal" server/src
```

For the route(s) that call it, on a `UnitConversionError`, return:

```typescript
res.status(409).json({
  code: "DENSITY_MISSING",
  ingredientId: e.ingredientId,
  fromUnit: e.fromUnit,
  toUnit: e.toUnit,
  missing: e.missing,
});
```

(Note: the current `selectBatchesToDrain` *catches* `UnitConversionError` and records it as a shortfall. For the prompt UX, change it: don't catch in the deduction path; let it bubble. The route shapes the response.)

Actually a cleaner split: keep the catch in `deductIngredientsForMeal` (so the meal-cooked flow still completes for other ingredients), but return the *converted* shortfalls including a `densityMissing: boolean` per shortfall. Update the response shape:

```typescript
return { shortfalls }; // each shortfall now also has missing?: "densityGPerMl" | "gramsPerCount"
```

The client decides what to do with each.

- [ ] **Step 2: Add a `DensityMissingPrompt` component**

```typescript
// client/src/components/pantry/DensityMissingPrompt.tsx
import { useState } from "react";
import type { Ingredient } from "../../api/ingredients";
import { updateIngredient } from "../../api/ingredients";
import Button from "../ui/Button";

interface Props {
  ingredient: Ingredient;
  missing: "densityGPerMl" | "gramsPerCount";
  fromUnit: string;
  toUnit: string;
  onResolved: () => void;
  onSkip: () => void;
}

export default function DensityMissingPrompt({ ingredient, missing, fromUnit, toUnit, onResolved, onSkip }: Props) {
  const [value, setValue] = useState("");

  const save = async () => {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) return;
    await updateIngredient(ingredient.id, { [missing]: v } as any);
    onResolved();
  };

  return (
    <div className="bg-surface-2 border border-warn-line rounded-[10px] p-3 flex flex-col gap-2 text-[13px] text-ink-1">
      <div>Need to convert {fromUnit} ↔ {toUnit} for <span className="capitalize">{ingredient.name}</span>.</div>
      <div className="text-[11.5px] text-ink-3">
        Set {missing === "densityGPerMl" ? "density (g per mL)" : "grams per count"} to enable cross-unit math.
      </div>
      <div className="flex items-center gap-2">
        <input type="number" step="0.001" value={value} onChange={(e) => setValue(e.target.value)} placeholder={missing === "densityGPerMl" ? "e.g. 0.529" : "e.g. 50"} className="h-8 w-32 rounded-[8px] border border-line bg-surface-1 px-2 text-[13px]" />
        <Button variant="primary" size="sm" onClick={save}>Save</Button>
        <Button variant="ghost" size="sm" onClick={onSkip}>Skip for now</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Render the prompt in the drawer when the card has `partialTotal`**

```typescript
// in PantryDrawer.tsx, near the Summary section:
{card.partialTotal && (
  <DensityMissingPrompt
    ingredient={card.ingredient}
    // Best-effort guess: pick the first missing field implied by the batches.
    missing={card.ingredient.densityGPerMl == null ? "densityGPerMl" : "gramsPerCount"}
    fromUnit={card.batches[0]?.unit ?? "?"}
    toUnit={card.ingredient.defaultUnit}
    onResolved={onChanged}
    onSkip={() => {/* dismiss locally — the prompt can have a hidden flag in localStorage if you want */}}
  />
)}
```

- [ ] **Step 4: Commit**

```bash
git add server/src/services/pantryService.ts server/src/routes/pantry.ts client/src/components/pantry/DensityMissingPrompt.tsx client/src/components/pantry/PantryDrawer.tsx
git commit -m "feat(client): density-missing prompt when conversion fails"
```

---

## Phase 10 — Receipt integration polish

### Task 25: Surface suggested expiration in the receipt review modal

**Files:**
- Modify: `server/src/services/receiptService.ts` — `parseReceipt` already returns `defaultUnitGuess`; extend to also return a suggested expiration when the matched ingredient has shelf-life
- Modify: `client/src/api/receipts.ts` — add `suggestedExpiration` to `ParsedReceiptItem`
- Modify: `client/src/components/AddFromReceiptModal.tsx` — show the suggestion as the default expiration in the review row

- [ ] **Step 1: Server: enrich each item with a suggested expiration on the parse response**

In `server/src/services/receiptService.ts`, after the matching loop in `parseReceipt`, look up shelf-life for the matched ingredient and produce a `suggestedExpiration` ISO date based on `tripDate + shelfLifeXDays` for the `locationGuess`.

```typescript
const matchedIngredients = await prisma.ingredient.findMany({
  where: { id: { in: parsed.items.map((i) => i.ingredientId).filter((x): x is number => x != null) } },
});
const byId = new Map(matchedIngredients.map((i) => [i.id, i]));

for (const item of parsed.items) {
  if (item.ingredientId == null || !item.locationGuess) {
    (item as any).suggestedExpiration = null;
    continue;
  }
  const ing = byId.get(item.ingredientId);
  if (!ing) { (item as any).suggestedExpiration = null; continue; }
  const days =
    item.locationGuess === "fridge" ? ing.shelfLifeFridgeDays
    : item.locationGuess === "freezer" ? ing.shelfLifeFreezerDays
    : ing.shelfLifePantryDays;
  if (days == null) { (item as any).suggestedExpiration = null; continue; }
  const tripDate = new Date(parsed.tripDate);
  const exp = new Date(tripDate.getTime() + days * 86400000);
  (item as any).suggestedExpiration = exp.toISOString().slice(0, 10);
}
```

Update the `ParsedReceiptItem` type in `parseReceiptPayload` (or wherever it's typed) to include `suggestedExpiration: string | null`.

- [ ] **Step 2: Client: extend the type and use it in the review modal**

In `client/src/api/receipts.ts`:

```typescript
export interface ParsedReceiptItem {
  // ...existing fields...
  suggestedExpiration?: string | null;
}
```

In `client/src/components/AddFromReceiptModal.tsx` — the review stage already lets the user edit each line. For each row, if `expirationDate` isn't already set in the edit state, default to `item.suggestedExpiration`. Look for where the per-item edit state is initialized and apply:

```typescript
expirationDate: item.suggestedExpiration ?? null,
```

- [ ] **Step 3: Smoke test**

Open `/pantry`, click "Add from receipt," paste a sample receipt (or use an existing one), verify each line in the review has an auto-suggested expiration when the ingredient has `shelfLifeXDays`. Commit and verify the resulting `pantry_items` rows have the right `expiration_date`.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/receiptService.ts client/src/api/receipts.ts client/src/components/AddFromReceiptModal.tsx
git commit -m "feat: suggest expiration in receipt review based on shelf-life"
```

---

## Phase 11 — Shopping list nudge

### Task 26: Server — extend shopping endpoint with running-low suggestions

**Files:**
- Modify: `server/src/services/shoppingService.ts`
- Modify: `server/src/routes/shopping.ts`

- [ ] **Step 1: Add a `getLowStockSuggestions` function**

```typescript
// in server/src/services/shoppingService.ts
import { aggregateCards } from "./pantryAggregation.js";

export async function getLowStockSuggestions() {
  const [ingredientRows, batchRows] = await Promise.all([
    prisma.ingredient.findMany({ where: { isOneOff: false } }),
    prisma.pantryBatch.findMany({ where: { consumedAt: null } }),
  ]);
  const cards = aggregateCards({ ingredients: ingredientRows, batches: batchRows });
  return cards
    .filter((c) => c.isLowStock)
    .map((c) => ({
      ingredientId: c.ingredient.id,
      name: c.ingredient.name,
      currentQty: c.canonicalTotal?.qty ?? 0,
      currentUnit: c.canonicalTotal?.unit ?? c.ingredient.defaultUnit,
      threshold: c.ingredient.lowStockThreshold,
      thresholdUnit: c.ingredient.lowStockUnit,
    }));
}
```

- [ ] **Step 2: Expose via a route**

```typescript
// in server/src/routes/shopping.ts
router.get("/low-stock", async (_req, res) => {
  const suggestions = await shoppingService.getLowStockSuggestions();
  res.json(suggestions);
});
```

- [ ] **Step 3: Smoke test**

```
curl http://localhost:3001/api/shopping/low-stock
```
Expected: 200, JSON array.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/shoppingService.ts server/src/routes/shopping.ts
git commit -m "feat(server): /api/shopping/low-stock suggestions"
```

---

### Task 27: Client — render running-low section on the shopping page

**Files:**
- Modify: `client/src/api/shopping.ts` (path approximation; verify)
- Modify: `client/src/pages/ShoppingList.tsx` (path approximation; verify)

- [ ] **Step 1: Find the shopping page and API client**

```
git grep -l "shopping" client/src
```

Locate the existing shopping page and API. Add `getLowStockSuggestions()` to the API client:

```typescript
// client/src/api/shopping.ts (or wherever)
export interface LowStockSuggestion {
  ingredientId: number;
  name: string;
  currentQty: number;
  currentUnit: string;
  threshold: number | null;
  thresholdUnit: string | null;
}
export const getLowStockSuggestions = () =>
  apiFetch<LowStockSuggestion[]>("/shopping/low-stock");
```

- [ ] **Step 2: Render a "Running low" section above the existing shopping list**

In the shopping page, fetch `getLowStockSuggestions()` and render a small section listing the ingredients with a one-tap "+ Add to list" button per row that calls the existing add-to-shopping-list endpoint (find it in the same file). When added, optimistically remove the row from the suggestions section. A simple "Hide" button per row dismisses the suggestion locally for the session (no persistence).

(Implementation detail varies based on how the existing shopping page is structured — read it first, then add the section in-style.)

- [ ] **Step 3: Smoke test**

Set `lowStockThreshold` on a few ingredients via the drawer's IngredientEditForm, drain the pantry below those thresholds, navigate to the shopping page, verify the suggestions appear and "+ Add to list" works.

- [ ] **Step 4: Commit**

```bash
git add client/src/api/shopping.ts client/src/pages/ShoppingList.tsx
git commit -m "feat(client): running-low suggestions on shopping page"
```

---

## Phase 12 — Cleanup

### Task 28: Remove orphaned merge logic and dead code

**Files:**
- Possibly delete: helpers in `server/src/services/receiptService.ts` (`computeMergeDecision`, `IncomingPantryRow`, `ExistingPantryItem`) and their tests if no longer referenced.

- [ ] **Step 1: Find dead references**

```
git grep -n "computeMergeDecision\|IncomingPantryRow\|ExistingPantryItem" server/src
```

If only the definition sites and their tests remain (no callers), delete them. If they have other callers, leave them.

- [ ] **Step 2: Remove the legacy `Pantry.tsx` field-level Add Item form code**

After Task 22, the inline "Add item" expansion in `Pantry.tsx` is dead. Confirm the page now uses `AddItemModal` exclusively. Remove any leftover `Field` component definition or `LOC_ICONS`/`CATEGORY_LABELS` maps in `Pantry.tsx` that are no longer referenced.

- [ ] **Step 3: Run all tests**

```
cd server && npx vitest run
cd ../client && npm run build
```
Expected: green.

- [ ] **Step 4: Manual end-to-end smoke**

In the dev environment:

1. Open `/pantry`. Confirm grid renders, filters/sort/search work.
2. Add a new ingredient via the modal (toggle isOneOff and try one of each). Verify cards appear.
3. Open a card, edit ingredient defaults (set shelf-life and threshold). Save.
4. Add another batch via the drawer. Verify it appears.
5. Edit a batch's quantity, unit, expiration, tags. Save.
6. Mark `use_first` on one of two batches; cook a meal that uses that ingredient; verify the use_first batch is drained.
7. Delete a batch. Confirm Undo toast restores it.
8. Add from receipt: commit a 3-line receipt, verify each line creates a fresh batch with purchase date and cost.
9. Drop an ingredient below `lowStockThreshold`. Verify the "Low" pill on the card and the suggestion on the shopping list.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: cleanup after pantry overhaul"
```

---

## Self-review notes (post-write)

- All spec sections covered: data model (Tasks 1, 2), card aggregation (3, 4), batch CRUD (5, 6, 7), ingredient PATCH (8), deduction (9), receipt commit (10), purge job (11), client API (12, 13), grid/cards (14, 15, 16), drawer + edits (17–21), add modal (22), undo (23), density prompt (24), receipt expiration (25), low-stock nudge (26, 27), cleanup (28).
- Tag presets agree across BatchEditForm (`use_first`, `opened`, `thawing`) and the FEFO selector (`use_first`).
- API client method names match server routes: `createBatch` → `POST /pantry/batches`, `updateBatch` → `PATCH /pantry/batches/:id`, `deleteBatch` → `DELETE /pantry/batches/:id`, `restoreBatch` → `POST /pantry/batches/:id/restore`.
- `PantryCard` (TypeScript type) lives in both server (`pantryAggregation.ts`) and client (`api/pantry.ts`); shapes match field-for-field.
- Two shape mismatches to watch during execution: (a) Decimal serialization — server returns Prisma `Decimal` as string in JSON; client `costAtPurchase` is typed as `string | null` and parsed via `parseFloat` in `BatchRow`. (b) Dates — server returns `Date` as ISO string; client treats them as strings and `new Date(...)`'s when needed.
- Open follow-ups (deferred to follow-up tasks, not in this plan): vetted ingredient density seed; cleanup of zero-batch one-off ingredients; consumption-history view.
