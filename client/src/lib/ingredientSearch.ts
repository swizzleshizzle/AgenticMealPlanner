import Fuse from "fuse.js";
import type { Ingredient, PantryLocation } from "../api/ingredients";

const MAX_RESULTS = 12; // matches AddIngredientRow's list size

/**
 * Fuzzy-filter the ingredient list for the combobox dropdown.
 * Empty query → first MAX_RESULTS in list order (browse mode).
 */
export function filterIngredients(query: string, ingredients: Ingredient[]): Ingredient[] {
  const q = query.trim();
  if (!q) return ingredients.slice(0, MAX_RESULTS);
  const fuse = new Fuse(ingredients, { keys: ["name"], threshold: 0.4, ignoreLocation: true });
  return fuse.search(q, { limit: MAX_RESULTS }).map((r) => r.item);
}

/**
 * Mirror of the server's parse-time suggestion (receiptService.parseReceipt):
 * tripDate + the picked ingredient's shelf life for the chosen location.
 */
export function recomputeExpiration(
  tripDate: string,
  location: PantryLocation | null,
  ingredient: Ingredient,
): string | null {
  if (!location) return null;
  const days =
    location === "fridge" ? ingredient.shelfLifeFridgeDays
    : location === "freezer" ? ingredient.shelfLifeFreezerDays
    : ingredient.shelfLifePantryDays;
  if (days == null) return null;
  const base = new Date(tripDate);
  if (isNaN(base.getTime())) return null;
  return new Date(base.getTime() + days * 86400000).toISOString().slice(0, 10);
}
