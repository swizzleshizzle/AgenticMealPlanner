import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function generateShoppingList(planId: number) {
  // Clear existing list for this plan
  await prisma.shoppingItem.deleteMany({ where: { planId } });

  // Get all planned meals with their ingredients
  const plannedMeals = await prisma.plannedMeal.findMany({
    where: { planId, status: { in: ["planned", "cooked"] } },
    include: { meal: { include: { ingredients: true } } },
  });

  // Aggregate needed quantities per ingredient
  const needed = new Map<number, { quantity: number; unit: string }>();

  for (const pm of plannedMeals) {
    const scaleFactor = pm.servings / pm.meal.servings;
    for (const mi of pm.meal.ingredients) {
      const existing = needed.get(mi.ingredientId);
      const qty = mi.quantity * scaleFactor;
      if (existing) {
        existing.quantity += qty;
      } else {
        needed.set(mi.ingredientId, { quantity: qty, unit: mi.unit });
      }
    }
  }

  // Get pantry quantities
  const pantryItems = await prisma.pantryItem.findMany();
  const onHand = new Map<number, number>();
  for (const item of pantryItems) {
    onHand.set(item.ingredientId, (onHand.get(item.ingredientId) || 0) + item.quantity);
  }

  // Create shopping items
  const items = [];
  for (const [ingredientId, { quantity }] of needed) {
    const qtyOnHand = onHand.get(ingredientId) || 0;
    const qtyToBuy = Math.max(0, quantity - qtyOnHand);

    items.push({
      planId,
      ingredientId,
      quantityNeeded: quantity,
      quantityOnHand: qtyOnHand,
      quantityToBuy: qtyToBuy,
    });
  }

  await prisma.shoppingItem.createMany({ data: items });

  return prisma.shoppingItem.findMany({
    where: { planId },
    include: { ingredient: true },
    orderBy: { ingredient: { category: "asc" } },
  });
}

export async function getShoppingList(planId: number) {
  return prisma.shoppingItem.findMany({
    where: { planId },
    include: { ingredient: true },
    orderBy: { ingredient: { category: "asc" } },
  });
}

export async function toggleShoppingItem(id: number, checked: boolean) {
  return prisma.shoppingItem.update({
    where: { id },
    data: { checked },
    include: { ingredient: true },
  });
}
