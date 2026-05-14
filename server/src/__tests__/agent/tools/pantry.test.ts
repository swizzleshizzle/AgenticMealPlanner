import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { pantryTools } from "../../../agent/tools/pantry.js";

const prisma = new PrismaClient();
const ctx = { pageContext: {} };
const getPantry = pantryTools.find((t) => t.name === "get_pantry")!;
const addBatch = pantryTools.find((t) => t.name === "add_pantry_batch")!;

async function seedIngredient(name: string) {
  return prisma.ingredient.upsert({
    where: { name },
    update: {},
    create: { name, category: "produce", defaultUnit: "count" },
  });
}

describe("get_pantry tool", () => {
  beforeEach(async () => {
    await prisma.pantryBatch.deleteMany({ where: { ingredient: { name: { startsWith: "test-" } } } });
    await prisma.ingredient.deleteMany({ where: { name: { startsWith: "test-" } } });
  });

  it("returns batches with their ingredient name", async () => {
    const onion = await seedIngredient("test-onion");
    await prisma.pantryBatch.create({
      data: { ingredientId: onion.id, quantity: 3, unit: "count", location: "pantry" },
    });
    const result: any = await getPantry.handler({}, ctx);
    const found = result.batches.find((b: any) => b.ingredientName === "test-onion");
    expect(found).toBeDefined();
    expect(found.quantity).toBe(3);
  });

  it("filters by location when location is provided", async () => {
    const onion = await seedIngredient("test-onion");
    await prisma.pantryBatch.create({
      data: { ingredientId: onion.id, quantity: 3, unit: "count", location: "pantry" },
    });
    await prisma.pantryBatch.create({
      data: { ingredientId: onion.id, quantity: 1, unit: "count", location: "fridge" },
    });
    const result: any = await getPantry.handler({ location: "fridge" }, ctx);
    expect(result.batches.every((b: any) => b.location === "fridge")).toBe(true);
    expect(result.batches.find((b: any) => b.ingredientName === "test-onion")).toBeDefined();
  });
});

describe("add_pantry_batch tool", () => {
  beforeEach(async () => {
    await prisma.pantryBatch.deleteMany({ where: { ingredient: { name: { startsWith: "test-" } } } });
    await prisma.ingredient.deleteMany({ where: { name: { startsWith: "test-" } } });
  });

  it("creates a batch for an existing ingredient", async () => {
    const milk = await seedIngredient("test-milk");
    const result: any = await addBatch.handler(
      { ingredientId: milk.id, quantity: 1, unit: "gallon", location: "fridge" },
      ctx,
    );
    expect(result.batch.ingredientId).toBe(milk.id);
    expect(result.batch.quantity).toBe(1);
  });

  it("creates an ingredient + batch when newIngredient is given", async () => {
    const result: any = await addBatch.handler(
      {
        newIngredient: { name: "test-milk", category: "dairy", defaultUnit: "gallon" },
        quantity: 1,
        unit: "gallon",
        location: "fridge",
      },
      ctx,
    );
    expect(result.batch.ingredient.name).toBe("test-milk");
  });
});
