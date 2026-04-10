import { apiFetch } from "./client";
import type { Ingredient } from "./ingredients";

export interface ShoppingItem {
  id: number;
  quantityNeeded: number;
  quantityOnHand: number;
  quantityToBuy: number;
  checked: boolean;
  ingredient: Ingredient;
}

export const getShoppingList = (planId: number) =>
  apiFetch<ShoppingItem[]>(`/shopping/${planId}`);
export const generateShoppingList = (planId: number) =>
  apiFetch<ShoppingItem[]>(`/shopping/generate/${planId}`, { method: "POST" });
export const toggleItem = (id: number, checked: boolean) =>
  apiFetch<ShoppingItem>(`/shopping/item/${id}`, { method: "PUT", body: JSON.stringify({ checked }) });
