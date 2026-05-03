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
