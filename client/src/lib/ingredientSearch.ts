import Fuse from "fuse.js";
import type { Ingredient, PantryLocation } from "../api/ingredients";

const MAX_RESULTS = 12; // matches AddIngredientRow's list size

const FUSE_OPTS = { keys: ["name"], threshold: 0.4, ignoreLocation: true };

/**
 * Build a reusable Fuse index. Memoize this per ingredient list (see the
 * combobox) so the index isn't rebuilt on every keystroke.
 */
export function makeIngredientFuse(ingredients: Ingredient[]): Fuse<Ingredient> {
  return new Fuse(ingredients, FUSE_OPTS);
}

/**
 * Fuzzy-filter the ingredient list for the combobox dropdown.
 * Empty query → first MAX_RESULTS in list order (browse mode).
 * Pass a prebuilt `fuse` (from makeIngredientFuse) to avoid rebuilding the index.
 */
export function filterIngredients(query: string, ingredients: Ingredient[], fuse?: Fuse<Ingredient>): Ingredient[] {
  const q = query.trim();
  if (!q) return ingredients.slice(0, MAX_RESULTS);
  const f = fuse ?? new Fuse(ingredients, FUSE_OPTS);
  return f.search(q, { limit: MAX_RESULTS }).map((r) => r.item);
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
