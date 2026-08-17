// Runs against the vitest DB (vitest loads .env.test). Wipes tables in reset().
import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { normalizeBatches } from "../services/pantryBatchService.js";

const prisma = new PrismaClient();

async function reset() {
  await prisma.pantryBatch.deleteMany();
  await prisma.ingredient.deleteMany();
}

describe("normalizeBatches", () => {
  beforeEach(reset);

  it("converts every convertible batch to the default unit and skips the rest", async () => {
    const ing = await prisma.ingredient.create({
      data: {
        name: "mayonnaise", category: "condiment", defaultUnit: "oz",
        densityGPerMl: 0.955,
      },
    });
    const [lb, flOz, pkg, already] = await Promise.all([
      prisma.pantryBatch.create({ data: { ingredientId: ing.id, quantity: 1, unit: "lb" } }),
      prisma.pantryBatch.create({ data: { ingredientId: ing.id, quantity: 60, unit: "fl oz" } }),
      prisma.pantryBatch.create({ data: { ingredientId: ing.id, quantity: 1, unit: "package" } }),
      prisma.pantryBatch.create({ data: { ingredientId: ing.id, quantity: 5, unit: "oz" } }),
    ]);

    const result = await normalizeBatches(ing.id);

    expect(result.normalized).toHaveLength(2); // lb + fl oz
    expect(result.skipped).toEqual([
      { batchId: pkg.id, unit: "package", reason: "containerSize" },
    ]);

    const rows = new Map(
      (await prisma.pantryBatch.findMany({ where: { ingredientId: ing.id } })).map((b) => [b.id, b]),
    );
    expect(rows.get(lb.id)).toMatchObject({ unit: "oz" });
    expect(rows.get(lb.id)!.quantity).toBeCloseTo(16, 4);
    expect(rows.get(flOz.id)).toMatchObject({ unit: "oz" });
    // 60 fl oz × 29.5735 mL × 0.955 g/mL ÷ 28.3495 g/oz ≈ 59.77 oz
    expect(rows.get(flOz.id)!.quantity).toBeCloseTo(59.77, 1);
    expect(rows.get(pkg.id)).toMatchObject({ unit: "package", quantity: 1 }); // untouched
    expect(rows.get(already.id)).toMatchObject({ unit: "oz", quantity: 5 }); // untouched
  });

  it("uses the package-size hint so container batches normalize when it exists", async () => {
    const ing = await prisma.ingredient.create({
      data: { name: "brioche bun", category: "grain", defaultUnit: "count", purchaseUnitQty: 8 },
    });
    const pkg = await prisma.pantryBatch.create({
      data: { ingredientId: ing.id, quantity: 0.25, unit: "package" },
    });

    const result = await normalizeBatches(ing.id);

    expect(result.skipped).toEqual([]);
    const row = await prisma.pantryBatch.findUnique({ where: { id: pkg.id } });
    expect(row).toMatchObject({ unit: "count" });
    expect(row!.quantity).toBeCloseTo(2, 5);
  });

  it("ignores consumed batches and rounds converted quantities", async () => {
    const ing = await prisma.ingredient.create({
      data: { name: "salt", category: "spice", defaultUnit: "oz" },
    });
    await prisma.pantryBatch.create({
      data: { ingredientId: ing.id, quantity: 1, unit: "lb", consumedAt: new Date() },
    });
    const g = await prisma.pantryBatch.create({
      data: { ingredientId: ing.id, quantity: 100, unit: "g" },
    });

    const result = await normalizeBatches(ing.id);

    expect(result.normalized).toHaveLength(1);
    const row = await prisma.pantryBatch.findUnique({ where: { id: g.id } });
    // 100 g = 3.5273961… oz — stored rounded, not with float dust.
    expect(row!.quantity).toBe(3.5274);
  });
});
