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

  const fileType = input.kind === "pdf" ? "PDF" : "photo";
  return `Read the grocery receipt ${fileType} at this path: ${input.path}

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
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
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
