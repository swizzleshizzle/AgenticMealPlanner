// One-shot seed for ingredient density / per-count weight values.
//
// Idempotent: only fills NULL fields. Never overwrites a value the user
// has set manually via the Pantry drawer.
//
// Run on WSL (DB is there):
//   cd server && npx tsx src/scripts/seedIngredientDensities.ts --dry-run
//   cd server && npx tsx src/scripts/seedIngredientDensities.ts
//
// Source notes for each value live next to it. Most density values are
// from King Arthur Baking's ingredient weight chart; gramsPerCount values
// for produce are from USDA FoodData Central. See the project's
// brainstorming notes / chat transcript for the full citation trail.

import { PrismaClient } from "@prisma/client";

interface SeedRow {
  densityGPerMl?: number;
  gramsPerCount?: number;
  note?: string;
}

const SEED: Record<string, SeedRow> = {
  // ---- flours, sugars, baking ----
  "flour":           { densityGPerMl: 0.507, note: "AP, KA spoon-leveled (120 g/cup)" },
  "sugar":           { densityGPerMl: 0.836, note: "granulated white" },
  "white sugar":     { densityGPerMl: 0.836, note: "granulated; duplicate of `sugar`" },
  "brown sugar":     { densityGPerMl: 0.899, note: "packed (KA 213 g/cup)" },
  "cornstarch":      { densityGPerMl: 0.473, note: "KA 112 g/cup" },
  "panko breadcrumb":{ densityGPerMl: 0.211, note: "KA 50 g/cup; lighter than Italian breadcrumbs" },

  // ---- oils ----
  "olive oil":   { densityGPerMl: 0.910, note: "physical chemistry standard" },
  "cooking oil": { densityGPerMl: 0.910, note: "assumed vegetable/canola" },
  "sesame oil":  { densityGPerMl: 0.918 },

  // ---- dairy ----
  "milk":              { densityGPerMl: 1.030, note: "whole; USDA/dairy industry" },
  "sour cream":        { densityGPerMl: 0.96 },
  "yogurt":            { densityGPerMl: 1.030, note: "plain; Greek would be ~1.10" },
  "butter":            { densityGPerMl: 0.954, note: "cold block (KA 226 g/cup)" },
  "garlic herb butter":{ densityGPerMl: 0.911, note: "same as butter family" },
  "cream cheese":      { densityGPerMl: 0.960, note: "KA 227 g/cup" },

  // ---- cheeses (shredded ≈ 113 g/cup, KA) ----
  "cheddar cheese":         { densityGPerMl: 0.478 },
  "mozzarella cheese":      { densityGPerMl: 0.478 },
  "monterey jack cheese":   { densityGPerMl: 0.478 },
  "mexican cheese blend":   { densityGPerMl: 0.478 },
  "white cheddar cheese":   { densityGPerMl: 0.478 },
  "pepper jack cheese":     { densityGPerMl: 0.478 },
  "feta cheese":            { densityGPerMl: 0.482, note: "crumbled" },
  "parmesan cheese":        { densityGPerMl: 0.423, note: "grated" },

  // ---- syrups / sweeteners ----
  "honey":       { densityGPerMl: 1.42 },
  "maple syrup": { densityGPerMl: 1.318 },

  // ---- salt (kosher salt deliberately skipped — user uses pink Himalayan in a grinder) ----
  "salt": { densityGPerMl: 1.200, note: "table salt (KA 18 g/tbsp)" },

  // ---- pastes & condiments ----
  "mayonnaise":             { densityGPerMl: 0.955 },
  "peanut butter":          { densityGPerMl: 1.140 },
  "tomato paste":           { densityGPerMl: 0.981 },
  "pesto":                  { densityGPerMl: 0.947 },
  "spicy horseradish paste":{ densityGPerMl: 1.015 },
  "dijon mustard":          { densityGPerMl: 1.05 },

  // ---- vinegars ----
  "balsamic vinegar":  { densityGPerMl: 1.08, note: "sugary, denser than clear vinegars" },
  "balsamic glaze":    { densityGPerMl: 1.21, note: "reduced; closer to molasses" },
  "rice wine vinegar": { densityGPerMl: 1.01 },
  "red wine vinegar":  { densityGPerMl: 1.01 },
  "white wine vinegar":{ densityGPerMl: 1.01 },

  // ---- sauces ----
  "soy sauce":             { densityGPerMl: 1.20 },
  "sweet soy glaze":       { densityGPerMl: 1.32, note: "kecap-manis-like" },
  "sriracha":              { densityGPerMl: 1.32 },
  "hot sauce":             { densityGPerMl: 1.04, note: "Frank's/Tabasco-style" },
  "sweet thai chili sauce":{ densityGPerMl: 1.13 },
  "bbq sauce":             { densityGPerMl: 1.12 },
  "ketchup":               { densityGPerMl: 1.15 },
  "hoisin sauce":          { densityGPerMl: 1.08 },
  "gochujang sauce":       { densityGPerMl: 1.05 },

  // ---- rices & grains (uncooked, cup default) ----
  "jasmine rice":      { densityGPerMl: 0.782 },
  "basmati rice":      { densityGPerMl: 0.757 },
  "white rice":        { densityGPerMl: 0.838, note: "long-grain dry, KA" },
  "rice":              { densityGPerMl: 0.79, note: "generic; midpoint of jasmine/basmati" },
  "farro":             { densityGPerMl: 0.761 },
  "israeli couscous":  { densityGPerMl: 0.719 },

  // ---- vegetables (cup default) ----
  "broccoli": { densityGPerMl: 0.385, note: "chopped raw florets, USDA" },
  "spinach":  { densityGPerMl: 0.127, note: "fresh leaves loose; volume unreliable in practice" },

  // ---- spices (most ground spices ≈ 0.4-0.5 g/mL) ----
  "black pepper":       { densityGPerMl: 0.480 },
  "garlic powder":      { densityGPerMl: 0.538 },
  "onion powder":       { densityGPerMl: 0.450 },
  "chili flake":        { densityGPerMl: 0.338 },
  "chili flakes":       { densityGPerMl: 0.338, note: "duplicate of `chili flake`" },
  "chipotle powder":    { densityGPerMl: 0.567 },
  "curry powder":       { densityGPerMl: 0.434 },
  "dried thyme":        { densityGPerMl: 0.275, note: "leaf form" },
  "smoked paprika":     { densityGPerMl: 0.460 },
  "sesame seed":        { densityGPerMl: 0.55 },
  "turmeric":           { densityGPerMl: 0.479 },
  "celery salt":        { densityGPerMl: 1.01, note: "salt-dominant" },
  "old bay seasoning":  { densityGPerMl: 0.490 },
  "italian seasoning":  { densityGPerMl: 0.169, note: "leafy; very light" },
  "herbes de provence": { densityGPerMl: 0.174, note: "leafy + lavender" },
  "korean chili flake": { densityGPerMl: 0.30, note: "gochugaru" },
  "garam masala":       { densityGPerMl: 0.43, note: "midpoint; high brand variance" },
  "ancho chili powder": { densityGPerMl: 0.45, note: "slightly fluffier than generic chili powder" },

  // ---- per-count weights (USDA-standard medium sizes) ----
  "eggs":              { gramsPerCount: 50,  note: "USDA large" },
  "garlic":            { gramsPerCount: 3,   note: "single peeled clove" },
  "carrot":            { gramsPerCount: 61,  note: "medium 7.5-8\"" },
  "lime":              { gramsPerCount: 67 },
  "lemon":             { gramsPerCount: 108 },
  "onion":             { gramsPerCount: 110, note: "yellow, medium" },
  "red onion":         { gramsPerCount: 110 },
  "bell pepper":       { gramsPerCount: 119 },
  "green bell pepper": { gramsPerCount: 119 },
  "tomato":            { gramsPerCount: 123, note: "globe, medium" },
  "potato":            { gramsPerCount: 213, note: "russet, medium" },
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const prisma = new PrismaClient();

  let willUpdate = 0;
  let alreadySet = 0;
  let notFound = 0;

  console.log(dryRun ? "=== DRY RUN ===" : "=== APPLYING ===");

  for (const [name, values] of Object.entries(SEED)) {
    const ingredient = await prisma.ingredient.findUnique({ where: { name } });
    if (!ingredient) {
      console.log(`  [not found] ${name}`);
      notFound++;
      continue;
    }

    const updates: { densityGPerMl?: number; gramsPerCount?: number } = {};
    if (values.densityGPerMl != null && ingredient.densityGPerMl == null) {
      updates.densityGPerMl = values.densityGPerMl;
    }
    if (values.gramsPerCount != null && ingredient.gramsPerCount == null) {
      updates.gramsPerCount = values.gramsPerCount;
    }

    if (Object.keys(updates).length === 0) {
      console.log(`  [already set] ${name}`);
      alreadySet++;
      continue;
    }

    const noteSuffix = values.note ? `  (${values.note})` : "";
    if (dryRun) {
      console.log(`  [would update] ${name}: ${JSON.stringify(updates)}${noteSuffix}`);
    } else {
      await prisma.ingredient.update({ where: { name }, data: updates });
      console.log(`  [updated] ${name}: ${JSON.stringify(updates)}${noteSuffix}`);
    }
    willUpdate++;
  }

  console.log(
    `\nSummary: ${willUpdate} ${dryRun ? "would update" : "updated"}, ` +
    `${alreadySet} already set, ${notFound} not found in DB`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
