# Receipt Tracking for Pantry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Add from receipt" flow on the Pantry page that accepts pasted text, photos, or PDFs of grocery receipts, has Claude extract the line items + store + total, lets the user review/edit, and commits the result to `PantryItem` rows. Surface a weekly spending total and a strip of recent receipts on Pantry.

**Architecture:** Mostly server-side. Two new Prisma models (`Receipt`, `ReceiptItem`) with a hand-written SQL migration. A pure-function `ingredientMatcher` (abbreviation expansion + fuzzy match) is the heart of the matching logic and gets full TDD. The parser orchestration (`receiptService.parseReceipt`) dispatches by input mode (text / photo / pdf), calls Claude via the existing CLI wrapper, fuzzy-matches, fires a second Claude pass if >30% of food lines come back weak, and stashes the result in an in-memory map (parallel to `importSessions`). Commit is one Prisma transaction that resolves ingredients, then merges into existing pantry rows when `(ingredient, unit, location)` all match. Client adds one new modal (`AddFromReceiptModal` — two stages: upload, review) and two small strips on Pantry.

**Tech Stack:** Server: Express + Prisma 6 + Vitest, ESM with `.js` extensions in imports. Postgres on WSL via Tailscale (see `memory/dev_server.md`). Claude integration via `server/src/claude/cli.ts` (`callClaude` — CLI-based, not SDK). Client: React 18 + Tailwind v4 + TypeScript, `react-router-dom` v7, `lucide-react` icons. No new deps on either side.

---

## File Structure

### Create

**Server:**
- `server/prisma/migrations/005_receipts/migration.sql` — hand-written SQL for `receipts` + `receipt_items`.
- `server/src/claude/ingredientMatcher.ts` — abbreviation expansion table + fuzzy match function. Pure, fully unit-tested.
- `server/src/services/receiptParseSessions.ts` — parallel in-memory stash, holds parsed payload + source path.
- `server/src/claude/receiptParser.ts` — first-pass + rescue-pass prompt builders + JSON extraction.
- `server/src/services/receiptService.ts` — parse orchestration + commit transaction + recent + spending queries.
- `server/src/services/receiptStorage.ts` — file-storage helpers for `storage/receipts/<id>/source.<ext>` (mirrors `mediaStorage.ts`).
- `server/src/routes/receipts.ts` — REST routes.
- `server/src/__tests__/ingredientMatcher.test.ts`
- `server/src/__tests__/receiptParseSessions.test.ts`
- `server/src/__tests__/receiptParser.test.ts` — JSON extraction + prompt shape tests (no live Claude).
- `server/src/__tests__/receiptService.test.ts` — pure-function tests for the merge math + spending math.

**Client:**
- `client/src/api/receipts.ts` — API wrappers + types.
- `client/src/components/AddFromReceiptModal.tsx` — single component, two internal stages (`upload` and `review`).
- `client/src/components/ReceiptDetailModal.tsx` — read-only re-open of a past receipt; supports delete.
- `client/src/components/SpendingStrip.tsx` — "This week: $X across N trips" banner.
- `client/src/components/RecentReceiptsStrip.tsx` — horizontal strip of last-5 receipt cards (clickable → opens detail modal).

### Modify

**Server:**
- `server/prisma/schema.prisma` — add `Receipt` + `ReceiptItem` models. No changes to `PantryItem` or `Ingredient`.
- `server/src/middleware/upload.ts` — extend the existing `upload` allowed-extensions list with `.heic` (iOS photo support).
- `server/src/index.ts` — register the new `/api/receipts` route.

**Client:**
- `client/src/pages/Pantry.tsx` — add `Add from receipt` button next to existing `Add item`; mount `<SpendingStrip />` + `<RecentReceiptsStrip />` above the existing layout; manage the `AddFromReceiptModal` open state.

### No changes

- `server/src/services/importSessions.ts` — leave alone. Receipts get a parallel stash to avoid breaking the recipe-import flow.
- `server/src/claude/cli.ts` — reuse as-is.
- `client/src/api/pantry.ts`, `client/src/api/ingredients.ts` — receipts have their own API module; pantry/ingredient CRUD is unchanged.

---

## Pre-flight: create the worktree and branch

This feature branches from `master`. PR #2 (add-to-plan) and PR #1 (multi-cook) have both merged.

- [ ] **Step 1: Fetch and create the worktree**

From `C:\Users\mlgbr\Desktop\Projects\AgenticMealPlanner`:

```bash
git fetch origin
git worktree add .worktrees/receipt-tracking -b feature/receipt-tracking origin/master
cd .worktrees/receipt-tracking
```

- [ ] **Step 2: Install deps in the worktree**

```bash
npm install
```

Expected: ~30s. Some moderate-severity audit warnings — benign.

- [ ] **Step 3: Generate the Prisma client locally so the typecheck doesn't fail**

```bash
cd server && npx prisma generate
```

Expected: `✔ Generated Prisma Client (v6.x.x) to ./../node_modules/@prisma/client`. No DB access needed — this only reads `schema.prisma`.

- [ ] **Step 4: Verify baseline**

```bash
cd ../client && npx tsc --noEmit
cd ../server && npx vitest run
```

Expected: client tsc clean. Server tests `28 passed (28)`.

---

## Task 1: Prisma schema + migration

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/005_receipts/migration.sql`

**Why:** Two new tables. `PantryItem` and `Ingredient` are unchanged. Migration is hand-written SQL because the dev DB lives on WSL and `prisma migrate dev` would need a shadow-DB connection from this Windows box (which has no `.env`).

- [ ] **Step 1: Add the models to `server/prisma/schema.prisma`**

Open `server/prisma/schema.prisma`. After the existing `enum IngredientCategory { ... }` block, add a new enum:

```prisma
enum ReceiptSource {
  paste
  photo
  pdf
}
```

At the bottom of the file (after the `ShoppingItem` model), add:

```prisma
model Receipt {
  id          Int           @id @default(autoincrement())
  source      ReceiptSource
  sourcePath  String?       @map("source_path")
  rawText     String?       @map("raw_text")
  store       String
  tripDate    DateTime      @map("trip_date") @db.Date
  subtotal    Decimal?      @db.Decimal(10, 2)
  tax         Decimal?      @db.Decimal(10, 2)
  total       Decimal       @db.Decimal(10, 2)
  createdAt   DateTime      @default(now()) @map("created_at")
  updatedAt   DateTime      @updatedAt @map("updated_at")

  items ReceiptItem[]

  @@map("receipts")
}

model ReceiptItem {
  id             Int                 @id @default(autoincrement())
  receiptId      Int                 @map("receipt_id")
  rawName        String              @map("raw_name")
  parsedName     String              @map("parsed_name")
  ingredientId   Int?                @map("ingredient_id")
  quantity       Decimal             @db.Decimal(10, 3)
  unit           String
  price          Decimal?            @db.Decimal(10, 2)
  kind           String              // 'food' | 'non_food' | 'unknown' — kept as string to avoid an enum migration churn
  categoryGuess  IngredientCategory? @map("category_guess")
  locationGuess  PantryLocation?     @map("location_guess")
  isCommitted    Boolean             @default(true) @map("is_committed")

  receipt    Receipt     @relation(fields: [receiptId], references: [id], onDelete: Cascade)
  ingredient Ingredient? @relation(fields: [ingredientId], references: [id])

  @@map("receipt_items")
}
```

Then add the back-relation on `Ingredient` so Prisma is happy. Find the `model Ingredient { ... }` block and add `receiptItems ReceiptItem[]` to its relations:

```prisma
model Ingredient {
  // ... existing fields unchanged ...
  mealIngredients MealIngredient[]
  pantryItems     PantryItem[]
  shoppingItems   ShoppingItem[]
  receiptItems    ReceiptItem[]

  @@map("ingredients")
}
```

- [ ] **Step 2: Hand-write the SQL migration**

Create the directory and file:

```bash
mkdir -p server/prisma/migrations/005_receipts
```

Create `server/prisma/migrations/005_receipts/migration.sql` with:

```sql
-- Migration 005: receipts + receipt_items for the Pantry add-from-receipt flow.

CREATE TYPE "ReceiptSource" AS ENUM ('paste', 'photo', 'pdf');

CREATE TABLE "receipts" (
  "id"          SERIAL PRIMARY KEY,
  "source"      "ReceiptSource" NOT NULL,
  "source_path" TEXT,
  "raw_text"    TEXT,
  "store"       TEXT NOT NULL,
  "trip_date"   DATE NOT NULL,
  "subtotal"    DECIMAL(10, 2),
  "tax"         DECIMAL(10, 2),
  "total"       DECIMAL(10, 2) NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL
);

CREATE INDEX "receipts_trip_date_idx" ON "receipts" ("trip_date");

