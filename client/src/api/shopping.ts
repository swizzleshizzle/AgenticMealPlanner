import { apiFetch } from "./client";
import type { Ingredient } from "./ingredients";

export interface ShoppingItem {
  id: number;
  quantityNeeded: number;
  quantityOnHand: number;
  quantityToBuy: number;
  checked: boolean;
  /** A pantry or recipe term was skipped by an impossible unit conversion, so the numbers may over-ask. */
  partial?: boolean;
  ingredient: Ingredient;
}

export interface LowStockSuggestion {
  ingredientId: number;
  name: string;
  currentQty: number;
  currentUnit: string;
  threshold: number | null;
  thresholdUnit: string | null;
}

export interface ShoppingListResponse {
  items: ShoppingItem[];
  staples: string[];
}

export const getShoppingList = (planId: number) =>
  apiFetch<ShoppingListResponse>(`/shopping/${planId}`);
export const generateShoppingList = (planId: number) =>
  apiFetch<ShoppingListResponse>(`/shopping/generate/${planId}`, { method: "POST" });
export const toggleItem = (id: number, checked: boolean) =>
  apiFetch<ShoppingItem>(`/shopping/item/${id}`, { method: "PUT", body: JSON.stringify({ checked }) });
export const getLowStockSuggestions = () =>
  apiFetch<LowStockSuggestion[]>("/shopping/low-stock");

export interface CustomShoppingItem {
  id: number;
  planId: number;
  name: string;
  qtyText: string | null;
  checked: boolean;
  createdAt: string;
}

export const getCustomShoppingItems = (planId: number) =>
  apiFetch<CustomShoppingItem[]>(`/shopping/${planId}/custom`);

export const createCustomShoppingItem = (
  planId: number,
  input: { name: string; qtyText?: string },
) =>
  apiFetch<CustomShoppingItem>(`/shopping/${planId}/custom`, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const updateCustomShoppingItem = (
  id: number,
  patch: { checked?: boolean; name?: string; qtyText?: string },
) =>
  apiFetch<CustomShoppingItem>(`/shopping/custom/${id}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });

export const deleteCustomShoppingItem = (id: number) =>
  apiFetch<void>(`/shopping/custom/${id}`, { method: "DELETE" });
