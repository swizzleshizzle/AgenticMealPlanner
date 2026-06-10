// client/src/lib/backTarget.ts
export interface BackTarget {
  to: string;
  label: string;
}

const KNOWN: Record<string, string> = {
  "/planner": "Back to planner",
  "/": "Back to dashboard",
  "/recipes": "Back to recipes",
};

/**
 * Resolve where a recipe-view Back button should go, from the origin pathname
 * stashed in router location state. Unknown / missing origins fall back to the
 * recipe list so Back is never a dead end (e.g. after a reload, where state is lost).
 */
export function resolveBackTarget(from: unknown): BackTarget {
  if (typeof from === "string" && from in KNOWN) {
    return { to: from, label: KNOWN[from] };
  }
  return { to: "/recipes", label: "Back to recipes" };
}
