import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { createBatch } from "../../services/pantryBatchService.js";
import type { ToolDef } from "../types.js";


const LocationEnum = z.enum(["fridge", "freezer", "pantry"]);

const getPantry: ToolDef = {
  name: "get_pantry",
  description:
    "List unconsumed pantry batches. Optional filters: location (fridge|freezer|pantry), category, search query (matches ingredient name), expiringWithinDays (only batches expiring on or before that many days from today).",
  schema: z.object({
    location: LocationEnum.optional(),
    category: z.string().optional(),
    q: z.string().optional(),
    expiringWithinDays: z.number().int().positive().optional(),
  }),
  handler: async (input) => {
    const where: any = { consumedAt: null };
    if (input.location) where.location = input.location;
    if (input.category || input.q) {
      where.ingredient = {};
      if (input.category) where.ingredient.category = input.category;
      if (input.q) where.ingredient.name = { contains: input.q, mode: "insensitive" };
    }
    if (input.expiringWithinDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + input.expiringWithinDays);
      where.expirationDate = { not: null, lte: cutoff };
    }
    const rows = await prisma.pantryBatch.findMany({
      where,
      include: { ingredient: true },
      orderBy: [{ expirationDate: "asc" }, { id: "asc" }],
      take: 100,
    });
    return {
      batches: rows.map((b) => ({
        id: b.id,
        ingredientId: b.ingredientId,
        ingredientName: b.ingredient.name,
        quantity: b.quantity,
        unit: b.unit,
        location: b.location,
        expirationDate: b.expirationDate?.toISOString().slice(0, 10) ?? null,
        purchaseDate: b.purchaseDate?.toISOString().slice(0, 10) ?? null,
      })),
    };
  },
};

const addPantryBatch: ToolDef = {
  name: "add_pantry_batch",
  description:
    "Add a new pantry batch. Either ingredientId (for an existing ingredient) OR newIngredient (to create one) must be provided.",
  schema: z
    .object({
      ingredientId: z.number().int().optional(),
      newIngredient: z
        .object({
          name: z.string(),
          category: z.string(),
          defaultUnit: z.string(),
        })
        .optional(),
      quantity: z.number().positive(),
      unit: z.string(),
      location: LocationEnum,
      expirationDate: z.string().optional(),
      purchaseDate: z.string().optional(),
      costAtPurchase: z.number().optional(),
    })
    .refine((v) => v.ingredientId != null || v.newIngredient != null, {
      message: "Must provide ingredientId or newIngredient",
    }),
  handler: async (input) => {
    const batch = await createBatch({
      ingredientId: input.ingredientId,
      newIngredient: input.newIngredient,
      quantity: input.quantity,
      unit: input.unit,
      location: input.location,
      expirationDate: input.expirationDate ?? null,
      purchaseDate: input.purchaseDate ?? null,
      costAtPurchase: input.costAtPurchase ?? null,
    });
    return { batch };
  },
};

export const pantryTools: ToolDef[] = [getPantry, addPantryBatch];
