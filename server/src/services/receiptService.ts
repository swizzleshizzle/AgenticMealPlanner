import { PrismaClient, Prisma } from "@prisma/client";
import type { PantryLocation } from "@prisma/client";
import { runFirstPass, runRescuePass, type ReceiptParseInput } from "../claude/receiptParser.js";
import { fuzzyMatchIngredient, type IngredientCandidate } from "../claude/ingredientMatcher.js";
import { stashReceiptParse, peekReceiptParse, popReceiptParse, type ParsedReceiptPayload } from "./receiptParseSessions.js";
import { moveSourceIntoReceipt } from "./receiptStorage.js";
import { suggestExpirationDate } from "./pantryBatchService.js";

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

// ---------------------------------------------------------------------------
// Pure helpers (extracted for unit testing).
// ---------------------------------------------------------------------------

export interface ExistingPantryBatch {
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
  existing: ExistingPantryBatch[],
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
  // Sunday-anchored week. weekStart = Sunday 00:00 UTC, weekEnd = Saturday 23:59:59.999 UTC.
  // We use the *local* day-of-week to decide which calendar week the reference belongs to
  // (so callers can pass a local-time Date and get the obvious answer), but anchor the
  // resulting boundaries at UTC midnight so toISOString().slice(0,10) yields the expected
  // calendar dates regardless of the host TZ.
  const ref = new Date(reference);
  const day = ref.getDay(); // 0 = Sunday (local)
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const d = ref.getDate() - day;
  const weekStart = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
  const weekEnd = new Date(Date.UTC(y, m, d + 6, 23, 59, 59, 999));
  return { weekStart, weekEnd };
}

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
    //    create the ReceiptItem row, then create a fresh PantryBatch if it's food.
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
      const receiptItemRow = await tx.receiptItem.create({
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

      // 3c. If food + committed + has an ingredient, create a fresh PantryBatch.
      if (edit.kind !== "food" || !edit.isCommitted || ingredientId == null) continue;

      const ingredient = await tx.ingredient.findUnique({ where: { id: ingredientId } });
      const expirationDate =
        edit.expirationDate ? new Date(edit.expirationDate)
        : ingredient ? suggestExpirationDate({
            tripDate: new Date(input.tripDate),
            location: (edit.locationGuess ?? "pantry") as PantryLocation,
            ingredient: {
              shelfLifeFridgeDays: ingredient.shelfLifeFridgeDays,
              shelfLifeFreezerDays: ingredient.shelfLifeFreezerDays,
              shelfLifePantryDays: ingredient.shelfLifePantryDays,
            },
          })
        : null;

      const newBatch = await tx.pantryBatch.create({
        data: {
          ingredientId,
          quantity: edit.quantity,
          unit: edit.unit,
          location: (edit.locationGuess ?? "pantry") as any,
          expirationDate,
          purchaseDate: new Date(input.tripDate),
          costAtPurchase: edit.price != null ? new Prisma.Decimal(edit.price) : null,
          tags: [],
          receiptItemId: receiptItemRow.id,
        },
      });
    }

    return receipt;
  });

  // Transaction succeeded — only now consume the stash entry.
  popReceiptParse(input.parseId);
  return result;
}

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
  // Cascade deletes the receipt_items via the FK; PantryBatches are untouched
  // because the FK from PantryBatch.receiptItemId uses SET NULL on delete.
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
