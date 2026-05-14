// DESTRUCTIVE-CLEANUP-SKIPPED: these tests use unscoped prisma.*.deleteMany()
// which wipes the entire dev DB. describe.skip() until a dedicated test DB exists.
// To re-enable: point DATABASE_URL at a throwaway DB, then remove the .skip suffixes.
import { describe, it, expect, beforeEach } from "vitest";
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

  // Cross-branch DB contamination: meals table has a recipe_id NOT NULL column
  // from another agent's migration that isn't reflected in this branch's schema.
  // Use raw SQL to satisfy the constraint without needing a real FK target.
  const mealRows = await prisma.$queryRaw<Array<{ id: number }>>`
    INSERT INTO meals (name, servings, created_at, updated_at, recipe_id)
    VALUES ('Stir fry', 4, NOW(), NOW(), 1)
    RETURNING id
  `;
  const mealId = mealRows[0].id;
  await prisma.mealIngredient.createMany({
    data: [
      { mealId, ingredientId: chicken.id, quantity: 400, unit: "g" },
      { mealId, ingredientId: soy.id, quantity: 30, unit: "ml" },
    ],
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
      mealId,
      day: "monday",
      mealSlot: "dinner",
      servings: 2,
      cookStyle: "cook_fresh",
      status: "planned",
    },
  });
  return { chicken, soy, mealId, plan, pm };
}

describe.skip("PUT /api/plans/:planId/meals/:mealId — cooked transition with overrides", () => {
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
    expect(res.body.error).toBe("overrides only accepted with status=cooked");
  });

  it("rejects non-array overrides with 400", async () => {
    const { plan, pm } = await seed();

    const res = await request(app)
      .put(`/api/plans/${plan.id}/meals/${pm.id}`)
      .send({
        status: "cooked",
        overrides: "not-an-array",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("overrides must be an array");
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
    expect(res.body.error).toBe("duplicate ingredientId in overrides");
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
    expect(res.body.error).toBe("invalid override row");
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
    expect(res.body.error).toBe("unknown ingredientId in overrides");
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

    // Second update: cooked -> cooked. Should NOT deduct again.
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

  it("returns 404 when the planned meal does not exist", async () => {
    const { plan } = await seed();

    const res = await request(app)
      .put(`/api/plans/${plan.id}/meals/99999`)
      .send({ status: "cooked" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Planned meal not found" });
  });
});
