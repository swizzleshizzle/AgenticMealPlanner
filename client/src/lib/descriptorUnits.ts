// Mirrors the server's descriptor-unit set (server/src/lib/units.ts): recipe
// amounts that never convert to a number. The cook flow buckets these into a
// passive "season to taste" note instead of asking about them every cook.
const DESCRIPTOR_UNITS = new Set(["totaste", "pinch", "drizzle", "spray", "asneeded"]);

export function isDescriptorUnit(unit: string): boolean {
  return DESCRIPTOR_UNITS.has(unit.toLowerCase().replace(/\./g, "").replace(/\s+/g, ""));
}
