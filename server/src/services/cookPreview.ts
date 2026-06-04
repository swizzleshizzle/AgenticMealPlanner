import { convert, unitTypeOf, UnitConversionError } from "../lib/units.js";
import { fuzzyMatchIngredient } from "../claude/ingredientMatcher.js";

export type CookConfidence = "exact" | "converted" | "estimated" | "none";
export type MatchSource = "id" | "alias" | "fuzzy" | "none";

export interface PantryCardLite {
  ingredientId: number;
  name: string;
  category: string;
  defaultUnit: string;
  densityGPerMl: number | null;
  gramsPerCount: number | null;
  /** FEFO-sorted (soonest expiration first); batches[0].unit is the unit we deduct in. */
  batches: Array<{ id: number; quantity: number; unit: string; expirationDate: Date | null; tags: string[] }>;
  totalsByUnit: Array<{ unit: string; qty: number }>;
}

export interface CookPreviewInputLine {
  ingredientId: number; // the meal's ingredient id (may not match any pantry stock)
  name: string;         // ingredient name, used for fuzzy matching + display
  quantity: number;     // already scaled by the serving multiplier
  unit: string;         // recipe unit
}

export interface CookPreviewLine {
  sourceIngredientId: number;
  name: string;
  requestedQuantity: number;
  requestedUnit: string;

  matchedIngredientId: number | null;
  matchedName: string | null;
  matchSource: MatchSource;
  confidence: CookConfidence;

  /** Pre-filled best-guess deduction, in `deductUnit` (the pantry's native unit when matched). */
  deductQuantity: number;
  deductUnit: string;

  pantryTotals: Array<{ unit: string; qty: number }>;
  projectedRemaining: { qty: number; unit: string } | null;
  included: boolean;
}

// Coarse, deliberately-dumb fallback fractions of one pantry unit when a real
// conversion is impossible. Only job: non-blank and roughly sane; the user sees
// and corrects it. Keyed by IngredientCategory.
const ESTIMATE_FRACTION: Record<string, number> = {
  spice: 0.05,
  condiment: 0.1,
  pantry_staple: 0.15,
  produce: 0.25,
  dairy: 0.25,
  grain: 0.25,
  frozen: 0.25,
  protein: 0.5,
  other: 0.25,
};

function safeUnitType(u: string): "mass" | "volume" | "count" | null {
  try {
    return unitTypeOf(u);
  } catch {
    return null;
  }
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function buildCookPreview(
  lines: CookPreviewInputLine[],
  cards: PantryCardLite[],
  aliasMap: Map<string, number> = new Map(),
): CookPreviewLine[] {
  const byId = new Map(cards.map((c) => [c.ingredientId, c]));
  const candidates = cards.map((c) => ({ id: c.ingredientId, name: c.name }));

  return lines.map((line) => {
    // --- Resolve which pantry card this line points to ----------------------
    let card: PantryCardLite | undefined;
    let matchSource: MatchSource = "none";
    let matchCertainty: "high" | "low" = "high";

    if (byId.has(line.ingredientId)) {
      card = byId.get(line.ingredientId);
      matchSource = "id";
    } else {
      const aliasTarget = aliasMap.get(line.name.toLowerCase());
      if (aliasTarget != null && byId.has(aliasTarget)) {
        card = byId.get(aliasTarget);
        matchSource = "alias";
      } else {
        const fuzzy = fuzzyMatchIngredient(line.name, candidates);
        if (fuzzy && byId.has(fuzzy.id)) {
          card = byId.get(fuzzy.id);
          matchSource = "fuzzy";
          matchCertainty = fuzzy.confidence; // "high" | "low"
        }
      }
    }

    const base = {
      sourceIngredientId: line.ingredientId,
      name: line.name,
      requestedQuantity: line.quantity,
      requestedUnit: line.unit,
    };

    if (!card || card.batches.length === 0) {
      return {
        ...base,
        matchedIngredientId: null,
        matchedName: null,
        matchSource: "none" as MatchSource,
        confidence: "none" as CookConfidence,
        deductQuantity: line.quantity,
        deductUnit: line.unit,
        pantryTotals: card?.totalsByUnit ?? [],
        projectedRemaining: null,
        included: false,
      };
    }

    // --- Compute the deduction in the pantry's native (FEFO-first) unit -----
    const deductUnit = card.batches[0].unit;
    const hint = { densityGPerMl: card.densityGPerMl, gramsPerCount: card.gramsPerCount };
    const fromType = safeUnitType(line.unit);
    const toType = safeUnitType(deductUnit);
    const sameFamily = fromType != null && toType != null && fromType === toType;

    let deductQuantity: number;
    let conversionTier: "exact" | "converted" | "estimated";
    if (sameFamily) {
      deductQuantity = convert(line.quantity, line.unit, deductUnit, hint);
      conversionTier = "exact";
    } else {
      try {
        deductQuantity = convert(line.quantity, line.unit, deductUnit, hint);
        conversionTier = "converted";
      } catch (e) {
        if (!(e instanceof UnitConversionError)) throw e;
        deductQuantity = ESTIMATE_FRACTION[card.category] ?? 0.25;
        conversionTier = "estimated";
      }
    }

    // A shaky *match* downgrades an otherwise-clean conversion.
    const confidence: CookConfidence = matchCertainty === "low" ? "estimated" : conversionTier;

    // Projected remaining only when the deduct unit lines up with a single total.
    const totalInDeductUnit = card.totalsByUnit.find((t) => t.unit === deductUnit);
    const projectedRemaining = totalInDeductUnit
      ? { qty: round(Math.max(0, totalInDeductUnit.qty - deductQuantity)), unit: deductUnit }
      : null;

    return {
      ...base,
      matchedIngredientId: card.ingredientId,
      matchedName: card.name,
      matchSource,
      confidence,
      deductQuantity: round(deductQuantity),
      deductUnit,
      pantryTotals: card.totalsByUnit,
      projectedRemaining,
      included: true,
    };
  });
}
