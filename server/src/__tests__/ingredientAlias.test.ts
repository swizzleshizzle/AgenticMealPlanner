import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import ingredientsRouter from "../routes/ingredients.js";

const prisma = new PrismaClient();
const app = express();
app.use(express.json());
app.use("/ingredients", ingredientsRouter);

async function reset() {
  // Full FK-ordered wipe (other suites leave rows behind; the serial runner
  // shares one DB). Everything referencing ingredient must go before it.
  await prisma.shoppingItem.deleteMany();
  await prisma.plannedMeal.deleteMany();
  await prisma.weeklyPlan.deleteMany();
  await prisma.pantryBatch.deleteMany();
  await prisma.mealIngredient.deleteMany();
  await prisma.meal.deleteMany();
  await prisma.ingredientAlias.deleteMany();
  await prisma.ingredient.deleteMany();
}

describe("ingredient alias routes", () => {
  beforeEach(reset);

  it("POST /ingredients/aliases upserts an alias (lowercased)", async () => {
    const tomato = await prisma.ingredient.create({ data: { name: "tomato", defaultUnit: "g" } });
    const res = await request(app).post("/ingredients/aliases").send({ alias: "Diced Tomato", ingredientId: tomato.id });
    expect(res.status).toBe(201);
    const row = await prisma.ingredientAlias.findUnique({ where: { alias: "diced tomato" } });
    expect(row?.ingredientId).toBe(tomato.id);
  });

  it("POST is idempotent — re-pointing updates the target", async () => {
    const a = await prisma.ingredient.create({ data: { name: "tomato", defaultUnit: "g" } });
    const b = await prisma.ingredient.create({ data: { name: "roma tomato", defaultUnit: "g" } });
    await request(app).post("/ingredients/aliases").send({ alias: "diced tomato", ingredientId: a.id });
    await request(app).post("/ingredients/aliases").send({ alias: "diced tomato", ingredientId: b.id });
    const row = await prisma.ingredientAlias.findUnique({ where: { alias: "diced tomato" } });
    expect(row?.ingredientId).toBe(b.id);
  });

  it("DELETE /ingredients/aliases/:alias removes it (undo)", async () => {
    const tomato = await prisma.ingredient.create({ data: { name: "tomato", defaultUnit: "g" } });
    await prisma.ingredientAlias.create({ data: { alias: "diced tomato", ingredientId: tomato.id } });
    const res = await request(app).delete(`/ingredients/aliases/${encodeURIComponent("diced tomato")}`);
    expect(res.status).toBe(204);
    expect(await prisma.ingredientAlias.findUnique({ where: { alias: "diced tomato" } })).toBeNull();
  });

  it("POST 400s on a non-numeric ingredientId", async () => {
    const res = await request(app).post("/ingredients/aliases").send({ alias: "x", ingredientId: "nope" });
    expect(res.status).toBe(400);
  });
});
