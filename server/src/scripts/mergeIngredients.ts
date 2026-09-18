// One-shot ingredient merge: fold duplicate ingredient records into a
// canonical one, remapping every reference and leaving the duplicate's name
// behind as an alias so future imports resolve to the survivor.
//
// Found by the 2026-09 receipt audit: the receipt/import resolver had
// created singular/plural twins ("egg"/"eggs", "chili flake"/"chili flakes"),
// which split recipe pooling on the shopping list.
//
// Run:
//   npx tsx src/scripts/mergeIngredients.ts --dry-run
//   npx tsx src/scripts/mergeIngredients.ts
import { PrismaClient } from "@prisma/client";

// loser → winner (winner keeps its record; loser becomes an alias of it).
// Winners chosen by usage: "egg" is referenced by recipes; "chili flakes"
// has the most recipe references and the live batch.
const MERGES: Array<{ loser: string; winner: string }> = [
  { loser: "eggs", winner: "egg" },
  { loser: "chili flake", winner: "chili flakes" },
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const prisma = new PrismaClient();
  console.log(dryRun ? "=== DRY RUN ===" : "=== APPLYING ===");

  for (const { loser, winner } of MERGES) {
    const l = await prisma.ingredient.findUnique({ where: { name: loser } });
    const w = await prisma.ingredient.findUnique({ where: { name: winner } });
    if (!l || !w) { console.log(`  [skip] ${loser} → ${winner}: ${!l ? "loser" : "winner"} not found`); continue; }

    const [mi, pb, ri, si, al] = await Promise.all([
      prisma.mealIngredient.count({ where: { ingredientId: l.id } }),
      prisma.pantryBatch.count({ where: { ingredientId: l.id } }),
      prisma.receiptItem.count({ where: { ingredientId: l.id } }),
      prisma.shoppingItem.count({ where: { ingredientId: l.id } }),
      prisma.ingredientAlias.count({ where: { ingredientId: l.id } }),
    ]);
    console.log(`  ${loser}(#${l.id}) → ${winner}(#${w.id}): refs meal=${mi} pantry=${pb} receipt=${ri} shopping=${si} alias=${al}`);
    if (dryRun) continue;

    await prisma.$transaction(async (tx) => {
      // Rows that would collide with an existing winner row are deleted (the
      // winner's row already represents the pairing); the rest are remapped.
      const loserMis = await tx.mealIngredient.findMany({ where: { ingredientId: l.id } });
      for (const row of loserMis) {
        const clash = await tx.mealIngredient.findFirst({
          where: { mealId: row.mealId, ingredientId: w.id },
        });
        if (clash) await tx.mealIngredient.delete({ where: { id: row.id } });
        else await tx.mealIngredient.update({ where: { id: row.id }, data: { ingredientId: w.id } });
      }
      const loserSis = await tx.shoppingItem.findMany({ where: { ingredientId: l.id } });
      for (const row of loserSis) {
        const clash = await tx.shoppingItem.findFirst({
          where: { planId: row.planId, ingredientId: w.id },
        });
        if (clash) await tx.shoppingItem.delete({ where: { id: row.id } });
        else await tx.shoppingItem.update({ where: { id: row.id }, data: { ingredientId: w.id } });
      }
      await tx.pantryBatch.updateMany({ where: { ingredientId: l.id }, data: { ingredientId: w.id } });
      await tx.receiptItem.updateMany({ where: { ingredientId: l.id }, data: { ingredientId: w.id } });
      await tx.ingredientAlias.updateMany({ where: { ingredientId: l.id }, data: { ingredientId: w.id } });
      await tx.ingredient.delete({ where: { id: l.id } });
      await tx.ingredientAlias.upsert({
        where: { alias: loser },
        update: { ingredientId: w.id },
        create: { alias: loser, ingredientId: w.id },
      });
    });
    console.log(`    merged; "${loser}" now aliases "${winner}"`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
