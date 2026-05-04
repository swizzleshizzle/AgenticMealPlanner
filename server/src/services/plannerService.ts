import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const planWithMeals = {
  plannedMeals: {
    include: { meal: { include: { ingredients: { include: { ingredient: true } } } } },
    orderBy: [{ day: "asc" as const }, { mealSlot: "asc" as const }],
  },
};

export async function getAllPlans() {
  return prisma.weeklyPlan.findMany({
    include: planWithMeals,
    orderBy: { weekStartDate: "desc" },
  });
}

export async function getPlanById(id: number) {
  return prisma.weeklyPlan.findUnique({
    where: { id },
    include: planWithMeals,
  });
}

export async function createPlan(weekStartDate: string) {
  return prisma.weeklyPlan.create({
    data: { weekStartDate: new Date(weekStartDate) },
    include: planWithMeals,
  });
}

export async function updatePlan(id: number, data: { status?: string }) {
  return prisma.weeklyPlan.update({
    where: { id },
    data: data as any,
    include: planWithMeals,
  });
}

export async function addPlannedMeal(planId: number, data: {
  mealId: number;
  day: string;
  mealSlot: string;
  servings: number;
  cookStyle: "cook_fresh" | "batch_prep" | "leftovers";
}) {
  return prisma.plannedMeal.create({
    data: { planId, ...data } as any,
    include: { meal: { include: { ingredients: { include: { ingredient: true } } } } },
  });
}

export async function updatePlannedMeal(id: number, data: {
  status?: string;
  mealId?: number;
  servings?: number;
  cookStyle?: "cook_fresh" | "batch_prep" | "leftovers";
}) {
  return prisma.plannedMeal.update({
    where: { id },
    data: data as any,
    include: { meal: { include: { ingredients: { include: { ingredient: true } } } } },
  });
}

export async function removePlannedMeal(id: number) {
  return prisma.plannedMeal.delete({ where: { id } });
}
