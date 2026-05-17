// This test wipes shopping-related tables via prisma.*.deleteMany() in beforeEach.
// Only safe against mealplanner_test — vitest.config.ts loads .env.test
// automatically; do NOT run against mealplanner (the real dev DB).
import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  listCustomShoppingItems,
  createCustomShoppingItem,
  updateCustomShoppingItem,
  deleteCustomShoppingItem,
  CustomShoppingItemValidationError,
  generateShoppingList,
} from "../services/shoppingService.js";

const prisma = new PrismaClient();

async function reset() {
  await prisma.customShoppingItem.deleteMany();
  await prisma.shoppingItem.deleteMany();
  await prisma.plannedMeal.deleteMany();
  await prisma.weeklyPlan.deleteMany();
  await prisma.pantryBatch.deleteMany();
  await prisma.mealIngredient.deleteMany();
  // meals can't be deleted via ORM cleanly due to a cross-branch recipe_id constraint —
  // see cookConfirmRoute.test.ts. Future tests that create meals should use raw SQL.
  await prisma.ingredient.deleteMany();
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
    // Force a clearly-later createdAt so we don't depend on clock resolution.
    await prisma.customShoppingItem.create({
      data: {
        planId: plan.id,
        name: "second",
        createdAt: new Date(Date.now() + 1000),
      },
    });
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