CREATE TABLE "receipt_items" (
  "id"             SERIAL PRIMARY KEY,
  "receipt_id"     INTEGER NOT NULL REFERENCES "receipts"("id") ON DELETE CASCADE,
  "raw_name"       TEXT NOT NULL,
  "parsed_name"    TEXT NOT NULL,
  "ingredient_id"  INTEGER REFERENCES "ingredients"("id"),
  "quantity"       DECIMAL(10, 3) NOT NULL,
  "unit"           TEXT NOT NULL,
  "price"          DECIMAL(10, 2),
  "kind"           TEXT NOT NULL,
  "category_guess" "IngredientCategory",
  "location_guess" "PantryLocation",
  "is_committed"   BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX "receipt_items_receipt_id_idx" ON "receipt_items" ("receipt_id");
CREATE INDEX "receipt_items_ingredient_id_idx" ON "receipt_items" ("ingredient_id");
```

- [ ] **Step 3: Apply the migration on the dev server**

Run remotely (the dev DB lives on WSL — see `memory/dev_server.md`):

```bash
ssh -p 22 swizz@100.114.226.44 'cd /home/swizz/projects/AgenticMealPlanner && git fetch origin && git checkout feature/receipt-tracking || git checkout -b feature/receipt-tracking'
```

Wait — the branch only lives locally for now. Push it first:

```bash
git push -u origin feature/receipt-tracking
```

Then on the server:

```bash
ssh -p 22 swizz@100.114.226.44 'cd /home/swizz/projects/AgenticMealPlanner && git fetch origin && git checkout feature/receipt-tracking && git pull && cd server && npx prisma migrate deploy && npx prisma generate'
```

Expected output of `migrate deploy`:
```
1 migration found in prisma/migrations
Applying migration `005_receipts`
The following migration(s) have been applied:
migrations/
  └─ 005_receipts/
    └─ migration.sql
All migrations have been successfully applied.
```

If the server is on `master` and refuses to switch (uncommitted changes), stash first:

```bash
ssh -p 22 swizz@100.114.226.44 'cd /home/swizz/projects/AgenticMealPlanner && git stash push -u && git checkout feature/receipt-tracking && git pull && cd server && npx prisma migrate deploy && npx prisma generate'
```

- [ ] **Step 4: Regenerate the Prisma client locally**

```bash
cd server && npx prisma generate
```

- [ ] **Step 5: Typecheck**

```bash
cd client && npx tsc --noEmit
cd ../server && npx tsc --noEmit
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/005_receipts/migration.sql
git commit -m "feat(db): receipts + receipt_items tables"
```

---

## Task 2: ingredientMatcher (pure functions, full TDD)

**Files:**
- Create: `server/src/claude/ingredientMatcher.ts`
- Create: `server/src/__tests__/ingredientMatcher.test.ts`

**Why:** This is the heart of the matching logic. Pure input → pure output. Easy to test exhaustively. The receipt parser pipeline depends on it.

- [ ] **Step 1: Write the failing tests**

Create `server/src/__tests__/ingredientMatcher.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { expandAbbreviations, fuzzyMatchIngredient } from "../claude/ingredientMatcher.js";

describe("expandAbbreviations", () => {
  it("expands single abbreviation", () => {
    expect(expandAbbreviations("ORG SPINACH")).toBe("organic spinach");
  });

  it("expands multiple abbreviations in one phrase", () => {
    expect(expandAbbreviations("ORG WHL MILK 1G")).toBe("organic whole milk 1g");
  });

  it("is case-insensitive on input but lowercases the output", () => {
    expect(expandAbbreviations("Org Bnn")).toBe("organic banana");
  });

  it("leaves words it doesn't recognize alone", () => {
    expect(expandAbbreviations("HAM CRUSTED")).toBe("ham crusted");
  });

  it("handles empty input", () => {
    expect(expandAbbreviations("")).toBe("");
  });

  it("strips punctuation that splits abbreviations", () => {
    expect(expandAbbreviations("ORG. SPNCH,5OZ")).toBe("organic spinach 5oz");
  });
});

describe("fuzzyMatchIngredient", () => {
  const candidates = [
    { id: 1, name: "spinach" },
    { id: 2, name: "whole milk" },
    { id: 3, name: "great value bread" },
    { id: 4, name: "banana" },
  ];

  it("exact match returns high confidence", () => {
    const result = fuzzyMatchIngredient("spinach", candidates);
    expect(result).toEqual({ id: 1, name: "spinach", confidence: "high" });
  });

  it("contains match returns high confidence", () => {
    const result = fuzzyMatchIngredient("organic spinach 5oz", candidates);
    expect(result?.id).toBe(1);
    expect(result?.confidence).toBe("high");
  });

  it("matches after abbreviation expansion", () => {
    const result = fuzzyMatchIngredient("ORG SPNCH", candidates);
    expect(result?.id).toBe(1);
  });

  it("matches multi-word ingredient with extra adjectives", () => {
    const result = fuzzyMatchIngredient("ORG WHL MILK 1G", candidates);
    expect(result?.id).toBe(2);
  });

  it("returns null when nothing matches", () => {
    const result = fuzzyMatchIngredient("oxtail bouillon cubes", candidates);
    expect(result).toBeNull();
  });

  it("flags borderline single-token matches as low confidence", () => {
    const result = fuzzyMatchIngredient("milk chocolate bar", candidates);
    // matches 'whole milk' on the 'milk' substring but the input is unrelated
    // → confidence should be 'low'
    expect(result?.confidence).toBe("low");
  });

  it("plural / singular tolerance: 'bananas' matches 'banana'", () => {
    const result = fuzzyMatchIngredient("bananas", candidates);
    expect(result?.id).toBe(4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npx vitest run src/__tests__/ingredientMatcher.test.ts
```

Expected: FAIL with "Cannot find module '../claude/ingredientMatcher.js'".

- [ ] **Step 3: Implement `ingredientMatcher.ts`**

Create `server/src/claude/ingredientMatcher.ts`:

```ts
// ---------------------------------------------------------------------------
// Receipt-line ingredient matching.
//
// Two pure functions:
//   - expandAbbreviations: turns thermal-print noise ("ORG SPNCH") into
//     readable text ("organic spinach"). Lowercases output. Strips punctuation
//     that abuts an abbreviation.
//   - fuzzyMatchIngredient: against a list of existing Ingredient rows,
//     returns the best match (or null) with a coarse confidence label.
//
// Both are pure → easy to unit-test → grow as we hit real receipts.
// ---------------------------------------------------------------------------

const ABBREVIATIONS: Record<string, string> = {
  // generic adjectives
  ORG: "organic",
  WHL: "whole",
  GV: "great value",
  // produce
  SPNCH: "spinach",
  BNN: "banana",
  BNNS: "bananas",
  BNANA: "banana",
  TMTO: "tomato",
  // protein
  CHKN: "chicken",
  BF: "beef",
  // dairy
  MLK: "milk",
  CHZ: "cheese",
  // grains
  BRD: "bread",
  // misc
  PWDR: "powder",
  SUG: "sugar",
};

export function expandAbbreviations(raw: string): string {
  if (!raw) return "";
  // Replace any punctuation that touches a token with whitespace, collapse
  // whitespace, then expand each token.
  const tokens = raw
    .replace(/[.,;:/\\()\[\]"']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const expanded = tokens.map((tok) => {
    const upper = tok.toUpperCase();
    return ABBREVIATIONS[upper] ?? tok.toLowerCase();
  });
  return expanded.join(" ");
}

export interface IngredientCandidate {
  id: number;
  name: string;
}

export interface MatchResult {
  id: number;
  name: string;
  confidence: "high" | "low";
}

export function fuzzyMatchIngredient(
  raw: string,
  candidates: IngredientCandidate[],
): MatchResult | null {
  if (!raw) return null;
  const expanded = expandAbbreviations(raw);
  const tokens = new Set(expanded.split(/\s+/).filter(Boolean));

  let best: { cand: IngredientCandidate; score: number } | null = null;

  for (const cand of candidates) {
    const candTokens = cand.name.toLowerCase().split(/\s+/).filter(Boolean);
    // Require every word in the candidate name to appear (or be a near-match)
    // in the expanded receipt text.
    const allMatch = candTokens.every((ct) =>
      tokens.has(ct) || tokens.has(`${ct}s`) || tokens.has(ct.replace(/s$/, "")),
    );
    if (!allMatch) continue;

    // Score by number of candidate tokens matched. Multi-word matches beat
    // single-word ones.
    const score = candTokens.length;
    if (!best || score > best.score) {
      best = { cand, score };
    }
  }

  if (!best) return null;

  // Confidence heuristic: a single-token candidate matched against a long
  // input phrase is "low" (e.g., 'milk' inside 'milk chocolate bar' shouldn't
  // be a high-confidence milk match). Multi-token matches and exact matches
  // are "high".
  const inputTokens = expanded.split(/\s+/).filter(Boolean);
  const confidence: "high" | "low" =
    best.score === 1 && inputTokens.length > 2 ? "low" : "high";

  return {
    id: best.cand.id,
    name: best.cand.name,
    confidence,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && npx vitest run src/__tests__/ingredientMatcher.test.ts
```

Expected: all 13 tests pass.

If `flags borderline single-token matches as low confidence` fails because the input has 3 tokens and `'whole milk'` matches via the 'milk' token: the candidate `'whole milk'` requires both `whole` AND `milk` in the input. Input is `milk chocolate bar` — missing `whole` — so it should NOT match `whole milk` at all, falling back to `null`. Adjust the test expectation to `expect(result).toBeNull()` if needed, OR add a single-word `'milk'` candidate to the fixture and assert low confidence on that. Pick whichever stays truer to the actual matching semantics.

- [ ] **Step 5: Commit**

```bash
git add server/src/claude/ingredientMatcher.ts server/src/__tests__/ingredientMatcher.test.ts
git commit -m "feat(server): ingredientMatcher with abbreviation expansion + fuzzy match"
```

---

## Task 3: receiptParseSessions stash

**Files:**
- Create: `server/src/services/receiptParseSessions.ts`
- Create: `server/src/__tests__/receiptParseSessions.test.ts`

**Why:** Parse stages everything in memory until the user commits. The parsed payload is bigger than the recipe-import stash (which only holds a path), so it gets a parallel module to avoid widening `importSessions.ts` and risking the recipe flow.

- [ ] **Step 1: Write the failing tests**

Create `server/src/__tests__/receiptParseSessions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  stashReceiptParse,
  popReceiptParse,
  peekReceiptParse,
  clearExpired,
} from "../services/receiptParseSessions.js";

const samplePayload = {
  store: "Aldi",
  tripDate: "2026-05-03",
  total: 84.32,
  items: [],
};

describe("receiptParseSessions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stash returns a session id and pop returns the payload + path", () => {
    const id = stashReceiptParse(samplePayload, "/tmp/aldi.jpg");
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    const popped = popReceiptParse(id);
    expect(popped?.payload).toEqual(samplePayload);
    expect(popped?.sourcePath).toBe("/tmp/aldi.jpg");
  });

  it("pasted text uses sourcePath = null and stashes rawText", () => {
    const id = stashReceiptParse(samplePayload, null, "GV WHL MILK 1G $3.97");
    const popped = popReceiptParse(id);
    expect(popped?.sourcePath).toBeNull();
    expect(popped?.rawText).toBe("GV WHL MILK 1G $3.97");
  });

  it("file uploads stash rawText = null by default", () => {
    const id = stashReceiptParse(samplePayload, "/tmp/aldi.jpg");
    expect(popReceiptParse(id)?.rawText).toBeNull();
  });

  it("peek returns the payload without consuming it", () => {
    const id = stashReceiptParse(samplePayload, null);
    expect(peekReceiptParse(id)?.payload).toEqual(samplePayload);
    expect(peekReceiptParse(id)?.payload).toEqual(samplePayload);
  });

  it("pop is single-use", () => {
    const id = stashReceiptParse(samplePayload, null);
    expect(popReceiptParse(id)).not.toBeNull();
    expect(popReceiptParse(id)).toBeNull();
  });

  it("pop returns null for unknown id", () => {
    expect(popReceiptParse("does-not-exist")).toBeNull();
  });

  it("expires after 15 minutes", () => {
    const id = stashReceiptParse(samplePayload, null);
    vi.advanceTimersByTime(16 * 60 * 1000);
    clearExpired();
    expect(popReceiptParse(id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/receiptParseSessions.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `receiptParseSessions.ts`**

Create `server/src/services/receiptParseSessions.ts`:

```ts
import { randomUUID } from "crypto";

export interface ParsedReceiptPayload {
  store: string;
  tripDate: string;
  subtotal?: number | null;
  tax?: number | null;
  total: number;
  items: Array<{
    rawName: string;
    parsedName: string;
    quantity: number;
    unit: string;
    price?: number | null;
    kind: "food" | "non_food" | "unknown";
    categoryGuess?: string | null;
    locationGuess?: string | null;
    defaultUnitGuess?: string | null;
    ingredientId?: number | null;
    matchConfidence?: "high" | "low" | null;
  }>;
}

interface Entry {
  payload: ParsedReceiptPayload;
  sourcePath: string | null;
  rawText: string | null;
  expiresAt: number;
}

const TTL_MS = 15 * 60 * 1000;
const store = new Map<string, Entry>();

export function stashReceiptParse(
  payload: ParsedReceiptPayload,
  sourcePath: string | null,
  rawText: string | null = null,
): string {
  const id = randomUUID();
  store.set(id, { payload, sourcePath, rawText, expiresAt: Date.now() + TTL_MS });
  return id;
}

export function peekReceiptParse(
  id: string,
): { payload: ParsedReceiptPayload; sourcePath: string | null; rawText: string | null } | null {
  const entry = store.get(id);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return { payload: entry.payload, sourcePath: entry.sourcePath, rawText: entry.rawText };
}

export function popReceiptParse(
  id: string,
): { payload: ParsedReceiptPayload; sourcePath: string | null; rawText: string | null } | null {
  const entry = store.get(id);
  if (!entry) return null;
  store.delete(id);
  if (entry.expiresAt < Date.now()) return null;
  return { payload: entry.payload, sourcePath: entry.sourcePath, rawText: entry.rawText };
}

export function clearExpired(): void {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (entry.expiresAt < now) store.delete(id);
  }
}

setInterval(clearExpired, 5 * 60 * 1000).unref?.();
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/receiptParseSessions.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/receiptParseSessions.ts server/src/__tests__/receiptParseSessions.test.ts
git commit -m "feat(server): receiptParseSessions in-memory stash"
```

---

## Task 4: receiptParser (Claude prompts + JSON extraction)

**Files:**
- Create: `server/src/claude/receiptParser.ts`
- Create: `server/src/__tests__/receiptParser.test.ts`

**Why:** Encapsulates everything Claude-related: the first-pass prompt, the rescue-pass prompt, the response schema, and JSON extraction. Keeping it isolated lets `receiptService` stay testable without mocking Claude.

- [ ] **Step 1: Write the failing tests**

Create `server/src/__tests__/receiptParser.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildFirstPassPrompt,
  buildRescuePrompt,
  extractJson,
  type ReceiptParseInput,
} from "../claude/receiptParser.js";

describe("buildFirstPassPrompt", () => {
  it("photo input includes the file path and instructs use of Read", () => {
    const input: ReceiptParseInput = { kind: "photo", path: "/tmp/aldi.jpg" };
    const prompt = buildFirstPassPrompt(input);
    expect(prompt).toContain("/tmp/aldi.jpg");
    expect(prompt).toContain("photo");
    expect(prompt).toMatch(/JSON/);
    expect(prompt).toMatch(/store/);
    expect(prompt).toMatch(/tripDate/);
    expect(prompt).toMatch(/items/);
  });

  it("text input embeds the raw text and labels it as a digital order", () => {
    const input: ReceiptParseInput = { kind: "text", text: "GV Whole Milk 1G $3.97" };
    const prompt = buildFirstPassPrompt(input);
    expect(prompt).toContain("GV Whole Milk 1G $3.97");
    expect(prompt).toMatch(/digital/i);
  });

  it("pdf input includes the file path", () => {
    const input: ReceiptParseInput = { kind: "pdf", path: "/tmp/walmart.pdf" };
    const prompt = buildFirstPassPrompt(input);
    expect(prompt).toContain("/tmp/walmart.pdf");
  });
});

describe("buildRescuePrompt", () => {
  it("includes only the weak items and the existing ingredient list", () => {
    const weakItems = [
      { rawName: "ORG SPNCH 5OZ", parsedName: "spinach 5oz" },
      { rawName: "BNN .35 LB", parsedName: "bananas" },
    ];
    const ingredients = [
      { id: 1, name: "spinach" },
      { id: 2, name: "banana" },
      { id: 3, name: "whole milk" },
    ];
    const prompt = buildRescuePrompt(weakItems, ingredients);
    expect(prompt).toContain("ORG SPNCH 5OZ");
    expect(prompt).toContain("BNN .35 LB");
    expect(prompt).toContain("spinach");
    expect(prompt).toContain("banana");
    expect(prompt).toContain("whole milk");
    expect(prompt).toMatch(/JSON/);
  });
});

describe("extractJson", () => {
  it("extracts from a fenced code block with json hint", () => {
    const raw = "Some preamble.\n```json\n{\"store\": \"Aldi\"}\n```\n";
    expect(extractJson(raw)).toBe('{"store": "Aldi"}');
  });

  it("extracts from a fenced code block without language hint", () => {
    const raw = "```\n{\"a\": 1}\n```";
    expect(extractJson(raw)).toBe('{"a": 1}');
  });

  it("falls back to greedy brace match", () => {
    const raw = "Here is the data: {\"store\": \"Walmart\", \"items\": []}";
    expect(extractJson(raw)).toBe('{"store": "Walmart", "items": []}');
  });

  it("returns null when there is no JSON-shaped text", () => {
    expect(extractJson("nothing to parse")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/receiptParser.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `receiptParser.ts`**

Create `server/src/claude/receiptParser.ts`:

```ts
import { callClaude } from "./cli.js";
import path from "path";
import type { ParsedReceiptPayload } from "../services/receiptParseSessions.js";

export type ReceiptParseInput =
  | { kind: "photo"; path: string }
  | { kind: "pdf"; path: string }
  | { kind: "text"; text: string };

const SCHEMA_BLOCK = `{
  "store": "string (e.g., 'Walmart', 'Aldi'; pull from the receipt header)",
  "tripDate": "YYYY-MM-DD (the date printed on the receipt; today if missing)",
  "subtotal": number_or_null,
  "tax": number_or_null,
  "total": number,
  "items": [
    {
      "rawName": "string (the receipt's literal text for this line, e.g., 'ORG SPNCH 5OZ')",
      "parsedName": "string (your best canonical guess: lowercase, singular, no brand unless inseparable)",
      "quantity": number,
      "unit": "string (e.g., 'lb', 'oz', 'gallon', 'count', 'package'; use 'count' if no unit shown)",
      "price": number_or_null,
      "kind": "food | non_food | unknown",
      "categoryGuess": "produce | protein | dairy | pantry_staple | grain | spice | condiment | frozen | other | null",
      "locationGuess": "fridge | freezer | pantry | null (frozen → freezer; dairy/produce/protein → fridge; everything else → pantry)",
      "defaultUnitGuess": "string_or_null (the canonical default unit for this ingredient if you'd suggest one when creating it new)"
    }
  ]
}`;

export function buildFirstPassPrompt(input: ReceiptParseInput): string {
  if (input.kind === "text") {
    return `Read this digital grocery order text and extract structured data.

ORDER TEXT:
"""
${input.text}
"""

Return ONLY valid JSON matching this exact schema — no markdown, no explanation:

${SCHEMA_BLOCK}

Notes:
- Skip non-item lines (subtotal, tax, total, store address, payment lines).
- 'kind' = 'non_food' for clearly non-edible items (paper towels, batteries, plastic bags); 'unknown' if you can't tell.
- If the receipt shows a per-pound price (e.g., '0.35 lb @ $0.59/lb $0.21'), quantity is 0.35 and unit is 'lb'.
- If a line has no unit, use 'count' and quantity 1.`;
  }

  const absolutePath = path.resolve(input.path);
  const fileType = input.kind === "pdf" ? "PDF" : "photo";
  return `Read the grocery receipt ${fileType} at this path: ${absolutePath}

Extract all line items and return ONLY valid JSON matching this exact schema — no markdown, no explanation:

${SCHEMA_BLOCK}

Notes:
- Skip non-item lines (subtotal, tax, total, store address, payment lines).
- Aldi paper receipts use heavy abbreviations (ORG, WHL, SPNCH); expand them in 'parsedName'.
- 'kind' = 'non_food' for clearly non-edible items (paper towels, batteries, plastic bags); 'unknown' if you can't tell.
- If the receipt shows a per-pound price (e.g., '0.35 lb @ $0.59/lb $0.21'), quantity is 0.35 and unit is 'lb'.
- If a line has no unit, use 'count' and quantity 1.`;
}

export function buildRescuePrompt(
  weakItems: Array<{ rawName: string; parsedName: string }>,
  ingredients: Array<{ id: number; name: string }>,
): string {
  const itemList = weakItems
    .map((it, i) => `  ${i}: rawName="${it.rawName}" parsedName="${it.parsedName}"`)
    .join("\n");
  const ingredientList = ingredients
    .map((ing) => `  ${ing.id}: ${ing.name}`)
    .join("\n");

  return `These grocery receipt lines did not match any existing ingredient cleanly. Re-read each line and pick the best matching ingredient ID from the list, or return null if there is no good match. Use your judgment — abbreviations and brand prefixes ("GV WHL MILK 1G" = Great Value Whole Milk 1 Gallon) are common.

LINES:
${itemList}

EXISTING INGREDIENTS (id: name):
${ingredientList}

Return ONLY valid JSON, an array of { "index": number, "ingredientId": number_or_null } — one entry per LINES index above, in order. No markdown, no explanation.`;
}

export function extractJson(raw: string): string | null {
  const fenceMatch = raw.match(/\`\`\`(?:json)?\s*\n?([\s\S]*?)\n?\`\`\`/);
  if (fenceMatch) {
    const inside = fenceMatch[1].trim();
    if (inside.startsWith("{") && inside.endsWith("}")) return inside;
    if (inside.startsWith("[") && inside.endsWith("]")) return inside;
  }
  const objectMatch = raw.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0];
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];
  return null;
}

export async function runFirstPass(input: ReceiptParseInput): Promise<ParsedReceiptPayload> {
  const prompt = buildFirstPassPrompt(input);
  const opts: Parameters<typeof callClaude>[1] = { timeout: 300_000 };
  if (input.kind !== "text") {
    opts.addDirs = [path.dirname(path.resolve(input.path))];
    opts.allowedTools = ["Read"];
  }
  const raw = await callClaude(prompt, opts);
  const jsonText = extractJson(raw);
  if (!jsonText) {
    throw new Error("Claude returned no parseable JSON for the first pass");
  }
  const parsed = JSON.parse(jsonText) as ParsedReceiptPayload;
  return parsed;
}

export async function runRescuePass(
  weakItems: Array<{ rawName: string; parsedName: string }>,
  ingredients: Array<{ id: number; name: string }>,
): Promise<Array<{ index: number; ingredientId: number | null }>> {
  const prompt = buildRescuePrompt(weakItems, ingredients);
  const raw = await callClaude(prompt, { timeout: 120_000 });
  const jsonText = extractJson(raw);
  if (!jsonText) {
    throw new Error("Claude returned no parseable JSON for the rescue pass");
  }
  return JSON.parse(jsonText) as Array<{ index: number; ingredientId: number | null }>;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/receiptParser.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/claude/receiptParser.ts server/src/__tests__/receiptParser.test.ts
git commit -m "feat(server): receiptParser Claude prompts + JSON extraction"
```

---

## Task 5: receiptService.parseReceipt orchestration

**Files:**
- Create: `server/src/services/receiptService.ts` (this task adds `parseReceipt`; later tasks add `commitReceipt` and the read queries)

**Why:** Glue. Dispatches by input kind, calls Claude, fuzzy-matches each food line, fires the rescue pass if too many lines came back weak, stashes the result. The orchestration logic itself is hard to unit-test without mocking Claude — most of the testable surface area is already in `ingredientMatcher` and the prompt builders.

- [ ] **Step 1: Create `server/src/services/receiptService.ts` with `parseReceipt`**

```ts
import { PrismaClient } from "@prisma/client";
import { runFirstPass, runRescuePass, type ReceiptParseInput } from "../claude/receiptParser.js";
import { fuzzyMatchIngredient, type IngredientCandidate } from "../claude/ingredientMatcher.js";
import { stashReceiptParse, type ParsedReceiptPayload } from "./receiptParseSessions.js";

const prisma = new PrismaClient();

const RESCUE_THRESHOLD = 0.30; // > 30% weak food items triggers a rescue pass

export interface ParseResult {
  parseId: string;
  payload: ParsedReceiptPayload;
}

export async function parseReceipt(input: ReceiptParseInput): Promise<ParseResult> {
  const parsed = await runFirstPass(input);

  // Pull every existing ingredient once; the matcher works in-memory.
  const ingredientRows = await prisma.ingredient.findMany({
    select: { id: true, name: true },
  });
  const candidates: IngredientCandidate[] = ingredientRows.map((r) => ({ id: r.id, name: r.name }));

  // First-pass matching using the cheap fuzzy matcher.
  for (const item of parsed.items) {
    if (item.kind !== "food") {
      item.ingredientId = null;
      item.matchConfidence = null;
      continue;
    }
    const match = fuzzyMatchIngredient(item.parsedName || item.rawName, candidates);
    if (match) {
      item.ingredientId = match.id;
      item.matchConfidence = match.confidence;
    } else {
      item.ingredientId = null;
      item.matchConfidence = null;
    }
  }

  // Rescue pass if too many food items are unmatched-or-low-confidence.
  const foodItems = parsed.items.filter((i) => i.kind === "food");
  const weakIndices = parsed.items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => it.kind === "food" && (it.ingredientId == null || it.matchConfidence === "low"))
    .map(({ i }) => i);

  if (foodItems.length > 0 && weakIndices.length / foodItems.length > RESCUE_THRESHOLD) {
    const weakItems = weakIndices.map((i) => ({
      rawName: parsed.items[i].rawName,
      parsedName: parsed.items[i].parsedName,
    }));
    try {
      const rescued = await runRescuePass(weakItems, candidates);
      for (const r of rescued) {
        const targetIdx = weakIndices[r.index];
        if (targetIdx == null) continue;
        if (r.ingredientId != null) {
          parsed.items[targetIdx].ingredientId = r.ingredientId;
          parsed.items[targetIdx].matchConfidence = "high"; // Claude is more trusted on the rescue pass
        }
      }
    } catch (err) {
      // Rescue pass is best-effort; failure isn't fatal — user just sees more "Create new" prompts.
      console.warn("[receiptService] rescue pass failed", err);
    }
  }

  const sourcePath = input.kind === "text" ? null : input.path;
  const rawText = input.kind === "text" ? input.text : null;
  const parseId = stashReceiptParse(parsed, sourcePath, rawText);
  return { parseId, payload: parsed };
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/receiptService.ts
git commit -m "feat(server): receiptService.parseReceipt orchestration"
```

---

## Task 6: receiptService.commitReceipt + pure merge helpers

**Files:**
- Modify: `server/src/services/receiptService.ts` — append commit logic + helpers.
- Create: `server/src/services/receiptStorage.ts` — file-storage helpers.
- Create: `server/src/__tests__/receiptService.test.ts` — pure-function tests for the merge math.

**Why:** Commit is one Prisma transaction. The merge decision (find existing pantry row with same `(ingredient, unit, location)`; increment vs create) is the core of correctness — extract the math into a pure function so we can unit-test it exhaustively without a DB.

- [ ] **Step 1: Create `server/src/services/receiptStorage.ts`**

```ts
import path from "path";
import { mkdir, copyFile, unlink } from "fs/promises";

const STORAGE_ROOT = path.resolve(process.cwd(), "storage", "receipts");

export function receiptDir(receiptId: number): string {
  return path.join(STORAGE_ROOT, String(receiptId));
}

export async function ensureReceiptDir(receiptId: number): Promise<string> {
  const dir = receiptDir(receiptId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function moveSourceIntoReceipt(
  receiptId: number,
  uploadPath: string,
): Promise<string> {
  const ext = path.extname(uploadPath).toLowerCase() || "";
  const dir = await ensureReceiptDir(receiptId);
  const dest = path.join(dir, `source${ext}`);
  await copyFile(uploadPath, dest);
  await unlink(uploadPath).catch(() => undefined);
  // Relative path for DB storage, forward slashes always.
  return path.relative(process.cwd(), dest).split(path.sep).join("/");
}
```

- [ ] **Step 2: Write the failing tests for the merge math**

Create `server/src/__tests__/receiptService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeMergeDecision, weeklyWindow } from "../services/receiptService.js";

describe("computeMergeDecision", () => {
  const baseExisting = [
    { id: 10, ingredientId: 1, quantity: 0.5, unit: "gal", location: "fridge", expirationDate: new Date("2026-05-15") },
    { id: 11, ingredientId: 2, quantity: 1,   unit: "count", location: "pantry", expirationDate: null },
  ];

  it("merges when ingredient + unit + location all match", () => {
    const result = computeMergeDecision(
      { ingredientId: 1, quantity: 1, unit: "gal", location: "fridge", expirationDate: null },
      baseExisting,
    );
    expect(result).toEqual({
      action: "increment",
      pantryItemId: 10,
      newQuantity: 1.5,
      newExpirationDate: new Date("2026-05-15"),
    });
  });

  it("creates a new row when units differ", () => {
    const result = computeMergeDecision(
      { ingredientId: 1, quantity: 32, unit: "oz", location: "fridge", expirationDate: null },
      baseExisting,
    );
    expect(result).toEqual({ action: "create" });
  });

  it("creates a new row when location differs", () => {
    const result = computeMergeDecision(
      { ingredientId: 1, quantity: 1, unit: "gal", location: "freezer", expirationDate: null },
      baseExisting,
    );
    expect(result).toEqual({ action: "create" });
  });

  it("creates a new row when no existing item matches", () => {
    const result = computeMergeDecision(
      { ingredientId: 99, quantity: 1, unit: "count", location: "pantry", expirationDate: null },
      baseExisting,
    );
    expect(result).toEqual({ action: "create" });
  });

  it("FIFO bias: receipt expiration earlier than existing → adopt the earlier date", () => {
    const result = computeMergeDecision(
      { ingredientId: 1, quantity: 1, unit: "gal", location: "fridge", expirationDate: new Date("2026-05-10") },
      baseExisting,
    );
    expect(result.action).toBe("increment");
    if (result.action === "increment") {
      expect(result.newExpirationDate).toEqual(new Date("2026-05-10"));
    }
  });

  it("FIFO bias: receipt expiration later than existing → keep the existing date", () => {
    const result = computeMergeDecision(
      { ingredientId: 1, quantity: 1, unit: "gal", location: "fridge", expirationDate: new Date("2026-05-20") },
      baseExisting,
    );
    expect(result.action).toBe("increment");
    if (result.action === "increment") {
      expect(result.newExpirationDate).toEqual(new Date("2026-05-15"));
    }
  });

  it("merges into a row whose existing expiration is null", () => {
    const result = computeMergeDecision(
      { ingredientId: 2, quantity: 2, unit: "count", location: "pantry", expirationDate: new Date("2026-05-15") },
      baseExisting,
    );
    expect(result).toEqual({
      action: "increment",
      pantryItemId: 11,
      newQuantity: 3,
      newExpirationDate: new Date("2026-05-15"),
    });
  });
});

describe("weeklyWindow", () => {
  it("returns Sunday → Saturday for a midweek date", () => {
    // 2026-05-06 is a Wednesday
    const { weekStart, weekEnd } = weeklyWindow(new Date("2026-05-06T12:00:00"));
    expect(weekStart.toISOString().slice(0, 10)).toBe("2026-05-03"); // Sunday
    expect(weekEnd.toISOString().slice(0, 10)).toBe("2026-05-09");   // Saturday
  });

  it("returns same Sunday for a Sunday input", () => {
    const { weekStart } = weeklyWindow(new Date("2026-05-03T12:00:00"));
    expect(weekStart.toISOString().slice(0, 10)).toBe("2026-05-03");
  });

  it("returns Saturday's week (not next week's) for a Saturday input", () => {
    const { weekStart, weekEnd } = weeklyWindow(new Date("2026-05-09T23:00:00"));
    expect(weekStart.toISOString().slice(0, 10)).toBe("2026-05-03");
    expect(weekEnd.toISOString().slice(0, 10)).toBe("2026-05-09");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/receiptService.test.ts
```

Expected: FAIL — `computeMergeDecision` and `weeklyWindow` not exported.

- [ ] **Step 4: Append the merge helpers + commit logic to `receiptService.ts`**

Open `server/src/services/receiptService.ts` and append at the bottom:

```ts
// ---------------------------------------------------------------------------
// Pure helpers (extracted for unit testing).
// ---------------------------------------------------------------------------

export interface ExistingPantryItem {
  id: number;
  ingredientId: number;
  quantity: number;
  unit: string;
  location: string;
  expirationDate: Date | null;
}

export interface IncomingPantryRow {
  ingredientId: number;
  quantity: number;
  unit: string;
  location: string;
  expirationDate: Date | null;
}

export type MergeDecision =
  | { action: "create" }
  | { action: "increment"; pantryItemId: number; newQuantity: number; newExpirationDate: Date | null };

export function computeMergeDecision(
  incoming: IncomingPantryRow,
  existing: ExistingPantryItem[],
): MergeDecision {
  const match = existing.find(
    (e) =>
      e.ingredientId === incoming.ingredientId &&
      e.unit === incoming.unit &&
      e.location === incoming.location,
  );
  if (!match) return { action: "create" };

  // FIFO expiration bias: if either side has a date and the other is null,
  // take the non-null. If both have dates, take the earlier one.
  let newExpirationDate: Date | null;
  if (match.expirationDate && incoming.expirationDate) {
    newExpirationDate =
      incoming.expirationDate < match.expirationDate
        ? incoming.expirationDate
        : match.expirationDate;
  } else {
    newExpirationDate = match.expirationDate ?? incoming.expirationDate;
  }

  return {
    action: "increment",
    pantryItemId: match.id,
    newQuantity: match.quantity + incoming.quantity,
    newExpirationDate,
  };
}

export function weeklyWindow(reference: Date): { weekStart: Date; weekEnd: Date } {
  // Sunday-anchored week. weekStart = Sunday 00:00, weekEnd = Saturday 23:59:59.999
  const ref = new Date(reference);
  const day = ref.getDay(); // 0 = Sunday
  const weekStart = new Date(ref);
  weekStart.setDate(ref.getDate() - day);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return { weekStart, weekEnd };
}
```

Also add at the top of the file (just below the existing imports):

```ts
import { Prisma } from "@prisma/client";
import { peekReceiptParse, popReceiptParse } from "./receiptParseSessions.js";
import { moveSourceIntoReceipt } from "./receiptStorage.js";
```

Then append the commit function at the bottom of the file:

```ts
// ---------------------------------------------------------------------------
// Commit: parse stash + user edits → DB writes.
// ---------------------------------------------------------------------------

export interface CommitItemEdit {
  // Index into the stashed payload's items array.
  index: number;
  ingredientId: number | null;
  parsedName: string;
  quantity: number;
  unit: string;
  price: number | null;
  kind: "food" | "non_food" | "unknown";
  categoryGuess: string | null;
  locationGuess: "fridge" | "freezer" | "pantry" | null;
  expirationDate: string | null; // ISO date 'YYYY-MM-DD'
  isCommitted: boolean;
}

export interface CommitInput {
  parseId: string;
  store: string;
  tripDate: string; // 'YYYY-MM-DD'
  subtotal: number | null;
  tax: number | null;
  total: number;
  items: CommitItemEdit[];
}

export async function commitReceipt(input: CommitInput) {
  // Peek (don't consume) so a transaction failure leaves the stash intact for retry.
  const stashed = peekReceiptParse(input.parseId);
  if (!stashed) {
    throw new Error("Parse session expired or not found. Please re-upload.");
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. Create the Receipt row.
    const source: "pdf" | "photo" | "paste" = stashed.sourcePath
      ? (stashed.sourcePath.toLowerCase().endsWith(".pdf") ? "pdf" : "photo")
      : "paste";
    const receipt = await tx.receipt.create({
      data: {
        source,
        sourcePath: null, // filled in below after we move the file
        rawText: stashed.rawText,
        store: input.store,
        tripDate: new Date(input.tripDate),
        subtotal: input.subtotal != null ? new Prisma.Decimal(input.subtotal) : null,
        tax: input.tax != null ? new Prisma.Decimal(input.tax) : null,
        total: new Prisma.Decimal(input.total),
      },
    });

    // 2. Move the uploaded file (if any) into storage/receipts/<id>/source.<ext>.
    if (stashed.sourcePath) {
      const relPath = await moveSourceIntoReceipt(receipt.id, stashed.sourcePath);
      await tx.receipt.update({ where: { id: receipt.id }, data: { sourcePath: relPath } });
    }

    // 3. For each item the user kept (isCommitted), resolve the ingredient,
    //    create the ReceiptItem row, then merge into pantry if it's food.
    const existingPantry = await tx.pantryItem.findMany({
      select: { id: true, ingredientId: true, quantity: true, unit: true, location: true, expirationDate: true },
    });
    // Mutable working copy so successive merges within the same commit see prior writes.
    const workingPantry: ExistingPantryItem[] = existingPantry.map((p) => ({
      id: p.id,
      ingredientId: p.ingredientId,
      quantity: Number(p.quantity),
      unit: p.unit,
      location: p.location,
      expirationDate: p.expirationDate,
    }));

    for (const edit of input.items) {
      const stashItem = stashed.payload.items[edit.index];
      if (!stashItem) continue; // out-of-range index — skip silently

      // 3a. Resolve / create the ingredient if this is a food line that needs it.
      let ingredientId = edit.ingredientId;
      if (edit.kind === "food" && edit.isCommitted && ingredientId == null) {
        const created = await tx.ingredient.upsert({
          where: { name: edit.parsedName.toLowerCase() },
          update: {},
          create: {
            name: edit.parsedName.toLowerCase(),
            category: (edit.categoryGuess as any) ?? "other",
            defaultUnit: edit.unit || stashItem.defaultUnitGuess || "count",
          },
        });
        ingredientId = created.id;
      }

      // 3b. Create the ReceiptItem row.
      await tx.receiptItem.create({
        data: {
          receiptId: receipt.id,
          rawName: stashItem.rawName,
          parsedName: edit.parsedName,
          ingredientId: edit.kind === "food" ? ingredientId : null,
          quantity: new Prisma.Decimal(edit.quantity),
          unit: edit.unit,
          price: edit.price != null ? new Prisma.Decimal(edit.price) : null,
          kind: edit.kind,
          categoryGuess: (edit.categoryGuess as any) ?? null,
          locationGuess: edit.locationGuess as any,
          isCommitted: edit.isCommitted,
        },
      });

      // 3c. If food + committed + has an ingredient, write to pantry.
      if (edit.kind !== "food" || !edit.isCommitted || ingredientId == null) continue;

      const incoming: IncomingPantryRow = {
        ingredientId,
        quantity: edit.quantity,
        unit: edit.unit,
        location: (edit.locationGuess ?? "pantry") as string,
        expirationDate: edit.expirationDate ? new Date(edit.expirationDate) : null,
      };
      const decision = computeMergeDecision(incoming, workingPantry);

      if (decision.action === "increment") {
        await tx.pantryItem.update({
          where: { id: decision.pantryItemId },
          data: {
            quantity: new Prisma.Decimal(decision.newQuantity),
            expirationDate: decision.newExpirationDate,
          },
        });
        // Reflect in the working copy so a later item in this same receipt
        // merges into the same row (e.g., two banana lines on one receipt).
        const idx = workingPantry.findIndex((w) => w.id === decision.pantryItemId);
        if (idx >= 0) {
          workingPantry[idx].quantity = decision.newQuantity;
          workingPantry[idx].expirationDate = decision.newExpirationDate;
        }
      } else {
        const created = await tx.pantryItem.create({
          data: {
            ingredientId: incoming.ingredientId,
            quantity: new Prisma.Decimal(incoming.quantity),
            unit: incoming.unit,
            location: incoming.location as any,
            expirationDate: incoming.expirationDate ?? undefined,
          },
        });
        workingPantry.push({
          id: created.id,
          ingredientId: incoming.ingredientId,
          quantity: incoming.quantity,
          unit: incoming.unit,
          location: incoming.location,
          expirationDate: incoming.expirationDate,
        });
      }
    }

    return receipt;
  });

  // Transaction succeeded — only now consume the stash entry.
  popReceiptParse(input.parseId);
  return result;
}
```

- [ ] **Step 5: Run tests to verify the pure helpers pass**

```bash
npx vitest run src/__tests__/receiptService.test.ts
```

Expected: 10 tests pass.

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/receiptService.ts server/src/services/receiptStorage.ts server/src/__tests__/receiptService.test.ts
git commit -m "feat(server): receiptService.commitReceipt + merge helpers"
```

---

## Task 7: receiptService read queries (recent + spending)

**Files:**
- Modify: `server/src/services/receiptService.ts` — add `getRecentReceipts`, `getReceiptById`, `deleteReceipt`, `getWeeklySpending`.

**Why:** Tiny queries the routes need.

- [ ] **Step 1: Append the read queries to `receiptService.ts`**

At the bottom of the file, add:

```ts
// ---------------------------------------------------------------------------
// Read queries.
// ---------------------------------------------------------------------------

export async function getRecentReceipts(limit = 5) {
  return prisma.receipt.findMany({
    orderBy: { tripDate: "desc" },
    take: limit,
    include: {
      _count: { select: { items: true } },
    },
  });
}

export async function getReceiptById(id: number) {
  return prisma.receipt.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: { id: "asc" },
        include: { ingredient: true },
      },
    },
  });
}

export async function deleteReceipt(id: number) {
  // Cascade deletes the receipt_items via the FK; PantryItems are untouched
  // because there's no FK back from PantryItem.
  return prisma.receipt.delete({ where: { id } });
}

export async function getWeeklySpending(reference: Date = new Date()) {
  const { weekStart, weekEnd } = weeklyWindow(reference);
  const result = await prisma.receipt.aggregate({
    where: {
      tripDate: { gte: weekStart, lte: weekEnd },
    },
    _sum: { total: true },
    _count: { _all: true },
  });
  return {
    weekStart: weekStart.toISOString().slice(0, 10),
    weekEnd: weekEnd.toISOString().slice(0, 10),
    total: Number(result._sum.total ?? 0),
    tripCount: result._count._all,
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/receiptService.ts
git commit -m "feat(server): receiptService recent + spending queries"
```

---

## Task 8: REST routes + middleware + index.ts wiring

**Files:**
- Modify: `server/src/middleware/upload.ts` — extend allowed extensions.
- Create: `server/src/routes/receipts.ts`
- Modify: `server/src/index.ts` — register the new route.

**Why:** Surface area for the client.

- [ ] **Step 1: Extend the upload middleware to accept HEIC**

Open `server/src/middleware/upload.ts`. In the `upload` exporter's `allowed` array, add `.heic`:

```ts
const allowed = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".heic"];
```

- [ ] **Step 2: Create `server/src/routes/receipts.ts`**

```ts
import { Router } from "express";
import { upload } from "../middleware/upload.js";
import * as receiptService from "../services/receiptService.js";
import path from "path";

const router = Router();

router.post("/parse", upload.single("file"), async (req, res) => {
  try {
    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (!req.file && !text) {
      return res.status(400).json({ error: "Either a file or non-empty 'text' is required." });
    }

    let result;
    if (text) {
      result = await receiptService.parseReceipt({ kind: "text", text });
    } else if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const kind = ext === ".pdf" ? "pdf" : "photo";
      result = await receiptService.parseReceipt({ kind, path: req.file.path });
    } else {
      return res.status(400).json({ error: "Unreachable" });
    }

    res.json(result);
  } catch (err: any) {
    console.error("[receipts/parse] failed", err);
    res.status(500).json({ error: "Failed to parse receipt", details: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const receipt = await receiptService.commitReceipt(req.body);
    res.status(201).json(receipt);
  } catch (err: any) {
    console.error("[receipts/commit] failed", err);
    const status = /expired|not found/i.test(err.message) ? 410 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.get("/", async (req, res) => {
  const limit = req.query.limit ? Math.min(50, Number(req.query.limit)) : 5;
  const receipts = await receiptService.getRecentReceipts(limit);
  res.json(receipts);
});

router.get("/spending", async (_req, res) => {
  const spending = await receiptService.getWeeklySpending();
  res.json(spending);
});

router.get("/:id", async (req, res) => {
  const receipt = await receiptService.getReceiptById(Number(req.params.id));
  if (!receipt) return res.status(404).json({ error: "Receipt not found" });
  res.json(receipt);
});

router.delete("/:id", async (req, res) => {
  await receiptService.deleteReceipt(Number(req.params.id));
  res.status(204).send();
});

export default router;
```

The order of `GET /spending` before `GET /:id` matters — Express matches in registration order, so `/spending` would otherwise be parsed as `id="spending"`.

- [ ] **Step 3: Register the route in `server/src/index.ts`**

Add the import:

```ts
import receiptRoutes from "./routes/receipts.js";
```

Mount it (after the existing route mounts):

```ts
app.use("/api/receipts", receiptRoutes);
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Run the full test suite as a sanity check**

```bash
npx vitest run
```

Expected: all tests pass (the pre-existing 28 + the new ingredientMatcher / receiptParseSessions / receiptParser / receiptService pure tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/middleware/upload.ts server/src/routes/receipts.ts server/src/index.ts
git commit -m "feat(server): /api/receipts routes (parse, commit, list, get, delete, spending)"
```

---

## Task 9: Client api/receipts.ts

**Files:**
- Create: `client/src/api/receipts.ts`

**Why:** Typed wrappers around the new endpoints.

- [ ] **Step 1: Create `client/src/api/receipts.ts`**

```ts
import { apiFetch } from "./client";
import type { Ingredient } from "./ingredients";

export type ReceiptSource = "paste" | "photo" | "pdf";
export type ItemKind = "food" | "non_food" | "unknown";
export type PantryLocation = "fridge" | "freezer" | "pantry";
export type IngredientCategory =
  | "produce" | "protein" | "dairy" | "pantry_staple" | "grain"
  | "spice" | "condiment" | "frozen" | "other";

export interface ParsedReceiptItem {
  rawName: string;
  parsedName: string;
  quantity: number;
  unit: string;
  price?: number | null;
  kind: ItemKind;
  categoryGuess?: IngredientCategory | null;
  locationGuess?: PantryLocation | null;
  defaultUnitGuess?: string | null;
  ingredientId?: number | null;
  matchConfidence?: "high" | "low" | null;
}

export interface ParsedReceipt {
  store: string;
  tripDate: string;
  subtotal?: number | null;
  tax?: number | null;
  total: number;
  items: ParsedReceiptItem[];
}

export interface ParseResult {
  parseId: string;
  payload: ParsedReceipt;
}

export interface ReceiptItem {
  id: number;
  receiptId: number;
  rawName: string;
  parsedName: string;
  ingredientId: number | null;
  ingredient: Ingredient | null;
  quantity: string; // Prisma Decimal serializes to string in JSON
  unit: string;
  price: string | null;
  kind: ItemKind;
  categoryGuess: IngredientCategory | null;
  locationGuess: PantryLocation | null;
  isCommitted: boolean;
}

export interface Receipt {
  id: number;
  source: ReceiptSource;
  sourcePath: string | null;
  store: string;
  tripDate: string;
  subtotal: string | null;
  tax: string | null;
  total: string;
  createdAt: string;
  updatedAt: string;
  items?: ReceiptItem[];
  _count?: { items: number };
}

export interface CommitItemEdit {
  index: number;
  ingredientId: number | null;
  parsedName: string;
  quantity: number;
  unit: string;
  price: number | null;
  kind: ItemKind;
  categoryGuess: IngredientCategory | null;
  locationGuess: PantryLocation | null;
  expirationDate: string | null;
  isCommitted: boolean;
}

export interface CommitInput {
  parseId: string;
  store: string;
  tripDate: string;
  subtotal: number | null;
  tax: number | null;
  total: number;
  items: CommitItemEdit[];
}

export interface WeeklySpending {
  weekStart: string;
  weekEnd: string;
  total: number;
  tripCount: number;
}

export async function parseReceipt(input: { file?: File; text?: string }): Promise<ParseResult> {
  const form = new FormData();
  if (input.file) form.append("file", input.file);
  if (input.text) form.append("text", input.text);
  // apiFetch's default is JSON; for FormData we go raw via fetch.
  const res = await fetch("/api/receipts/parse", { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "Parse failed");
  }
  return res.json();
}

export const commitReceipt = (input: CommitInput) =>
  apiFetch<Receipt>("/receipts", { method: "POST", body: JSON.stringify(input) });

export const getRecentReceipts = (limit = 5) =>
  apiFetch<Receipt[]>(`/receipts?limit=${limit}`);

export const getReceipt = (id: number) =>
  apiFetch<Receipt>(`/receipts/${id}`);

export const deleteReceipt = (id: number) =>
  apiFetch<void>(`/receipts/${id}`, { method: "DELETE" });

export const getWeeklySpending = () =>
  apiFetch<WeeklySpending>("/receipts/spending");
```

- [ ] **Step 2: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add client/src/api/receipts.ts
git commit -m "feat(client): receipts API wrappers + types"
```

---

## Task 10: AddFromReceiptModal — upload stage

**Files:**
- Create: `client/src/components/AddFromReceiptModal.tsx`

**Why:** First half of the modal — drop file or paste text, submit to `/parse`, show loading. The review-stage UI lands in Task 11.

- [ ] **Step 1: Create `client/src/components/AddFromReceiptModal.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { X, Upload, Receipt as ReceiptIcon, ClipboardPaste } from "lucide-react";
import { parseReceipt, type ParseResult } from "../api/receipts";
import Button from "./ui/Button";

type Stage = "upload" | "parsing" | "review" | "error";

interface Props {
  onClose: () => void;
  onCommitted: () => void;
}

export default function AddFromReceiptModal({ onClose, onCommitted }: Props) {
  const [stage, setStage] = useState<Stage>("upload");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Esc-to-close + body-scroll lock, consistent with other modals.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const handleFile = async (file: File) => {
    setStage("parsing");
    setError(null);
    try {
      const result = await parseReceipt({ file });
      setParsed(result);
      setStage("review");
    } catch (e: any) {
      setError(e?.message ?? "Parse failed.");
      setStage("error");
    }
  };

  const handlePaste = async () => {
    if (!pasteText.trim()) return;
    setStage("parsing");
    setError(null);
    try {
      const result = await parseReceipt({ text: pasteText });
      setParsed(result);
      setStage("review");
    } catch (e: any) {
      setError(e?.message ?? "Parse failed.");
      setStage("error");
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8 amp-fade-in"
      style={{ background: "rgba(30, 22, 10, 0.55)", backdropFilter: "blur(4px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-1 rounded-[16px] w-full max-w-[640px] max-h-[88vh] flex flex-col overflow-hidden border border-line"
        style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
      >
        <div className="flex items-start gap-3 px-4 sm:px-5 py-3.5 border-b border-line-soft">
          <div className="w-8 h-8 rounded-[8px] bg-accent-soft text-accent-ink grid place-items-center">
            <ReceiptIcon size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-ink-1">Add from receipt</div>
            <div className="text-[11px] text-ink-3">
              {stage === "upload" && "Drop a photo, PDF, or paste text from a digital order"}
              {stage === "parsing" && "Reading your receipt…"}
              {stage === "review" && "Review and commit"}
              {stage === "error" && "Something went wrong"}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 grid place-items-center rounded-[8px] text-ink-2 hover:bg-surface-2"
          >
            <X size={16} />
          </button>
        </div>

        {stage === "upload" && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-4">
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.heic"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <button
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handleFile(f);
              }}
              className={`flex flex-col items-center gap-3 py-10 px-6 border-2 border-dashed rounded-[14px] bg-surface-2 text-center transition cursor-pointer ${
                dragOver ? "border-accent bg-accent-soft" : "border-line hover:border-accent-line"
              }`}
            >
              <div className="w-12 h-12 rounded-[12px] bg-accent-soft text-accent-ink grid place-items-center">
                <Upload size={20} />
              </div>
              <div>
                <div className="text-[14px] font-semibold text-ink-1">Drop a photo or PDF</div>
                <div className="text-[12px] text-ink-3 mt-1">JPG, PNG, HEIC, PDF up to 20MB</div>
              </div>
            </button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-line-soft" />
              <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">or paste text</span>
              <div className="flex-1 h-px bg-line-soft" />
            </div>

            <div className="flex flex-col gap-2">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste your Walmart / Instacart / Amazon Fresh order summary…"
                rows={6}
                className="w-full rounded-[10px] border border-line bg-surface-2 p-3 text-[13px] text-ink-1 placeholder:text-ink-3 focus:outline-none focus:border-accent resize-y"
              />
              <div className="flex justify-end">
                <Button variant="primary" size="sm" icon={ClipboardPaste} disabled={!pasteText.trim()} onClick={handlePaste}>
                  Parse pasted text
                </Button>
              </div>
            </div>
          </div>
        )}

        {stage === "parsing" && (
          <div className="flex-1 grid place-items-center p-10 text-center">
            <div>
              <div
                className="w-11 h-11 mx-auto mb-4 rounded-full amp-spin"
                style={{
                  borderWidth: 3,
                  borderStyle: "solid",
                  borderColor: "var(--accent-soft)",
                  borderTopColor: "var(--accent)",
                }}
              />
              <div className="text-[15px] font-semibold text-ink-1 mb-1">Reading your receipt…</div>
              <div className="text-[13px] text-ink-3">Identifying items, quantities, and prices. ~30 seconds.</div>
            </div>
          </div>
        )}

        {stage === "error" && (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="rounded-[10px] border border-warn-line bg-warn-soft text-warn-ink px-3 py-2 text-[13px] mb-4">
              {error ?? "Parse failed."}
            </div>
            <div className="text-[13px] text-ink-2">
              Try a clearer photo, or paste the text from a digital order if you have one.
            </div>
            <div className="mt-4">
              <Button variant="ghost" size="sm" onClick={() => { setStage("upload"); setError(null); }}>
                Try again
              </Button>
            </div>
          </div>
        )}

        {stage === "review" && parsed && (
          <ReviewStage
            parseResult={parsed}
            onCommitted={() => { onCommitted(); onClose(); }}
            onCancel={onClose}
          />
        )}
      </div>
    </div>
  );
}

// Placeholder so the file typechecks; Task 11 fills this in.
function ReviewStage(_props: { parseResult: ParseResult; onCommitted: () => void; onCancel: () => void }) {
  return (
    <div className="flex-1 grid place-items-center p-10 text-center text-ink-3 text-[13px]">
      Review UI lands in the next task.
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/AddFromReceiptModal.tsx
git commit -m "feat(client): AddFromReceiptModal upload stage"
```

---

## Task 11: AddFromReceiptModal — review stage

**Files:**
- Modify: `client/src/components/AddFromReceiptModal.tsx` — replace the `ReviewStage` placeholder.

**Why:** The interactive guts. Editable header (store, trip date), per-row editable food items (matched ingredient pill, qty + unit, location dropdown, expiration date, price), collapsed non-food section, footer commit.

- [ ] **Step 1: Add imports at the top of the file**

In `client/src/components/AddFromReceiptModal.tsx`, extend the imports at the top:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { X, Upload, Receipt as ReceiptIcon, ClipboardPaste, ChevronDown, ChevronRight, Plus } from "lucide-react";
import { commitReceipt, parseReceipt, type CommitItemEdit, type ParseResult, type ParsedReceiptItem } from "../api/receipts";
import { getIngredients, type Ingredient } from "../api/ingredients";
import Button from "./ui/Button";
```

- [ ] **Step 2: Replace the `ReviewStage` placeholder with the real implementation**

Replace the entire `function ReviewStage(...)` block at the bottom of the file with:

```tsx
const LOCATIONS: Array<"fridge" | "freezer" | "pantry"> = ["fridge", "freezer", "pantry"];
const CATEGORIES = ["produce", "protein", "dairy", "pantry_staple", "grain", "spice", "condiment", "frozen", "other"] as const;

interface RowState extends CommitItemEdit {
  // Mirror of the parsed item, plus a UI-only flag for the inline create mini-form.
  showCreateForm: boolean;
  matchedIngredientName?: string | null;
  matchConfidence?: "high" | "low" | null;
}

function buildInitialRows(items: ParsedReceiptItem[], ingredients: Ingredient[]): RowState[] {
  const ingById = new Map(ingredients.map((i) => [i.id, i.name]));
  return items.map((it, index) => ({
    index,
    ingredientId: it.ingredientId ?? null,
    parsedName: it.parsedName,
    quantity: it.quantity,
    unit: it.unit,
    price: it.price ?? null,
    kind: it.kind,
    categoryGuess: it.categoryGuess ?? null,
    locationGuess: it.locationGuess ?? "pantry",
    expirationDate: null,
    isCommitted: it.kind === "food",
    showCreateForm: false,
    matchedIngredientName: it.ingredientId != null ? ingById.get(it.ingredientId) ?? null : null,
    matchConfidence: it.matchConfidence ?? null,
  }));
}

function ReviewStage({
  parseResult,
  onCommitted,
  onCancel,
}: {
  parseResult: ParseResult;
  onCommitted: () => void;
  onCancel: () => void;
}) {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [store, setStore] = useState(parseResult.payload.store);
  const [tripDate, setTripDate] = useState(parseResult.payload.tripDate);
  const [rows, setRows] = useState<RowState[]>([]);
  const [showNonFood, setShowNonFood] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getIngredients().then((ings) => {
      setIngredients(ings);
      setRows(buildInitialRows(parseResult.payload.items, ings));
    });
  }, [parseResult]);

  const foodRows = useMemo(() => rows.filter((r) => r.kind === "food"), [rows]);
  const nonFoodRows = useMemo(() => rows.filter((r) => r.kind !== "food"), [rows]);
  const committedFoodCount = foodRows.filter((r) => r.isCommitted).length;
  const liveTotal = useMemo(
    () =>
      rows
        .filter((r) => r.isCommitted)
        .reduce((sum, r) => sum + (r.price ?? 0), 0),
    [rows],
  );

  const updateRow = (index: number, patch: Partial<RowState>) => {
    setRows((prev) => prev.map((r) => (r.index === index ? { ...r, ...patch } : r)));
  };

  const submit = async () => {
    setCommitting(true);
    setError(null);
    try {
      const items: CommitItemEdit[] = rows.map(({ showCreateForm, matchedIngredientName, matchConfidence, ...rest }) => rest);
      await commitReceipt({
        parseId: parseResult.parseId,
        store,
        tripDate,
        subtotal: parseResult.payload.subtotal ?? null,
        tax: parseResult.payload.tax ?? null,
        total: parseResult.payload.total,
        items,
      });
      onCommitted();
    } catch (e: any) {
      setError(e?.message ?? "Commit failed.");
    } finally {
      setCommitting(false);
    }
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Store">
            <input
              value={store}
              onChange={(e) => setStore(e.target.value)}
              className="h-9 rounded-[10px] border border-line bg-surface-2 px-3 text-[13px] text-ink-1 focus:outline-none focus:border-accent"
            />
          </Field>
          <Field label="Trip date">
            <input
              type="date"
              value={tripDate}
              onChange={(e) => setTripDate(e.target.value)}
              className="h-9 rounded-[10px] border border-line bg-surface-2 px-3 text-[13px] text-ink-1 focus:outline-none focus:border-accent"
            />
          </Field>
          <Field label="Total">
            <div className="h-9 rounded-[10px] border border-line-soft bg-surface-2 px-3 text-[14px] text-ink-1 font-semibold tabular-nums grid place-items-center">
              ${parseResult.payload.total.toFixed(2)}
              <span className="text-[10.5px] text-ink-3 font-normal">
                rolling: ${liveTotal.toFixed(2)}
              </span>
            </div>
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">
            Food items ({committedFoodCount}/{foodRows.length} selected)
          </div>
          <ul className="flex flex-col gap-1.5">
            {foodRows.map((row) => (
              <RowEditor
                key={row.index}
                row={row}
                ingredients={ingredients}
                disabled={committing}
                onPatch={(patch) => updateRow(row.index, patch)}
              />
            ))}
            {foodRows.length === 0 && (
              <div className="text-[12px] text-ink-3 px-2 py-3">No food items detected.</div>
            )}
          </ul>
        </div>

        {nonFoodRows.length > 0 && (
          <div className="flex flex-col gap-2">
            <button
              onClick={() => setShowNonFood((v) => !v)}
              className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink-1 self-start"
            >
              {showNonFood ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {nonFoodRows.length} non-food item{nonFoodRows.length === 1 ? "" : "s"} hidden
            </button>
            {showNonFood && (
              <ul className="flex flex-col gap-1 pl-1">
                {nonFoodRows.map((row) => (
                  <li key={row.index} className="text-[12px] text-ink-3 flex items-center gap-2">
                    <span className="flex-1 truncate">{row.parsedName}</span>
                    {row.price != null && <span className="tabular-nums">${row.price.toFixed(2)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-[10px] border border-warn-line bg-warn-soft text-warn-ink px-3 py-2 text-[13px]">
            {error}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-4 sm:px-5 py-3 border-t border-line-soft bg-surface-2">
        <Button variant="ghost" size="sm" disabled={committing} onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" disabled={committing || committedFoodCount === 0} onClick={submit}>
          {committing ? "Committing…" : `Commit ${committedFoodCount} item${committedFoodCount === 1 ? "" : "s"} to Pantry`}
        </Button>
      </div>
    </>
  );
}

function RowEditor({
  row, ingredients, disabled, onPatch,
}: {
  row: RowState;
  ingredients: Ingredient[];
  disabled: boolean;
  onPatch: (patch: Partial<RowState>) => void;
}) {
  return (
    <li className={`rounded-[10px] border border-line-soft bg-surface-2 px-3 py-2 ${!row.isCommitted ? "opacity-50" : ""}`}>
      <div className="grid grid-cols-[auto_1fr_auto_auto] sm:grid-cols-[auto_2fr_1fr_1fr_1fr_auto_auto] gap-2 items-center">
        <input
          type="checkbox"
          checked={row.isCommitted}
          disabled={disabled}
          onChange={(e) => onPatch({ isCommitted: e.target.checked })}
          className="w-4 h-4 accent-accent"
        />

        {/* Ingredient match cell */}
        <div className="min-w-0">
          {row.ingredientId != null ? (
            <div className="flex items-center gap-1.5">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-[6px] text-[11.5px] font-medium ${
                  row.matchConfidence === "low"
                    ? "bg-warn-soft text-warn-ink border border-warn-line"
                    : "bg-accent-soft text-accent-ink border border-accent-line"
                }`}
              >
                {row.matchedIngredientName ?? `#${row.ingredientId}`}
              </span>
              <span className="text-[11px] text-ink-3 truncate">{row.parsedName}</span>
            </div>
          ) : (
            <button
              onClick={() => onPatch({ showCreateForm: !row.showCreateForm })}
              disabled={disabled}
              className="inline-flex items-center gap-1 text-[12px] text-accent-ink hover:underline"
            >
              <Plus size={12} /> Create &ldquo;{row.parsedName}&rdquo;
            </button>
          )}
        </div>

        <input
          type="number"
          step="0.01"
          value={row.quantity}
          disabled={disabled || !row.isCommitted}
          onChange={(e) => onPatch({ quantity: Number(e.target.value) })}
          className="h-8 w-20 rounded-[8px] border border-line bg-surface-1 px-2 text-[12.5px] text-ink-1 tabular-nums focus:outline-none focus:border-accent disabled:opacity-50"
        />
        <input
          type="text"
          value={row.unit}
          disabled={disabled || !row.isCommitted}
          onChange={(e) => onPatch({ unit: e.target.value })}
          className="h-8 w-20 rounded-[8px] border border-line bg-surface-1 px-2 text-[12.5px] text-ink-1 focus:outline-none focus:border-accent disabled:opacity-50"
        />
        <select
          value={row.locationGuess ?? "pantry"}
          disabled={disabled || !row.isCommitted}
          onChange={(e) => onPatch({ locationGuess: e.target.value as any })}
          className="h-8 rounded-[8px] border border-line bg-surface-1 px-2 text-[12.5px] text-ink-1 capitalize focus:outline-none focus:border-accent disabled:opacity-50"
        >
          {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <input
          type="date"
          value={row.expirationDate ?? ""}
          disabled={disabled || !row.isCommitted}
          onChange={(e) => onPatch({ expirationDate: e.target.value || null })}
          className="h-8 rounded-[8px] border border-line bg-surface-1 px-2 text-[12px] text-ink-1 focus:outline-none focus:border-accent disabled:opacity-50"
        />
        <span className="text-[12.5px] text-ink-2 tabular-nums w-16 text-right">
          {row.price != null ? `$${row.price.toFixed(2)}` : "—"}
        </span>
      </div>

      {row.showCreateForm && row.ingredientId == null && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Field label="Name">
            <input
              value={row.parsedName}
              onChange={(e) => onPatch({ parsedName: e.target.value })}
              className="h-8 rounded-[8px] border border-line bg-surface-1 px-2 text-[12.5px] text-ink-1 focus:outline-none focus:border-accent"
            />
          </Field>
          <Field label="Category">
            <select
              value={row.categoryGuess ?? "other"}
              onChange={(e) => onPatch({ categoryGuess: e.target.value as any })}
              className="h-8 rounded-[8px] border border-line bg-surface-1 px-2 text-[12.5px] text-ink-1 focus:outline-none focus:border-accent"
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
            </select>
          </Field>
          <div className="text-[11px] text-ink-3 self-end pb-1">
            On commit, a new ingredient will be created with these values + unit &ldquo;{row.unit}&rdquo;.
          </div>
        </div>
      )}
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">{label}</label>
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/AddFromReceiptModal.tsx
git commit -m "feat(client): AddFromReceiptModal review stage"
```

---

## Task 12: Pantry strips + page wiring

**Files:**
- Create: `client/src/components/SpendingStrip.tsx`
- Create: `client/src/components/RecentReceiptsStrip.tsx`
- Modify: `client/src/pages/Pantry.tsx` — add the button, mount the strips, manage modal open state.

**Why:** Final wiring. Pantry page learns about receipts.

- [ ] **Step 1: Create `client/src/components/SpendingStrip.tsx`**

```tsx
import { useEffect, useState } from "react";
import { DollarSign } from "lucide-react";
import { getWeeklySpending, type WeeklySpending } from "../api/receipts";

export default function SpendingStrip({ refreshKey }: { refreshKey: number }) {
  const [spending, setSpending] = useState<WeeklySpending | null>(null);

  useEffect(() => {
    getWeeklySpending().then(setSpending).catch(() => setSpending(null));
  }, [refreshKey]);

  if (!spending || spending.tripCount === 0) return null;

  return (
    <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] bg-accent-soft border border-accent-line text-accent-ink text-[13px]">
      <DollarSign size={14} />
      <span>
        <span className="font-semibold">This week: ${spending.total.toFixed(2)}</span>
        {" "}across {spending.tripCount} trip{spending.tripCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Create `client/src/components/RecentReceiptsStrip.tsx`**

```tsx
import { useEffect, useState } from "react";
import { ShoppingBag } from "lucide-react";
import { getRecentReceipts, type Receipt } from "../api/receipts";

export default function RecentReceiptsStrip({ refreshKey }: { refreshKey: number }) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);

  useEffect(() => {
    getRecentReceipts(5).then(setReceipts).catch(() => setReceipts([]));
  }, [refreshKey]);

  if (receipts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">Recent receipts</div>
      <div className="flex gap-2 overflow-x-auto amp-no-scrollbar -mx-4 px-4 sm:-mx-0 sm:px-0">
        {receipts.map((r) => (
          <div
            key={r.id}
            className="snap-start shrink-0 w-[180px] bg-surface-1 border border-line rounded-[12px] p-3 flex flex-col gap-1"
          >
            <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
              <ShoppingBag size={11} /> {r.store}
            </div>
            <div className="text-[15px] font-semibold text-ink-1 tabular-nums">${Number(r.total).toFixed(2)}</div>
            <div className="text-[11px] text-ink-3">
              {new Date(r.tripDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              {" · "}{r._count?.items ?? 0} item{(r._count?.items ?? 0) === 1 ? "" : "s"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

(Cards are display-only at this point. Task 13 makes them clickable and adds the read-only detail modal.)

- [ ] **Step 3: Wire `Pantry.tsx`**

Open `client/src/pages/Pantry.tsx`. Make three edits:

**Edit A — extend imports.** Add to the lucide-react import block:

```tsx
import { Plus, Refrigerator, BookMarked, Snowflake, Receipt as ReceiptIcon } from "lucide-react";
```

After the existing component imports, add:

```tsx
import AddFromReceiptModal from "../components/AddFromReceiptModal";
import SpendingStrip from "../components/SpendingStrip";
import RecentReceiptsStrip from "../components/RecentReceiptsStrip";
```

**Edit B — add modal + refresh state inside `Pantry()`.** Near the other `useState` calls (currently lines 40-44):

```tsx
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [receiptRefreshKey, setReceiptRefreshKey] = useState(0);
```

**Edit C — replace the header CTA + add the two strips.** Find the header block (lines 71-82 today):

```tsx
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[12px] uppercase tracking-[0.1em] text-ink-3 mb-1.5">
            {items.length} item{items.length === 1 ? "" : "s"} on hand
          </div>
          <h1 className="text-[26px] sm:text-[30px] font-semibold -tracking-[0.02em] text-ink-1">Pantry</h1>
        </div>
        <Button variant="primary" icon={Plus} onClick={() => setShowAdd((v) => !v)}>
          Add item
        </Button>
      </div>
```

Replace with:

```tsx
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[12px] uppercase tracking-[0.1em] text-ink-3 mb-1.5">
            {items.length} item{items.length === 1 ? "" : "s"} on hand
          </div>
          <h1 className="text-[26px] sm:text-[30px] font-semibold -tracking-[0.02em] text-ink-1">Pantry</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon={ReceiptIcon} onClick={() => setShowReceiptModal(true)}>
            Add from receipt
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => setShowAdd((v) => !v)}>
            Add item
          </Button>
        </div>
      </div>

      <SpendingStrip refreshKey={receiptRefreshKey} />
      <RecentReceiptsStrip refreshKey={receiptRefreshKey} />
```

Finally, add the modal rendering at the very end of the top-level JSX, just before the outer closing `</div>`:

```tsx
      {showReceiptModal && (
        <AddFromReceiptModal
          onClose={() => setShowReceiptModal(false)}
          onCommitted={() => {
            setReceiptRefreshKey((k) => k + 1);
            load(); // refresh pantry items so newly-added pantry rows appear
          }}
        />
      )}
```

- [ ] **Step 4: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/SpendingStrip.tsx client/src/components/RecentReceiptsStrip.tsx client/src/pages/Pantry.tsx
git commit -m "feat(client): wire receipt flow into Pantry page"
```

---

## Task 13: ReceiptDetailModal (read-only re-open from Recent strip)

**Files:**
- Create: `client/src/components/ReceiptDetailModal.tsx`
- Modify: `client/src/components/RecentReceiptsStrip.tsx` — make cards clickable, manage open-detail state.

**Why:** The spec says clicking a card in the Recent receipts strip should re-open the receipt for inspection. v1 is read-only (no item-level edits post-commit) — header and items just display. Delete is the one mutation available.

- [ ] **Step 1: Create `client/src/components/ReceiptDetailModal.tsx`**

```tsx
import { useEffect, useState } from "react";
import { X, Receipt as ReceiptIcon, Trash2, ShoppingBag } from "lucide-react";
import { deleteReceipt, getReceipt, type Receipt } from "../api/receipts";
import Button from "./ui/Button";

interface Props {
  receiptId: number;
  onClose: () => void;
  onDeleted: () => void;
}

const KIND_LABEL: Record<string, string> = {
  food: "Food",
  non_food: "Non-food",
  unknown: "Unknown",
};

export default function ReceiptDetailModal({ receiptId, onClose, onDeleted }: Props) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  useEffect(() => {
    getReceipt(receiptId)
      .then(setReceipt)
      .catch((e) => setError(e?.message ?? "Failed to load receipt"));
  }, [receiptId]);

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteReceipt(receiptId);
      onDeleted();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Delete failed");
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8 amp-fade-in"
      style={{ background: "rgba(30, 22, 10, 0.55)", backdropFilter: "blur(4px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-1 rounded-[16px] w-full max-w-[640px] max-h-[88vh] flex flex-col overflow-hidden border border-line"
        style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
      >
        <div className="flex items-start gap-3 px-4 sm:px-5 py-3.5 border-b border-line-soft">
          <div className="w-8 h-8 rounded-[8px] bg-accent-soft text-accent-ink grid place-items-center">
            <ReceiptIcon size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-ink-1 flex items-center gap-1.5">
              <ShoppingBag size={12} /> {receipt?.store ?? "Loading…"}
            </div>
            <div className="text-[11px] text-ink-3">
              {receipt
                ? `${new Date(receipt.tripDate).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · $${Number(receipt.total).toFixed(2)}`
                : ""}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 grid place-items-center rounded-[8px] text-ink-2 hover:bg-surface-2"
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="m-4 rounded-[10px] border border-warn-line bg-warn-soft text-warn-ink px-3 py-2 text-[13px]">
            {error}
          </div>
        )}

        {receipt && (
          <>
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              {receipt.items && receipt.items.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {receipt.items.map((it) => (
                    <li
                      key={it.id}
                      className={`grid grid-cols-[1fr_auto_auto] gap-2 px-2 py-1.5 rounded-[6px] text-[12.5px] ${
                        !it.isCommitted ? "opacity-50" : ""
                      } ${it.kind !== "food" ? "text-ink-3" : "text-ink-1"}`}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{it.parsedName}</div>
                        <div className="text-[10.5px] text-ink-3 truncate">
                          {KIND_LABEL[it.kind]}{it.ingredient ? ` · matched ${it.ingredient.name}` : ""}
                        </div>
                      </div>
                      <div className="tabular-nums text-ink-2">
                        {Number(it.quantity).toFixed(2)} {it.unit}
                      </div>
                      <div className="tabular-nums w-16 text-right">
                        {it.price != null ? `$${Number(it.price).toFixed(2)}` : "—"}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-[13px] text-ink-3 text-center p-6">No items.</div>
              )}

              <div className="mt-4 grid grid-cols-3 gap-2 pt-3 border-t border-line-soft">
                <Stat label="Subtotal" value={receipt.subtotal != null ? `$${Number(receipt.subtotal).toFixed(2)}` : "—"} />
                <Stat label="Tax"      value={receipt.tax != null ? `$${Number(receipt.tax).toFixed(2)}` : "—"} />
                <Stat label="Total"    value={`$${Number(receipt.total).toFixed(2)}`} highlight />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 border-t border-line-soft bg-surface-2">
              {confirmingDelete ? (
                <>
                  <span className="text-[12px] text-ink-2">Delete this receipt? Pantry items already added stay.</span>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmingDelete(false)}>Cancel</Button>
                    <Button variant="danger" size="sm" icon={Trash2} disabled={busy} onClick={handleDelete}>
                      {busy ? "Deleting…" : "Delete"}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setConfirmingDelete(true)}>
                    Delete
                  </Button>
                  <Button variant="primary" size="sm" onClick={onClose}>Close</Button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex flex-col gap-0.5 px-3 py-2 rounded-[8px] ${highlight ? "bg-accent-soft border border-accent-line text-accent-ink" : "bg-surface-2 border border-line"}`}>
      <span className="text-[10.5px] uppercase tracking-[0.07em] text-ink-3 font-semibold">{label}</span>
      <span className="text-[14px] font-semibold tabular-nums">{value}</span>
    </div>
  );
}
```

- [ ] **Step 2: Make `RecentReceiptsStrip` cards clickable + manage modal state**

Open `client/src/components/RecentReceiptsStrip.tsx` and replace the entire file with:

```tsx
import { useEffect, useState } from "react";
import { ShoppingBag } from "lucide-react";
import { getRecentReceipts, type Receipt } from "../api/receipts";
import ReceiptDetailModal from "./ReceiptDetailModal";

export default function RecentReceiptsStrip({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    getRecentReceipts(5).then(setReceipts).catch(() => setReceipts([]));
  }, [refreshKey]);

  if (receipts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">Recent receipts</div>
      <div className="flex gap-2 overflow-x-auto amp-no-scrollbar -mx-4 px-4 sm:-mx-0 sm:px-0">
        {receipts.map((r) => (
          <button
            key={r.id}
            onClick={() => setOpenId(r.id)}
            className="snap-start shrink-0 w-[180px] bg-surface-1 border border-line rounded-[12px] p-3 flex flex-col gap-1 text-left hover:border-accent-line transition"
          >
            <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
              <ShoppingBag size={11} /> {r.store}
            </div>
            <div className="text-[15px] font-semibold text-ink-1 tabular-nums">${Number(r.total).toFixed(2)}</div>
            <div className="text-[11px] text-ink-3">
              {new Date(r.tripDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              {" · "}{r._count?.items ?? 0} item{(r._count?.items ?? 0) === 1 ? "" : "s"}
            </div>
          </button>
        ))}
      </div>

      {openId != null && (
        <ReceiptDetailModal
          receiptId={openId}
          onClose={() => setOpenId(null)}
          onDeleted={onChanged}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update `Pantry.tsx` to pass `onChanged`**

In `client/src/pages/Pantry.tsx`, find the `<RecentReceiptsStrip refreshKey={receiptRefreshKey} />` line and replace with:

```tsx
      <RecentReceiptsStrip
        refreshKey={receiptRefreshKey}
        onChanged={() => setReceiptRefreshKey((k) => k + 1)}
      />
```

- [ ] **Step 4: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ReceiptDetailModal.tsx client/src/components/RecentReceiptsStrip.tsx client/src/pages/Pantry.tsx
git commit -m "feat(client): ReceiptDetailModal for read-only re-open from Recent strip"
```

---

## Task 14: Manual smoke test

No code changes — exercise the flows on the dev server's live app.

**Setup:** the dev server lives on WSL and auto-restarts on file changes via `tsx watch`. After Task 1 the migration is already deployed and the server is running the new code. Confirm the client also has the new code by opening the app:

```bash
# Browser
http://<dev-host>:5173/pantry
```

- [ ] **Smoke 1 — happy path with pasted text**

1. Navigate to `/pantry`. Confirm the new **Add from receipt** button appears in the header next to **Add item**. Confirm `<SpendingStrip>` and `<RecentReceiptsStrip>` are NOT yet visible (no receipts exist).
2. Click **Add from receipt**. Modal opens on the upload stage.
3. Paste a synthetic Walmart-style block (or use a real one if you have one):

```
Walmart
Trip: 2026-05-03

Great Value Whole Milk, 1 Gallon       $3.97
Bananas, 2.45 lb @ $0.58/lb            $1.42
Tide Pods 81ct                         $19.97
ORG Baby Spinach 5oz                   $3.49
Subtotal                              $28.85
Tax                                    $1.74
Total                                 $30.59
```

4. Click **Parse pasted text**. Loading state shows ~30s.
5. Modal switches to review. Verify:
   - Store = "Walmart", Trip date = 2026-05-03, Total = $30.59.
   - Three food rows: Whole Milk, Bananas, Baby Spinach.
   - One non-food collapsed: "Tide Pods" (1 item hidden).
   - At least Whole Milk and Bananas should match existing ingredients (assuming they're in your DB) and show green pills. Baby Spinach may show "Create" if new.
6. Click **Commit 3 items to Pantry**. Modal closes.
7. Pantry page now shows the three new items (or merged into existing rows for milk/bananas if you already had them). The `<SpendingStrip>` shows "This week: $30.59 across 1 trip". The `<RecentReceiptsStrip>` shows the new Walmart card.

- [ ] **Smoke 2 — happy path with photo upload**

1. Click **Add from receipt** again. Drop a JPG/PNG photo of any grocery receipt (or a synthetic one from the internet).
2. Wait for parse. Review the parsed rows; expect a mix of matched and unmatched items, possibly with the rescue pass triggered (check server logs for `[receiptService] rescue pass` only on failure — success is silent).
3. Adjust any wrong rows (un-check non-food that got tagged as food, fix obviously-wrong ingredients, set a few expiration dates).
4. Commit. Verify Pantry update.

- [ ] **Smoke 3 — merge into existing pantry row**

1. Open the modal a third time. Paste a single milk line:

```
Aldi
Trip: 2026-05-03

Friendly Farms Whole Milk 1 Gallon      $2.99
Total                                   $2.99
```

2. Commit. Verify the existing milk row's quantity has incremented (rather than a new row being created), assuming the matched ingredient + unit + location all line up with the prior commit.
3. If a second row was created instead, the matcher likely picked a different `Ingredient` row for "whole milk" vs "great value whole milk". That's expected — matching is fuzzy. Manually delete the duplicate from Pantry.

- [ ] **Smoke 4 — no-match / create-new flow**

1. Open the modal. Paste:

```
Aldi
Trip: 2026-05-03

DRAGONFRUIT EACH                        $4.99
Total                                   $4.99
```

2. The Dragonfruit row should be unmatched. Click `+ Create "dragonfruit"`. The inline form opens with name/category fields.
3. Adjust as needed. Commit. Verify a new `Ingredient` was created and a new `PantryItem` row landed in the chosen location.

- [ ] **Smoke 5 — parse failure**

1. Open the modal. Paste a single character (`x`). Click parse.
2. Server should return either a parse failure or an empty items list. Modal should show the error stage with **Try again**, OR succeed with no items (in which case the **Commit** button should be disabled because `committedFoodCount === 0`).

- [ ] **Smoke 6 — stash expiration**

1. Open the modal, parse a real receipt, then leave the review modal sitting for >15 minutes (or fast-forward by editing `TTL_MS` in `receiptParseSessions.ts` for testing — revert before commit).
2. Click **Commit**. Expect a 410-style error: "Parse session expired or not found. Please re-upload."

- [ ] **Smoke 7 — re-open + delete a past receipt**

1. Click any card in the Recent receipts strip. The `ReceiptDetailModal` opens with the store, trip date, all line items (food and non-food), and the subtotal/tax/total summary.
2. Verify display-only — no editable fields, just numbers and labels.
3. Click **Delete**, then confirm. Modal closes; the card disappears from the Recent strip; the spending strip total decreases. Pantry items added by that receipt remain (no FK back, by design).

- [ ] **Final typecheck + server tests**

```bash
cd client && npx tsc --noEmit
cd ../server && npx vitest run
```

Expected: client clean. Server tests should be 28 (existing) + 13 (ingredientMatcher) + 7 (receiptParseSessions) + 8 (receiptParser) + 10 (receiptService) = **66 passing**.

- [ ] **Final commit (only if smoke surfaced issues)**

If anything broke during smoke, fix, re-run the affected smoke, commit with a clear message. If everything passed first try, no extra commit needed.

---

## Task 15: Push and open PR

- [ ] **Step 1: Push the branch (if not already pushed in Task 1)**

```bash
git push -u origin feature/receipt-tracking
```

If Task 1 already pushed it, just `git push`.

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat: track receipts and auto-populate pantry" --body "$(cat <<'EOF'
## Summary

- New **Add from receipt** flow on the Pantry page. Accepts pasted text from digital orders (Walmart, Instacart, Amazon Fresh) or uploaded photo / PDF of a paper receipt (Aldi, etc.).
- Claude extracts line items, store, trip date, subtotal/tax/total. Server fuzzy-matches each food line against the existing `Ingredient` table; if more than 30% of food lines come back weak, fires a second Claude pass with the existing ingredient list as context.
- Review modal lets the user fix anything wrong, with one-click ingredient creation for unmatched lines, before committing. Commit transaction merges into existing pantry rows when `(ingredient, unit, location)` match (FIFO bias on expiration), otherwise creates new rows.
- Pantry header gains a "This week: $X across N trips" strip and a horizontal strip of the last 5 receipts.
- New tables: `receipts`, `receipt_items`. No changes to `pantry_items` or `ingredients` (other than a back-relation for Prisma).

## Test plan

Automated:
- [x] ingredientMatcher: 13 unit tests (abbreviation expansion + fuzzy matching + confidence labeling)
- [x] receiptParseSessions: 7 unit tests (stash, peek, pop, expiry, rawText handling)
- [x] receiptParser: 8 unit tests (prompt builders + JSON extraction across fenced + greedy formats)
- [x] receiptService: 10 unit tests (merge math + weekly window math)
- [x] Client typecheck (\`npx tsc --noEmit\`) clean
- [x] Server tests still 28/28 for the pre-existing suite, plus 38 new = 66 total passing

Interactive smokes (run by reviewer — require dev server + Claude access):
- [ ] Smoke 1 — happy path with pasted text
- [ ] Smoke 2 — happy path with photo upload
- [ ] Smoke 3 — merge into existing pantry row
- [ ] Smoke 4 — no-match / create-new flow
- [ ] Smoke 5 — parse failure
- [ ] Smoke 6 — stash expiration after >15 min
- [ ] Smoke 7 — re-open + delete a past receipt from Recent strip

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Report the PR URL when done.
