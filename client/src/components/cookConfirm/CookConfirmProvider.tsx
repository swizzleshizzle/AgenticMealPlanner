import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { PlannedMeal, DeductOverride, CookPreviewInputLine } from "../../api/plans";
import { getPlan, markCookedWithOverrides, getCookPreview } from "../../api/plans";
import { getPantry, type PantryCard } from "../../api/pantry";
import { saveAlias, deleteAlias } from "../../api/ingredients";
import { useToast } from "../ui/ToastProvider";
import CookConfirmModal from "./CookConfirmModal";
import { readCache, writeCache, clearCache, safeSessionStorage } from "../../lib/sessionCache";

const cookStore = safeSessionStorage();
const ACTIVE_KEY = "cook:active";
interface ActiveCook { planId: number; plannedMealId: number; }

interface Ctx {
  openForMeal: (planId: number, plannedMealId: number) => void;
}

const CookConfirmCtx = createContext<Ctx | null>(null);

export function useCookConfirm(): Ctx {
  const ctx = useContext(CookConfirmCtx);
  if (!ctx) throw new Error("useCookConfirm must be used within <CookConfirmProvider>");
  return ctx;
}

interface State {
  planId: number;
  pm: PlannedMeal;
}

export default function CookConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<State | null>(null);
  const [pantryByIngredient, setPantryByIngredient] = useState<Map<number, PantryCard>>(new Map());
  const [pantryCards, setPantryCards] = useState<PantryCard[]>([]);
  const showToast = useToast();

  const openForMeal = useCallback(async (planId: number, plannedMealId: number) => {
    try {
      const [plan, cards] = await Promise.all([getPlan(planId), getPantry()]);
      const pm = plan.plannedMeals.find((p) => p.id === plannedMealId);
      if (!pm) {
        showToast({ message: "Couldn't find that meal." });
        clearCache(cookStore, ACTIVE_KEY);
        return;
      }
      const map = new Map<number, PantryCard>();
      for (const c of cards) map.set(c.ingredient.id, c);
      setPantryByIngredient(map);
      setPantryCards(cards);
      setOpen({ planId, pm });
      writeCache(cookStore, ACTIVE_KEY, { planId, plannedMealId: pm.id } satisfies ActiveCook);
    } catch (err: any) {
      showToast({ message: `Couldn't open cook confirm: ${err?.message ?? "unknown error"}` });
      clearCache(cookStore, ACTIVE_KEY);
    }
  }, [showToast]);

  const closeModal = useCallback(() => {
    setOpen(null);
    clearCache(cookStore, ACTIVE_KEY);
  }, []);

  useEffect(() => {
    const active = readCache<ActiveCook>(cookStore, ACTIVE_KEY);
    if (active) openForMeal(active.planId, active.plannedMealId);
  }, [openForMeal]);

  const preview = async (lines: CookPreviewInputLine[]) => {
    if (!open) return [];
    const res = await getCookPreview(open.planId, open.pm.id, lines);
    return res.preview;
  };

  const handleRepointPersist = (aliasName: string, ingredientId: number) => {
    const key = aliasName.trim().toLowerCase();
    saveAlias(key, ingredientId)
      .then(() =>
        showToast({
          message: `Remembered "${aliasName}".`,
          action: { label: "Undo", onClick: () => { void deleteAlias(key); } },
        }),
      )
      .catch(() => {/* non-fatal: matching still worked for this cook */});
  };

  const submit = async (overrides: DeductOverride[]) => {
    if (!open) return;
    try {
      await markCookedWithOverrides(open.planId, open.pm.id, overrides);
      closeModal();
      // Notify pages to refetch.
      window.dispatchEvent(new Event("cookconfirm:done"));
    } catch (err: any) {
      showToast({ message: `Couldn't mark cooked: ${err?.message ?? "try again"}` });
      // Re-throw so the modal's try/finally still clears busy but the modal stays open.
      throw err;
    }
  };

  return (
    <CookConfirmCtx.Provider value={{ openForMeal }}>
      {children}
      {open && (
        <CookConfirmModal
          pm={open.pm}
          pantryByIngredient={pantryByIngredient}
          pantryCards={pantryCards}
          onCancel={closeModal}
          onPreview={preview}
          onSubmit={submit}
          onRepointPersist={handleRepointPersist}
        />
      )}
    </CookConfirmCtx.Provider>
  );
}
