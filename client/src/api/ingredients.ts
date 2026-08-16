// client/src/api/ingredients.ts
import { apiFetch } from "./client";

export type IngredientCategory =
  | "produce" | "protein" | "dairy" | "pantry_staple" | "grain"
  | "spice" | "condiment" | "frozen" | "other";

export type PantryLocation = "fridge" | "freezer" | "pantry";

export interface Ingredient {
  id: number;
  name: string;
  category: IngredientCategory;
  defaultUnit: string;
  defaultLocation: PantryLocation | null;
  densityGPerMl: number | null;
  gramsPerCount: number | null;
  shelfLifeFridgeDays: number | null;
  shelfLifeFreezerDays: number | null;
  shelfLifePantryDays: number | null;
  lowStockThreshold: number | null;
  lowStockUnit: string | null;
  isOneOff: boolean;
  /** Retail display for shopping: label ("1-lb pack") + how much of defaultUnit it holds. */
  purchaseUnitName: string | null;
  purchaseUnitQty: number | null;
}

export interface IngredientUpdate {
  name?: string;
  category?: IngredientCategory;
  defaultUnit?: string;
  defaultLocation?: PantryLocation | null;
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
}

export const getIngredients = (opts: { includeOneOffs?: boolean } = {}) =>
  apiFetch<Ingredient[]>(`/ingredients${opts.includeOneOffs ? "?includeOneOffs=true" : ""}`);

export const createIngredient = (data: Partial<Ingredient> & { name: string; category: IngredientCategory; defaultUnit: string }) =>
  apiFetch<Ingredient>("/ingredients", { method: "POST", body: JSON.stringify(data) });

export const updateIngredient = (id: number, data: IngredientUpdate) =>
  apiFetch<Ingredient>(`/ingredients/${id}`, { method: "PATCH", body: JSON.stringify(data) });

export const saveAlias = (alias: string, ingredientId: number) =>
  apiFetch<{ id: number; alias: string; ingredientId: number }>("/ingredients/aliases", {
    method: "POST",
    body: JSON.stringify({ alias, ingredientId }),
  });

export const deleteAlias = (alias: string) =>
  apiFetch<void>(`/ingredients/aliases/${encodeURIComponent(alias)}`, { method: "DELETE" });
