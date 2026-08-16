// client/src/api/pantry.ts
import { apiFetch } from "./client";
import type { Ingredient } from "./ingredients";

export type PantryLocation = "fridge" | "freezer" | "pantry";

export interface PantryBatch {
  id: number;
  ingredientId: number;
  quantity: number;
  unit: string;
  location: PantryLocation;
  expirationDate: string | null;
  purchaseDate: string | null;
  costAtPurchase: string | null; // Decimal serialized as string
  tags: string[];
  receiptItemId: number | null;
  consumedAt: string | null;
  createdAt: string;
  updatedAt: string;
  ingredient?: Ingredient;
}

export interface PantryCard {
  ingredient: Ingredient;
  batches: PantryBatch[];
  totalsByUnit: Array<{ unit: string; qty: number }>;
  canonicalTotal: { qty: number; unit: string } | null;
  partialTotal: boolean;
  soonestExpiration: string | null;
  nextExpirationDays: number | null;
  isLowStock: boolean;
  batchCount: number;
}

export interface PantryQuery {
  location?: PantryLocation;
  category?: string;
  q?: string;
  sort?: "name" | "expiring" | "added" | "lowstock";
  lowOnly?: boolean;
}

export const getPantry = (q: PantryQuery = {}): Promise<PantryCard[]> => {
  const params = new URLSearchParams();
  if (q.location) params.set("location", q.location);
  if (q.category) params.set("category", q.category);
  if (q.q) params.set("q", q.q);
  if (q.sort) params.set("sort", q.sort);
  if (q.lowOnly) params.set("lowOnly", "true");
  const qs = params.toString();
  return apiFetch<PantryCard[]>(`/pantry${qs ? `?${qs}` : ""}`);
};

export interface CreateBatchInput {
  ingredientId?: number;
  newIngredient?: {
    name: string;
    category: string;
    defaultUnit: string;
    defaultLocation?: PantryLocation;
    densityGPerMl?: number | null;
    gramsPerCount?: number | null;
    shelfLifeFridgeDays?: number | null;
    shelfLifeFreezerDays?: number | null;
    shelfLifePantryDays?: number | null;
    lowStockThreshold?: number | null;
    lowStockUnit?: string | null;
    isOneOff?: boolean;
    purchaseUnitName?: string | null;
    purchaseUnitQty?: number | null;
  };
  quantity: number;
  unit: string;
  location: PantryLocation;
  expirationDate?: string | null;
  purchaseDate?: string | null;
  costAtPurchase?: number | null;
  tags?: string[];
}

export const createBatch = (input: CreateBatchInput) =>
  apiFetch<PantryBatch>("/pantry/batches", { method: "POST", body: JSON.stringify(input) });

export interface UpdateBatchInput {
  quantity?: number;
  unit?: string;
  location?: PantryLocation;
  expirationDate?: string | null;
  purchaseDate?: string | null;
  costAtPurchase?: number | null;
  tags?: string[];
}

export const updateBatch = (id: number, input: UpdateBatchInput) =>
  apiFetch<PantryBatch>(`/pantry/batches/${id}`, { method: "PATCH", body: JSON.stringify(input) });

export const deleteBatch = (id: number) =>
  apiFetch<PantryBatch>(`/pantry/batches/${id}`, { method: "DELETE" });

export const restoreBatch = (id: number) =>
  apiFetch<PantryBatch>(`/pantry/batches/${id}/restore`, { method: "POST" });
