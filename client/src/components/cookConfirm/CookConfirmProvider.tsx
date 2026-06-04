import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { PlannedMeal, DeductOverride, CookPreviewInputLine } from "../../api/plans";
import { getPlan, markCookedWithOverrides, getCookPreview } from "../../api/plans";
import { getPantry, type PantryCard } from "../../api/pantry";
import { useToast } from "../ui/ToastProvider";
import CookConfirmModal from "./CookConfirmModal";

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
        return;
      }
      const map = new Map<number, PantryCard>();
      for (const c of cards) map.set(c.ingredient.id, c);
      setPantryByIngredient(map);
      setPantryCards(cards);
      setOpen({ planId, pm });
    } catch (err: any) {
      showToast({ message: `Couldn't open cook confirm: ${err?.message ?? "unknown error"}` });
    }
  }, [showToast]);

  const preview = async (lines: CookPreviewInputLine[]) => {
    if (!open) return [];
    const res = await getCookPreview(open.planId, open.pm.id, lines);
    return res.preview;
  };

  const submit = async (overrides: DeductOverride[]) => {
    if (!open) return;
    try {
      await markCookedWithOverrides(open.planId, open.pm.id, overrides);
      setOpen(null);
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
          onCancel={() => setOpen(null)}
          onPreview={preview}
          onSubmit={submit}
        />
      )}
    </CookConfirmCtx.Provider>
  );
}
