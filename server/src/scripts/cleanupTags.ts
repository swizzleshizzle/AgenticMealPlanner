// One-shot recipe-tag cleanup. Merges near-duplicate tags (case/separator
// variants, plurals with an existing singular, "x-inspired" with an existing
// base) across ALL meals, including archived versions, so history stays
// consistent. Conservative by design: a variant only merges into a tag that
// already exists — nothing is invented.
//
// Run:
//   cd server && npx tsx src/scripts/cleanupTags.ts --dry-run
//   cd server && npx tsx src/scripts/cleanupTags.ts
import { PrismaClient } from "@prisma/client";
import { normalizeTags, planTagMerges } from "../lib/tags.js";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const prisma = new PrismaClient();

  const meals = await prisma.meal.findMany({ select: { id: true, name: true, tags: true } });
  const { merges, counts } = planTagMerges(meals.map((m) => m.tags));

  const vocabBefore = Object.keys(counts).length + Object.keys(merges).filter((k) => !(k in counts)).length;
  console.log(dryRun ? "=== DRY RUN ===" : "=== APPLYING ===");
  console.log(`meals: ${meals.length} · distinct stored tags: ${new Set(meals.flatMap((m) => m.tags)).size}`);

  if (Object.keys(merges).length === 0) {
    console.log("no merges proposed — tags are already clean");
    await prisma.$disconnect();
    return;
  }

  console.log("\nproposed merges:");
  for (const [from, to] of Object.entries(merges).sort()) {
    console.log(`  ${from}  →  ${to}`);
  }

  let touched = 0;
  for (const meal of meals) {
    const next = normalizeTags(meal.tags.map((t) => merges[t] ?? t));
    if (JSON.stringify(next) === JSON.stringify(meal.tags)) continue;
    touched++;
    if (dryRun) {
      console.log(`  [would update] ${meal.name}: [${meal.tags.join(", ")}] → [${next.join(", ")}]`);
    } else {
      await prisma.meal.update({ where: { id: meal.id }, data: { tags: next } });
    }
  }

  const after = await prisma.meal.findMany({ select: { tags: true } });
  const distinctAfter = dryRun ? "(dry run)" : new Set(after.flatMap((m) => m.tags)).size;
  console.log(
    `\nSummary: ${Object.keys(merges).length} merge rules, ${touched} meal(s) ${dryRun ? "would change" : "updated"}, ` +
    `distinct tags after: ${distinctAfter}`,
  );
  void vocabBefore;
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
