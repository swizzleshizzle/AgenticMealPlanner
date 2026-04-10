import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function getAllPantryItems() {
  return prisma.pantryItem.findMany({
    include: { ingredient: true },
    orderBy: { ingredient: { name: "asc" } },
  });
}

export async function addPantryItem(data: {
  ingredientId: number;
  quantity: number;
  unit: string;
  location: "fridge" | "freezer" | "pantry";
  expirationDate?: string;
}) {
  return prisma.pantryItem.create({
    data: {
      ingredientId: data.ingredientId,
      quantity: data.quantity,
      unit: data.unit,
      location: data.location,
      expirationDate: data.expirationDate ? new Date(data.expirationDate) : undefined,
    },
    include: { ingredient: true },
  });
}

export async function updatePantryItem(id: number, data: { quantity?: number; location?: "fridge" | "freezer" | "pantry" }) {
  return prisma.pantryItem.update({
    where: { id },
    data,
    include: { ingredient: true },
  });
}

export async function deletePantryItem(id: number) {
  return prisma.pantryItem.delete({ where: { id } });
}

export async function deductIngredientsForMeal(mealId: number, servingMultiplier: number) {
  const mealIngredients = await prisma.mealIngredient.findMany({
    where: { mealId },
  });

  for (const mi of mealIngredients) {
    const needed = mi.quantity * servingMultiplier;
    const pantryItems = await prisma.pantryItem.findMany({
      where: { ingredientId: mi.ingredientId },
      orderBy: { expirationDate: "asc" },
    });

    let remaining = needed;
    for (const item of pantryItems) {
      if (remaining <= 0) break;
      if (item.quantity <= remaining) {
        remaining -= item.quantity;
        await prisma.pantryItem.delete({ where: { id: item.id } });
      } else {
        await prisma.pantryItem.update({
          where: { id: item.id },
          data: { quantity: item.quantity - remaining },
        });
        remaining = 0;
      }
    }
  }
}
