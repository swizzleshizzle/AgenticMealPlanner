// client/src/hooks/useScrollRestoration.ts
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { readCache, writeCache, safeSessionStorage } from "../lib/sessionCache";

const storage = safeSessionStorage();

/**
 * Per-route scroll persistence. Mount once near the top of the app shell.
 * Saves on scroll + visibility change, restores on route entry (retrying a few
 * frames so it works even after async content grows the page).
 */
export function useScrollRestoration(): void {
  const { pathname } = useLocation();

  useEffect(() => {
    const key = `scroll:${pathname}`;
    const saved = readCache<number>(storage, key);

    let raf = 0;
    let frames = 0;
    const restore = () => {
      if (saved == null) return;
      window.scrollTo(0, saved);
      frames += 1;
      // Keep nudging while the page is still shorter than the saved offset
      // (content is still loading in), up to ~20 frames (~330ms).
      if (frames < 20 && window.scrollY < saved - 2) {
        raf = requestAnimationFrame(restore);
      }
    };
    raf = requestAnimationFrame(restore);

    const save = () => writeCache(storage, key, window.scrollY);
    window.addEventListener("scroll", save, { passive: true });
    document.addEventListener("visibilitychange", save);

    return () => {
      cancelAnimationFrame(raf);
      save();
      window.removeEventListener("scroll", save);
      document.removeEventListener("visibilitychange", save);
    };
  }, [pathname]);
}
