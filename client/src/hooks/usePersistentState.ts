// client/src/hooks/usePersistentState.ts
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { readCache, writeCache, safeSessionStorage, type StorageLike } from "../lib/sessionCache";

/**
 * Like useState, but seeded from sessionStorage and mirrored back.
 * Survives reloads within the same tab session; clears when the tab fully closes.
 *
 * Writes are debounced so rapid updates (e.g. one per streamed chat token)
 * don't re-serialize the whole value on every change; the latest value is
 * flushed on unmount so nothing pending is lost.
 */
export function usePersistentState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const storageRef = useRef<StorageLike | null>(null);
  if (storageRef.current === null) storageRef.current = safeSessionStorage();
  const storage = storageRef.current;

  const [state, setState] = useState<T>(() => {
    const cached = readCache<{ v: T }>(storage, key);
    return cached !== null ? cached.v : initial;
  });

  // Keep the newest value reachable from the unmount/flush effects.
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const id = setTimeout(() => writeCache(storage, key, { v: stateRef.current }), 200);
    return () => clearTimeout(id);
  }, [storage, key, state]);

  // Flush the latest value when the component unmounts (or the key changes), so
  // a debounced write that hadn't fired yet isn't dropped.
  useEffect(() => {
    return () => {
      writeCache(storage, key, { v: stateRef.current });
    };
  }, [storage, key]);

  return [state, setState];
}
