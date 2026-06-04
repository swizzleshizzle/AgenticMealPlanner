import { fuzzyMatchIngredient } from "../claude/ingredientMatcher.js";

export interface ExistingIngredient {
  id: number;
  name: string;
}

export type ResolveResult = { id: number; source: "alias" | "fuzzy" } | null;

/**
 * Resolve a parsed ingredient name to an existing ingredient id, or null when
 * the caller should create a new canonical ingredient. Alias wins; otherwise a
 * *high-confidence* fuzzy match wins; low-confidence matches return null so we
 * don't silently merge distinct ingredients.
 */
export function resolveIngredientId(
  name: string,
  existing: ExistingIngredient[],
  aliasMap: Map<string, number>,
): ResolveResult {
  const aliasTarget = aliasMap.get(name.toLowerCase());
  if (aliasTarget != null) return { id: aliasTarget, source: "alias" };

  const match = fuzzyMatchIngredient(name, existing);
  if (match && match.confidence === "high") return { id: match.id, source: "fuzzy" };

  return null;
}
