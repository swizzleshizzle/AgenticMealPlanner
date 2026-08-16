// Single source of truth for rendering ingredient quantities. Raw values carry
// float dust (1.057790416126034 tsp) that must never reach the screen: fewer
// decimals as magnitude grows, trailing zeros trimmed, and a positive amount
// never shown as plain zero.
// For editable prefills: the value shown in an input is the value that
// commits, so round it once here instead of letting float dust through.
export function roundQuantity(qty: number): number {
  return Math.round(qty * 100) / 100;
}

export function formatQuantity(qty: number): string {
  if (qty === 0) return "0";
  const abs = Math.abs(qty);
  if (abs < 0.005) return qty > 0 ? "<0.01" : ">-0.01";
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const rounded = qty.toFixed(decimals);
  // Trim trailing zeros ("2.50" → "2.5", "2.00" → "2").
  return rounded.replace(/\.?0+$/, "");
}
