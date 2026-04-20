import { readdir, mkdir, rename } from "fs/promises";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { parseRecipeFromFile } from "../claude/recipeParser.js";

const prisma = new PrismaClient();

const SUPPORTED_EXTS = [".pdf", ".png", ".jpg", ".jpeg", ".webp"];

async function importOne(filePath: string) {
  const parsed = await parseRecipeFromFile(filePath);

  const ingredientMap = new Map<string, number>();
  for (const ing of parsed.ingredients) {
    const ingredient = await prisma.ingredient.upsert({
      where: { name: ing.name },
      update: {},
      create: {
        name: ing.name,
        category: ing.category as any,
        defaultUnit: ing.unit,
      },
    });
    ingredientMap.set(ing.name, ingredient.id);
  }

  const meal = await prisma.meal.create({
    data: {
      name: parsed.name,
      description: parsed.description,
      source: "hello_fresh",
      mealType: parsed.mealType,
      servings: parsed.servings,
      prepTime: parsed.prepTime ?? undefined,
      cookTime: parsed.cookTime ?? undefined,
      tags: parsed.tags,
      instructions: JSON.stringify(parsed.instructions),
      calories: parsed.calories ?? undefined,
      proteinG: parsed.proteinG ?? undefined,
      carbsG: parsed.carbsG ?? undefined,
      fatG: parsed.fatG ?? undefined,
      fiberG: parsed.fiberG ?? undefined,
      sodiumMg: parsed.sodiumMg ?? undefined,
      ingredients: {
        create: parsed.ingredients.map((ing) => ({
          ingredientId: ingredientMap.get(ing.name)!,
          quantity: ing.quantity,
          unit: ing.unit,
          preparation: ing.preparation,
        })),
      },
    },
  });

  return meal;
}

async function main() {
  const folder = process.argv[2];
  if (!folder) {
    console.error("Usage: npx tsx src/scripts/bulk-import.ts <folder>");
    process.exit(1);
  }

  const absFolder = path.resolve(folder);
  const doneDir = path.join(absFolder, "imported");
  await mkdir(doneDir, { recursive: true });

  const files = await readdir(absFolder);
  const recipes = files
    .filter((f) => SUPPORTED_EXTS.includes(path.extname(f).toLowerCase()))
    .map((f) => path.join(absFolder, f));

  if (recipes.length === 0) {
    console.log(`No recipe files found in ${absFolder}`);
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${recipes.length} recipe file(s) in ${absFolder}\n`);

  const succeeded: { file: string; mealName: string }[] = [];
  const failed: { file: string; error: string }[] = [];

  for (let i = 0; i < recipes.length; i++) {
    const filePath = recipes[i];
    const fileName = path.basename(filePath);
    const startedAt = Date.now();
    console.log(`[${i + 1}/${recipes.length}] Parsing ${fileName}...`);

    try {
      const meal = await importOne(filePath);
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`  OK  "${meal.name}" (id=${meal.id}) in ${elapsed}s`);
      await rename(filePath, path.join(doneDir, fileName));
      succeeded.push({ file: fileName, mealName: meal.name });
    } catch (e: any) {
      console.error(`  ERR ${e.message}`);
      failed.push({ file: fileName, error: e.message });
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Succeeded: ${succeeded.length}`);
  console.log(`Failed:    ${failed.length}`);

  if (succeeded.length > 0) {
    console.log("\nImported:");
    for (const s of succeeded) {
      console.log(`  - ${s.mealName} (${s.file})`);
    }
  }

  if (failed.length > 0) {
    console.log("\nFailures:");
    for (const f of failed) {
      console.log(`  - ${f.file}: ${f.error}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("Fatal error:", e);
  await prisma.$disconnect();
  process.exit(1);
});
