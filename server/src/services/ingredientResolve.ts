import { fuzzyMatchIngredient } from "../claude/ingredientMatcher.js";
import { prisma } from "../lib/prisma.js";

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

/**
 * Resolve a name to an existing ingredient id, or CREATE a new canonical
 * ingredient (name + category + defaultUnit; density/gramsPerCount null).
 * Mutates `existing` to include creations so later lines in the same batch
 * can match them. Uses the shared prisma client.
 */
export async function resolveOrCreateIngredientId(
  line: { name: string; category?: string; unit: string },
  existing: ExistingIngredient[],
  aliasMap: Map<string, number>,
): Promise<number> {
  const resolved = resolveIngredientId(line.name, existing, aliasMap);
  if (resolved) return resolved.id;

  // Canonical ingredient names are stored lowercased everywhere else; lowercase
  // here too so a differently-cased name ("Olive Oil" vs "olive oil") matches
  // the existing unique row instead of creating a duplicate.
  const key = line.name.toLowerCase();
  const created = await prisma.ingredient.upsert({
    where: { name: key },
    update: {},
    create: {
      name: key,
      category: (line.category ?? "other") as any,
      defaultUnit: line.unit,
    },
  });
  existing.push({ id: created.id, name: created.name });
  return created.id;
}
