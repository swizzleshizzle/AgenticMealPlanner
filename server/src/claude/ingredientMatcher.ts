// ---------------------------------------------------------------------------
// Receipt-line ingredient matching.
//
// Two pure functions:
//   - expandAbbreviations: turns thermal-print noise ("ORG SPNCH") into
//     readable text ("organic spinach"). Lowercases output. Strips punctuation
//     that abuts an abbreviation.
//   - fuzzyMatchIngredient: against a list of existing Ingredient rows,
//     returns the best match (or null) with a coarse confidence label.
//
// Both are pure → easy to unit-test → grow as we hit real receipts.
// ---------------------------------------------------------------------------

const ABBREVIATIONS: Record<string, string> = {
  // generic adjectives
  ORG: "organic",
  WHL: "whole",
  GV: "great value",
  // produce
  SPNCH: "spinach",
  BNN: "banana",
  BNNS: "bananas",
  BNANA: "banana",
  TMTO: "tomato",
  // protein
  CHKN: "chicken",
  BF: "beef",
  // dairy
  MLK: "milk",
  CHZ: "cheese",
  // grains
  BRD: "bread",
  // misc
  PWDR: "powder",
  SUG: "sugar",
};

export function expandAbbreviations(raw: string): string {
  if (!raw) return "";
  // Replace any punctuation that touches a token with whitespace, collapse
  // whitespace, then expand each token.
  const tokens = raw
    .replace(/[.,;:/\\()\[\]"']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const expanded = tokens.map((tok) => {
    const upper = tok.toUpperCase();
    return ABBREVIATIONS[upper] ?? tok.toLowerCase();
  });
  return expanded.join(" ");
}

export interface IngredientCandidate {
  id: number;
  name: string;
}

export interface MatchResult {
  id: number;
  name: string;
  confidence: "high" | "low";
}

export function fuzzyMatchIngredient(
  raw: string,
  candidates: IngredientCandidate[],
): MatchResult | null {
  if (!raw) return null;
  const expanded = expandAbbreviations(raw);
  const tokens = new Set(expanded.split(/\s+/).filter(Boolean));

  let best: { cand: IngredientCandidate; score: number } | null = null;

  for (const cand of candidates) {
    const candTokens = cand.name.toLowerCase().split(/\s+/).filter(Boolean);
    // Require every word in the candidate name to appear (or be a near-match)
    // in the expanded receipt text.
    const allMatch = candTokens.every((ct) =>
      tokens.has(ct) || tokens.has(`${ct}s`) || tokens.has(ct.replace(/s$/, "")),
    );
    if (!allMatch) continue;

    // Score by number of candidate tokens matched. Multi-word matches beat
    // single-word ones.
    const score = candTokens.length;
    if (!best || score > best.score) {
      best = { cand, score };
    }
  }

  if (!best) return null;

  // Confidence heuristic for single-token candidate matches: strip "noise"
  // tokens from the input (known descriptors like 'organic'/'whole', plus
  // size/quantity tokens like '5oz', '1g', '12pk'). If what remains is just
  // the candidate token, the match is "high" — e.g. 'organic spinach 5oz' →
  // ['spinach'] after noise removal, clearly spinach. If extra content words
  // remain, the candidate is acting as an adjective for something else —
  // e.g. 'milk chocolate bar' → ['milk','chocolate','bar'], so the 'milk'
  // candidate is "low" confidence. Multi-token candidate matches are always
  // high (they had to match every word).
  let confidence: "high" | "low" = "high";
  if (best.score === 1) {
    const candToken = best.cand.name.toLowerCase();
    const inputTokens = expanded.split(/\s+/).filter(Boolean);
    const KNOWN_DESCRIPTORS = new Set([
      "organic", "whole", "great", "value", "fresh", "natural", "raw",
    ]);
    const isSizeToken = (t: string) => /^\d+(\.\d+)?[a-z]+$/i.test(t) || /^\d+$/.test(t);
    const contentTokens = inputTokens.filter(
      (t) => t !== candToken && !KNOWN_DESCRIPTORS.has(t) && !isSizeToken(t),
    );
    if (contentTokens.length > 0) confidence = "low";
  }

  return {
    id: best.cand.id,
    name: best.cand.name,
    confidence,
  };
}
