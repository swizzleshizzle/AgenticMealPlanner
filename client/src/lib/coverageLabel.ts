import { formatQuantity } from "./formatQuantity";

// Label for a shopping item that's fully covered by the pantry. Says both
// numbers honestly — the old label printed the *needed* amount as "Have X",
// which contradicted the pantry page and read as a counting bug.
export function coverageLabel(quantityNeeded: number, quantityOnHand: number, unit: string): string {
  const base = `Need ${formatQuantity(quantityNeeded)} · have ${formatQuantity(quantityOnHand)}`;
  return unit ? `${base} ${unit}` : base;
}
