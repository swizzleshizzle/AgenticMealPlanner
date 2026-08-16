import { formatQuantity } from "./formatQuantity";

export interface PurchaseUnitFields {
  purchaseUnitName?: string | null;
  purchaseUnitQty?: number | null;
}

export interface PurchaseLabel {
  /** What to grab off the shelf: "3 × 1-lb pack". */
  main: string;
  /** The precise recipe-unit amount, as fine print: "42 oz". */
  detail: string;
}

// Translate a to-buy amount (in the ingredient's default unit) into whole
// retail units — stores sell packs, bunches, and bottles, not "42 oz".
// Rounds up (you can't buy 0.63 of a bag) with a small tolerance so float
// dust doesn't buy an extra pack.
export function purchaseLabel(
  quantityToBuy: number,
  unit: string,
  ing: PurchaseUnitFields,
): PurchaseLabel | null {
  const name = ing.purchaseUnitName;
  const per = ing.purchaseUnitQty;
  if (!name || per == null || per <= 0 || quantityToBuy <= 0) return null;
  const units = Math.ceil(Math.round((quantityToBuy / per) * 1e4) / 1e4);
  return {
    main: `${units} × ${name}`,
    detail: `${formatQuantity(quantityToBuy)} ${unit}`,
  };
}
