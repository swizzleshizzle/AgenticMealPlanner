// Recipe-tag hygiene. Tags arrive from AI recipe imports and free-form edits,
// which invent variants faster than anyone prunes them (asian / Asian /
// asian-inspired). normalizeTags() runs on every write; planTagMerges() powers
// the one-off cleanup script for tags already in the data.

export function normalizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeTags(raw: string[]): string[] {
  const out: string[] = [];
  for (const t of raw) {
    const n = normalizeTag(t);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

export interface TagMergePlan {
  /** original tag (as stored) → tag it should become */
  merges: Record<string, string>;
  /** normalized-vocabulary frequencies (post-merge targets included) */
  counts: Record<string, number>;
}

// Conservative near-duplicate detection. A variant only merges into a target
// that already exists in the vocabulary — nothing is invented:
//   1. case/separator variants → normalized form
//   2. "x-inspired" → "x"           (asian-inspired → asian)
//   3. plural "xs" → "x"            (burgers → burger)
export function planTagMerges(tagLists: string[][]): TagMergePlan {
  const counts: Record<string, number> = {};
  const originals = new Set<string>();
  for (const tags of tagLists) {
    for (const t of tags) {
      originals.add(t);
      const n = normalizeTag(t);
      counts[n] = (counts[n] ?? 0) + 1;
    }
  }
  const vocab = new Set(Object.keys(counts));

  const canonicalOf = (tag: string): string => {
    let current = normalizeTag(tag);
    // Iterate so chains resolve (e.g. "Asians-inspired" → asian in two hops).
    for (let hops = 0; hops < 3; hops++) {
      const inspired = current.replace(/-inspired$/, "");
      if (inspired !== current && vocab.has(inspired)) { current = inspired; continue; }
      const singular = current.replace(/s$/, "");
      if (singular !== current && singular.length >= 3 && vocab.has(singular)) { current = singular; continue; }
      break;
    }
    return current;
  };

  const merges: Record<string, string> = {};
  for (const original of originals) {
    const target = canonicalOf(original);
    if (target !== original) merges[original] = target;
  }
  return { merges, counts };
}
