export type UnitType = "mass" | "volume" | "count";

export interface DensityHint {
  densityGPerMl?: number | null;
  gramsPerCount?: number | null;
  /**
   * How many each-like counts one container holds (e.g. 8 buns per package).
   * Sourced from the ingredient's purchaseUnitQty when its defaultUnit is
   * count-type. Lifts the container ↔ each-like refusal.
   */
  unitsPerContainer?: number | null;
}

export class UnitConversionError extends Error {
  constructor(
    public fromUnit: string,
    public toUnit: string,
    public missing: "densityGPerMl" | "gramsPerCount" | "unknownUnit" | "containerSize",
    message?: string,
  ) {
    super(message ?? `Cannot convert ${fromUnit} to ${toUnit}: ${missing}`);
    this.name = "UnitConversionError";
  }
}

// Canonical bases: g (mass), mL (volume), count.
// Each entry: how many canonical-base units one of these units represents.
const MASS: Record<string, number> = {
  g: 1,
  kg: 1000,
  mg: 0.001,
  oz: 28.3495,
  lb: 453.592,
};

const VOLUME: Record<string, number> = {
  ml: 1,
  l: 1000,
  tsp: 4.92892,
  tbsp: 14.7868,
  fl_oz: 29.5735,
  cup: 236.588,
  pt: 473.176,
  qt: 946.353,
  gal: 3785.41,
};

const COUNT: Record<string, number> = {
  count: 1,
  ea: 1,
  unit: 1,
  whole: 1,
  packet: 1,
  package: 1,
  pack: 1,
  clove: 1,
  cloves: 1,
  slice: 1,
  head: 1,
  can: 1,
  ear: 1,
  bag: 1,
  block: 1,
  thumb: 1,
};

// Container-style count units. A container is not an item — 1 package of buns
// is several buns — so these convert 1:1 among themselves ("one retail
// container") but refuse conversion to each-like count units and refuse the
// gramsPerCount bridge (which describes one *item*, not one container).
// Without this split, draining a "0.25 package" batch counted as 0.25 items
// and the deduction kept going into the next batch: a double charge.
const CONTAINER_UNITS = new Set(["packet", "package", "pack", "can", "bag", "block"]);

function isContainerUnit(normalized: string): boolean {
  return CONTAINER_UNITS.has(normalized);
}

// Aliases users actually type. Lowercased, stripped of dots and spaces.
const ALIASES: Record<string, string> = {
  pound: "lb",
  pounds: "lb",
  lbs: "lb",
  ounce: "oz",
  ounces: "oz",
  ozs: "oz",
  gram: "g",
  grams: "g",
  gs: "g",
  kilogram: "kg",
  kilograms: "kg",
  kgs: "kg",
  milliliter: "ml",
  milliliters: "ml",
  liter: "l",
  liters: "l",
  ls: "l",
  teaspoon: "tsp",
  teaspoons: "tsp",
  tsps: "tsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tbsps: "tbsp",
  tbs: "tbsp",
  "fluidounce": "fl_oz",
  "flounce": "fl_oz",
  floz: "fl_oz",
  cups: "cup",
  c: "cup",
  pint: "pt",
  pints: "pt",
  quart: "qt",
  quarts: "qt",
  gallon: "gal",
  gallons: "gal",
  each: "count",
  pcs: "count",
  pieces: "count",
  piece: "count",
  ct: "count",
  units: "unit",
};

function normalize(u: string): string {
  const k = u.toLowerCase().replace(/\./g, "").replace(/\s+/g, "");
  return ALIASES[k] ?? k;
}

// Non-quantifiable recipe amounts. These never convert to a number; the
// shopping aggregator routes them to a "season to taste" staples note instead
// of a numeric line. Keys are post-normalize() (spaces stripped).
const DESCRIPTOR_UNITS = new Set<string>([
  "totaste",
  "pinch",
  "drizzle",
  "spray",
  "asneeded",
]);

