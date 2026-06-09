// client/src/hooks/usePersistentState.ts
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { readCache, writeCache, safeSessionStorage, type StorageLike } from "../lib/sessionCache";

/**
 * Like useState, but seeded from sessionStorage and mirrored back on every change.
 * Survives reloads within the same tab session; clears when the tab fully closes.
 */
export function usePersistentState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const storageRef = useRef<StorageLike | null>(null);
  if (storageRef.current === null) storageRef.current = safeSessionStorage();
  const storage = storageRef.current;

  const [state, setState] = useState<T>(() => {
    const cached = readCache<T>(storage, key);
    return cached !== null ? cached : initial;
  });

  useEffect(() => {
    writeCache(storage, key, state);
  }, [storage, key, state]);

  return [state, setState];
}
