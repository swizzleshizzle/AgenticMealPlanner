// One-shot seed for ingredient shelf-life values (days by storage location).
//
// Why: suggestExpirationDate() has been wired into receipt commits since the
// beginning, but 0 of 239 ingredients carried shelf-life data — so no
// receipt batch ever received an expiration, silently disabling FEFO drain
// ordering, the "expiring soon" pantry views, and the nightly purge.
//
// Idempotent: only fills NULL fields; never overwrites values set by hand.
// Values are conservative fridge/freezer/pantry estimates in the spirit of
// USDA FoodKeeper — deliberately on the cautious side, since they drive
// "eat this first" nudges rather than safety decisions.
//
// Run:
//   cd server && npx tsx src/scripts/seedShelfLives.ts --dry-run
//   cd server && npx tsx src/scripts/seedShelfLives.ts
import { PrismaClient } from "@prisma/client";

interface Life {
  fridge?: number;
  freezer?: number;
  pantry?: number;
}

const SEED: Record<string, Life> = {
  // ---- produce: leafy & fresh herbs ----
  "arugula": { fridge: 5 }, "baby lettuce": { fridge: 5 }, "mixed green": { fridge: 5 },
  "spinach": { fridge: 5 }, "cilantro": { fridge: 7 }, "parsley": { fridge: 7 },
  "dill": { fridge: 7 }, "chive": { fridge: 7 },
  "asian chop salad kit": { fridge: 5 }, "coleslaw mix": { fridge: 5 },
  "brocolli coleslaw": { fridge: 5 }, "red cabbage and carrot mix": { fridge: 7 },

  // ---- produce: vegetables ----
  "asparagus": { fridge: 4 }, "broccoli": { fridge: 7 }, "green bean": { fridge: 7 },
  "sugar snap pea": { fridge: 5 }, "zucchini": { fridge: 7 }, "cucumber": { fridge: 7 },
  "mini cucumber": { fridge: 7 }, "bell pepper": { fridge: 10 },
  "green bell pepper": { fridge: 10 }, "long green pepper": { fridge: 10 },
  "chili pepper": { fridge: 10 }, "celery": { fridge: 14 }, "carrot": { fridge: 21 },
  "shredded carrot": { fridge: 10 }, "corn": { fridge: 3 }, "bok choy and napa cabbage": { fridge: 7 },
  "red cabbage": { fridge: 21 }, "scallion": { fridge: 8 },
  "grape tomato": { fridge: 7, pantry: 4 }, "roma tomato": { fridge: 7, pantry: 4 },
  "tomato": { fridge: 7, pantry: 4 },

  // ---- produce: counter/pantry keepers ----
  "potato": { pantry: 30, fridge: 60 }, "multicolor baby potato": { pantry: 21 },
  "sweet potato": { pantry: 21 }, "onion": { pantry: 30, fridge: 45 },
  "red onion": { pantry: 30, fridge: 45 }, "shallot": { pantry: 30 },
  "garlic": { pantry: 60 }, "ginger": { fridge: 21, pantry: 7 },
  "lemon": { fridge: 21, pantry: 7 }, "lime": { fridge: 21, pantry: 7 },
  "mandarin orange": { fridge: 14, pantry: 7 },

  // ---- protein (fresh; freezer figures for uncooked) ----
  "chicken breast": { fridge: 2, freezer: 270 }, "chicken cutlet": { fridge: 2, freezer: 270 },
  "chopped chicken breast": { fridge: 2, freezer: 270 }, "diced chicken": { fridge: 2, freezer: 270 },
  "dark meat chicken": { fridge: 2, freezer: 270 }, "chicken wing": { fridge: 2, freezer: 270 },
  "ground beef": { fridge: 2, freezer: 120 }, "ground pork": { fridge: 2, freezer: 120 },
  "ground turkey": { fridge: 2, freezer: 120 }, "ground turkey 85% lean": { fridge: 2, freezer: 120 },
  "italian pork sausage": { fridge: 2, freezer: 60 }, "italian chicken sausage mix": { fridge: 2, freezer: 60 },
  "bacon": { fridge: 7, freezer: 30 }, "salmon": { fridge: 2, freezer: 90 },
  "tilapia": { fridge: 2, freezer: 180 }, "barramundi": { fridge: 2, freezer: 180 },
  "shrimp": { fridge: 2, freezer: 180 }, "sous vide chopped chicken": { fridge: 7, freezer: 90 },
  "egg": { fridge: 35 }, "eggs": { fridge: 35 },
  "shelled edamame": { fridge: 5, freezer: 240 },

  // ---- dairy ----
  "milk": { fridge: 7 }, "heavy cream": { fridge: 14 }, "buttermilk": { fridge: 14 },
  "greek yogurt": { fridge: 14 }, "sour cream": { fridge: 21 }, "crème fraîche": { fridge: 14 },
  "cream cheese": { fridge: 14 }, "cream sauce base": { fridge: 7 },
  "butter": { fridge: 60, freezer: 270 }, "garlic herb butter": { fridge: 30 },
  "burrata": { fridge: 5 }, "fresh mozzarella": { fridge: 7 },
  "cheddar cheese": { fridge: 30 }, "mild cheddar cheese": { fridge: 30 },
  "monterey jack cheese": { fridge: 30 }, "pepper jack cheese": { fridge: 30 },
  "mozzarella cheese": { fridge: 21 }, "gouda cheese": { fridge: 30 },
  "mexican cheese blend": { fridge: 21 }, "feta cheese": { fridge: 30 },
  "parmesan cheese": { fridge: 60 }, "paramesan cheese": { fridge: 60 },

  // ---- grains / bakery ----
  "brioche bun": { pantry: 5, freezer: 90 }, "french bread": { pantry: 3, freezer: 90 },
  "flour tortilla": { pantry: 14, fridge: 30 }, "demi-baguette": { pantry: 3, freezer: 90 },
  "buttermilk biscuit": { fridge: 7 },
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const prisma = new PrismaClient();

  let updated = 0, alreadySet = 0, notFound = 0;
  console.log(dryRun ? "=== DRY RUN ===" : "=== APPLYING ===");

  for (const [name, life] of Object.entries(SEED)) {
    const ing = await prisma.ingredient.findUnique({ where: { name } });
    if (!ing) { notFound++; console.log(`  [not found] ${name}`); continue; }

    const data: Record<string, number> = {};
    if (life.fridge != null && ing.shelfLifeFridgeDays == null) data.shelfLifeFridgeDays = life.fridge;
    if (life.freezer != null && ing.shelfLifeFreezerDays == null) data.shelfLifeFreezerDays = life.freezer;
    if (life.pantry != null && ing.shelfLifePantryDays == null) data.shelfLifePantryDays = life.pantry;
    if (Object.keys(data).length === 0) { alreadySet++; continue; }

    if (dryRun) console.log(`  [would update] ${name}: ${JSON.stringify(data)}`);
    else await prisma.ingredient.update({ where: { name }, data });
    updated++;
  }

  console.log(`\nSummary: ${updated} ${dryRun ? "would update" : "updated"}, ${alreadySet} already set, ${notFound} not in DB`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
