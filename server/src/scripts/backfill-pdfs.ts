import { PrismaClient } from "@prisma/client";
import { readdir, copyFile } from "fs/promises";
import path from "path";
import Fuse from "fuse.js";
import { hashFile, ensureMealDir, mealPdfPath, mealThumbPath, relStoragePath } from "../services/mediaStorage.js";
import { runThumbnailJob } from "../services/pdfExtraction.js";

const prisma = new PrismaClient();

interface Args {
  dryRun: boolean;
  minScore: number;
  forcePairs: Map<string, number>; // filename → mealId
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { dryRun: false, minScore: 0.4, forcePairs: new Map() };
  for (const a of argv) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--min-score=")) args.minScore = Number(a.split("=")[1]);
    else if (a.startsWith("--force=")) {
      const pair = a.split("=")[1];
      const [name, id] = pair.split(":");
      if (name && id) args.forcePairs.set(name, Number(id));
    }
  }
  return args;
}

function cleanFilename(f: string): string {
  // Strip leading timestamp (e.g. "1775798603205-")
  const withoutTs = f.replace(/^\d{10,}-/, "");
  // Strip extension, replace underscores with spaces
  return withoutTs.replace(/\.pdf$/i, "").replace(/_/g, " ").trim();
}

async function main() {
  const args = parseArgs();
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  const files = (await readdir(uploadsDir)).filter((f) => f.toLowerCase().endsWith(".pdf"));
  console.log(`Reading ${uploadsDir} .......... ${files.length} PDFs`);

  const seenHash = new Map<string, string>(); // hash → first filename
  const unique: string[] = [];
  for (const f of files) {
    const abs = path.join(uploadsDir, f);
    const h = await hashFile(abs);
    if (seenHash.has(h)) continue;
    seenHash.set(h, f);
    unique.push(f);
  }
  console.log(`SHA-256 dedupe ............... ${unique.length} unique`);

  const meals = await prisma.meal.findMany({ select: { id: true, name: true, pdfPath: true } });
  console.log(`Loading meals ................ ${meals.length} meals`);

  const fuse = new Fuse(meals, { keys: ["name"], threshold: args.minScore, includeScore: true });

  const matched: { file: string; mealId: number; mealName: string; score: number }[] = [];
  const unmatched: { file: string; best?: { id: number; name: string; score: number } }[] = [];

  for (const file of unique) {
    const override = args.forcePairs.get(file);
    if (override) {
      const m = meals.find((x) => x.id === override);
      if (!m) { unmatched.push({ file }); continue; }
      matched.push({ file, mealId: m.id, mealName: m.name, score: 0 });
      continue;
    }
    const query = cleanFilename(file);
    const hits = fuse.search(query);
    const top = hits[0];
    if (top && top.score! <= args.minScore) {
      if (top.item.pdfPath) {
        // already has a PDF; skip silently to avoid clobber
        continue;
      }
      matched.push({ file, mealId: top.item.id, mealName: top.item.name, score: top.score! });
    } else {
      const best = hits[0] ? { id: hits[0].item.id, name: hits[0].item.name, score: hits[0].score! } : undefined;
      unmatched.push({ file, best });
    }
  }

  console.log("\n=== Matches ===");
  for (const m of matched) {
    console.log(`  ${m.file} → "${m.mealName}" (meal ${m.mealId}, score ${m.score.toFixed(2)})`);
  }
  console.log("\n=== Unmatched ===");
  for (const u of unmatched) {
    const tail = u.best ? ` (best: "${u.best.name}" score ${u.best.score.toFixed(2)})` : "";
    console.log(`  ${u.file}${tail}`);
  }

  if (args.dryRun) {
    console.log(`\n[dry-run] ${matched.length} would be matched, ${unmatched.length} unmatched.`);
    await prisma.$disconnect();
    return;
  }

  console.log("\n=== Applying ===");
  for (const m of matched) {
    await ensureMealDir(m.mealId);
    const src = path.join(uploadsDir, m.file);
    const destPdf = mealPdfPath(m.mealId);
    await copyFile(src, destPdf);
    const source = await runThumbnailJob(destPdf, mealThumbPath(m.mealId));
    await prisma.meal.update({
      where: { id: m.mealId },
      data: {
        pdfPath: relStoragePath(destPdf),
        imagePath: source ? relStoragePath(mealThumbPath(m.mealId)) : null,
        imageSource: source,
      },
    });
    console.log(`  ✓ ${m.mealName} (source=${source ?? "none"})`);
  }

  console.log(`\nDone. Applied ${matched.length}. Unmatched ${unmatched.length}.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
