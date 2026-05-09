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
  suggestedExpiration?: string | null;
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
