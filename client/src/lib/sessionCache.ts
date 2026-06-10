// client/src/lib/sessionCache.ts
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = "amp:"; // agentic-meal-planner namespace

export function readCache<T>(storage: StorageLike | null, key: string): T | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PREFIX + key);
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null; // corrupt JSON or read failure: treat as cache miss
  }
}

export function writeCache<T>(storage: StorageLike | null, key: string, value: T): void {
  if (!storage) return;
  try {
    storage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota exceeded / serialization failure: cache is best-effort, ignore */
  }
}

export function clearCache(storage: StorageLike | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/**
 * The real sessionStorage if usable, else null. Probes with a write so callers
 * degrade gracefully in SSR, Safari private mode, or quota-locked contexts.
 */
export function safeSessionStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return null;
    const probe = PREFIX + "__probe__";
    window.sessionStorage.setItem(probe, "1");
    window.sessionStorage.removeItem(probe);
    return window.sessionStorage;
  } catch {
    return null;
  }
}
