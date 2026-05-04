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
