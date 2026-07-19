// Sunday-anchored week helpers, shared across the server.
// Mirrors client/src/api/plans.ts parseWeekParam math.

export function localYmd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function thisWeekSunday(now: Date): string {
  // JS getDay(): 0 = Sunday, 1 = Monday, ..., 6 = Saturday.
  // Sunday-anchored weeks: subtract dayIndex directly to land on Sunday.
  const dayIndex = now.getDay();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - dayIndex);
  return localYmd(sunday);
}
