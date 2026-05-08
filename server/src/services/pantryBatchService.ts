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