export function isDescriptorUnit(u: string): boolean {
  return DESCRIPTOR_UNITS.has(u.toLowerCase().replace(/\./g, "").replace(/\s+/g, ""));
}

function classify(u: string): { type: UnitType; canonicalPerUnit: number } {
  const n = normalize(u);
  if (n in MASS) return { type: "mass", canonicalPerUnit: MASS[n] };
  if (n in VOLUME) return { type: "volume", canonicalPerUnit: VOLUME[n] };
  if (n in COUNT) return { type: "count", canonicalPerUnit: COUNT[n] };
  throw new UnitConversionError(u, u, "unknownUnit", `Unknown unit: ${u}`);
}

export function convert(
  value: number,
  fromUnit: string,
  toUnit: string,
  hint: DensityHint = {},
): number {
  if (fromUnit === toUnit) return value;
  const from = classify(fromUnit);
  const to = classify(toUnit);
  const fromContainer = from.type === "count" && isContainerUnit(normalize(fromUnit));
  const toContainer = to.type === "count" && isContainerUnit(normalize(toUnit));
  // Convert to canonical base of `from.type`.
  const canonicalFrom = value * from.canonicalPerUnit;

  // Container ↔ container is 1:1 (both mean "one retail container").
  if (fromContainer && toContainer) {
    return canonicalFrom / to.canonicalPerUnit;
  }
  // A container is not an item; crossing the container boundary (to each-like
  // counts, or to mass/volume) needs the per-ingredient package size.
  if (fromContainer) {
    if (hint.unitsPerContainer == null) {
      throw new UnitConversionError(fromUnit, toUnit, "containerSize");
    }
    return convert(value * hint.unitsPerContainer, "count", toUnit, hint);
  }
  if (toContainer) {
    if (hint.unitsPerContainer == null) {
      throw new UnitConversionError(fromUnit, toUnit, "containerSize");
    }
    return convert(value, fromUnit, "count", hint) / hint.unitsPerContainer;
  }

  if (from.type === to.type) {
    return canonicalFrom / to.canonicalPerUnit;
  }

  // Cross-type. Need to bridge through grams using density / gramsPerCount.
  let grams: number | null = null;
  if (from.type === "mass") {
    grams = canonicalFrom;
  } else if (from.type === "volume") {
    if (hint.densityGPerMl == null) {
      throw new UnitConversionError(fromUnit, toUnit, "densityGPerMl");
    }
    grams = canonicalFrom * hint.densityGPerMl;
  } else if (from.type === "count") {
    if (hint.gramsPerCount == null) {
      throw new UnitConversionError(fromUnit, toUnit, "gramsPerCount");
    }
    grams = canonicalFrom * hint.gramsPerCount;
  }

  // Now convert grams -> to.type's canonical -> toUnit.
  if (to.type === "mass") {
    return grams! / to.canonicalPerUnit;
  } else if (to.type === "volume") {
    if (hint.densityGPerMl == null) {
      throw new UnitConversionError(fromUnit, toUnit, "densityGPerMl");
    }
    const mL = grams! / hint.densityGPerMl;
    return mL / to.canonicalPerUnit;
  } else {
    // count
    if (hint.gramsPerCount == null) {
      throw new UnitConversionError(fromUnit, toUnit, "gramsPerCount");
    }
    return grams! / hint.gramsPerCount;
  }
}

export function unitTypeOf(u: string): UnitType {
  return classify(u).type;
}

/**
 * Derive the container-size hint from an ingredient: when its default unit is
 * an each-like count, purchaseUnitQty ("one retail unit holds N defaultUnit")
 * IS the package size. For mass/volume defaults the field means something
 * else (oz per pack), and for container defaults it would be circular.
 */
export function unitsPerContainerFor(ing: {
  defaultUnit: string;
  purchaseUnitQty?: number | null;
}): number | null {
  const qty = ing.purchaseUnitQty;
  if (qty == null || qty <= 0) return null;
  const n = normalize(ing.defaultUnit);
  if (!(n in COUNT) || isContainerUnit(n)) return null;
  return qty;
}
