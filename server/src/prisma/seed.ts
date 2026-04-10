import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const commonIngredients = [
  { name: "chicken breast", category: "protein" as const, defaultUnit: "lb" },
  { name: "ground beef", category: "protein" as const, defaultUnit: "lb" },
  { name: "salmon", category: "protein" as const, defaultUnit: "oz" },
  { name: "garlic", category: "produce" as const, defaultUnit: "cloves" },
  { name: "onion", category: "produce" as const, defaultUnit: "count" },
  { name: "bell pepper", category: "produce" as const, defaultUnit: "count" },
  { name: "broccoli", category: "produce" as const, defaultUnit: "cups" },
  { name: "rice", category: "grain" as const, defaultUnit: "cups" },
  { name: "pasta", category: "grain" as const, defaultUnit: "oz" },
  { name: "olive oil", category: "pantry_staple" as const, defaultUnit: "tbsp" },
  { name: "salt", category: "spice" as const, defaultUnit: "tsp" },
  { name: "black pepper", category: "spice" as const, defaultUnit: "tsp" },
  { name: "soy sauce", category: "condiment" as const, defaultUnit: "tbsp" },
  { name: "butter", category: "dairy" as const, defaultUnit: "tbsp" },
  { name: "milk", category: "dairy" as const, defaultUnit: "cups" },
  { name: "cheddar cheese", category: "dairy" as const, defaultUnit: "cups" },
  { name: "eggs", category: "protein" as const, defaultUnit: "count" },
  { name: "tomato", category: "produce" as const, defaultUnit: "count" },
  { name: "spinach", category: "produce" as const, defaultUnit: "cups" },
  { name: "lemon", category: "produce" as const, defaultUnit: "count" },
];

async function main() {
  console.log("Seeding common ingredients...");
  for (const ing of commonIngredients) {
    await prisma.ingredient.upsert({
      where: { name: ing.name },
      update: {},
      create: ing,
    });
  }
  console.log(`Seeded ${commonIngredients.length} ingredients.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
