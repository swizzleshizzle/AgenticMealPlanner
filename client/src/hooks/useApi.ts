import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "../api/client";

export function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const refetch = useCallback(() => {
    // Cancel any in-flight request so a slower older response can't land after
    // (and overwrite) a newer one, and so we don't setState after unmount.
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setError(null);
    apiFetch<T>(path, { signal: controller.signal })
      .then((d) => { if (!controller.signal.aborted) setData(d); })
      .catch((e) => {
        if (controller.signal.aborted || e?.name === "AbortError") return;
        setError(e.message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, [path]);

  useEffect(() => {
    refetch();
    return () => controllerRef.current?.abort();
  }, [refetch]);

  return { data, loading, error, refetch };
}
