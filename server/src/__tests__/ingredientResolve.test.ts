import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resolveIngredientId, resolveOrCreateIngredientId } from "../services/ingredientResolve.js";

const prisma = new PrismaClient();

const existing = [
  { id: 1, name: "tomato" },
  { id: 2, name: "chicken thigh" },
];

describe("resolveIngredientId (pure)", () => {
  it("returns an alias target first", () => {
    const aliasMap = new Map<string, number>([["diced tomato", 1]]);
    expect(resolveIngredientId("diced tomato", existing, aliasMap)).toEqual({ id: 1, source: "alias" });
  });

  it("returns a confident fuzzy match", () => {
    // "organic" is a known descriptor → after noise removal only "tomato" → high.
    expect(resolveIngredientId("organic tomato", existing, new Map())).toEqual({ id: 1, source: "fuzzy" });
  });

  it("returns null when nothing matches confidently", () => {
    expect(resolveIngredientId("saffron", existing, new Map())).toBeNull();
  });

  it("a low-confidence fuzzy match is treated as no match (caller creates new)", () => {
    // "diced tomato" has the extra content word "diced" → low confidence → null.
    expect(resolveIngredientId("diced tomato", existing, new Map())).toBeNull();
  });
});

describe("resolveOrCreateIngredientId (DB)", () => {
  beforeEach(async () => {
    await prisma.ingredientAlias.deleteMany({ where: { ingredient: { name: { startsWith: "test-" } } } });
    await prisma.ingredient.deleteMany({ where: { name: { startsWith: "test-" } } });
  });

  it("returns an existing id on a confident match (no new row)", async () => {
    const tomato = await prisma.ingredient.create({ data: { name: "test-tomato", defaultUnit: "g" } });
    const existing = [{ id: tomato.id, name: tomato.name }];
    const before = await prisma.ingredient.count({ where: { name: { startsWith: "test-" } } });

    const id = await resolveOrCreateIngredientId({ name: "test-tomato", unit: "g" }, existing, new Map());

    expect(id).toBe(tomato.id);
    expect(await prisma.ingredient.count({ where: { name: { startsWith: "test-" } } })).toBe(before);
  });

  it("creates a new canonical ingredient when nothing matches", async () => {
    const existing: { id: number; name: string }[] = [];
    const id = await resolveOrCreateIngredientId(
      { name: "test-firm-tofu", category: "protein", unit: "g" },
      existing,
      new Map(),
    );
    const row = await prisma.ingredient.findUnique({ where: { id } });
    expect(row?.name).toBe("test-firm-tofu");
    expect(row?.category).toBe("protein");
    // mutates `existing` so later lines in the same batch can match it
    expect(existing.some((e) => e.id === id)).toBe(true);
  });

  it("reuses a just-created ingredient for a later identical line", async () => {
    const existing: { id: number; name: string }[] = [];
    const aliasMap = new Map<string, number>();
    const id1 = await resolveOrCreateIngredientId({ name: "test-miso", category: "condiment", unit: "g" }, existing, aliasMap);
    const id2 = await resolveOrCreateIngredientId({ name: "test-miso", category: "condiment", unit: "g" }, existing, aliasMap);
    expect(id2).toBe(id1);
  });
});
