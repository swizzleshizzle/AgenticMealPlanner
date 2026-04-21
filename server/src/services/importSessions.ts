import { randomUUID } from "crypto";

interface Entry {
  pdfPath: string;
  expiresAt: number;
}

const TTL_MS = 15 * 60 * 1000;
const store = new Map<string, Entry>();

export function stashImportPdf(pdfPath: string): string {
  const id = randomUUID();
  store.set(id, { pdfPath, expiresAt: Date.now() + TTL_MS });
  return id;
}

export function popImportPdf(id: string): string | null {
  const entry = store.get(id);
  if (!entry) return null;
  store.delete(id);
  if (entry.expiresAt < Date.now()) return null;
  return entry.pdfPath;
}

export function clearExpired(): void {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (entry.expiresAt < now) store.delete(id);
  }
}

// Periodic sweep (once per 5 min) so the map doesn't accumulate ghosts.
setInterval(clearExpired, 5 * 60 * 1000).unref?.();
