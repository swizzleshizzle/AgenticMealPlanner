import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { PlannedMeal, DeductShortfall, DeductOverride } from "../../api/plans";
import { getPlan, markCookedWithOverrides } from "../../api/plans";
import { getPantry, type PantryCard } from "../../api/pantry";
import CookConfirmModal from "./CookConfirmModal";
import ShortfallBanner from "./ShortfallBanner";

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
  const [shortfalls, setShortfalls] = useState<DeductShortfall[]>([]);

  const openForMeal = useCallback(async (planId: number, plannedMealId: number) => {
    const [plan, cards] = await Promise.all([getPlan(planId), getPantry()]);
    const pm = plan.plannedMeals.find((p) => p.id === plannedMealId);
    if (!pm) return;
    const map = new Map<number, PantryCard>();
    for (const c of cards) map.set(c.ingredient.id, c);
    setPantryByIngredient(map);
    setOpen({ planId, pm });
  }, []);

  const submit = async (overrides: DeductOverride[]) => {
    if (!open) return;
    const result = await markCookedWithOverrides(open.planId, open.pm.id, overrides);
    setShortfalls(result.deduction.shortfalls);
    setOpen(null);
    // Notify pages to refetch; subscribed pages call their own load().
    window.dispatchEvent(new Event("cookconfirm:done"));
  };

  return (
    <CookConfirmCtx.Provider value={{ openForMeal }}>
      <ShortfallBanner shortfalls={shortfalls} onDismiss={() => setShortfalls([])} />
      {children}
      {open && (
        <CookConfirmModal
          pm={open.pm}
          pantryByIngredient={pantryByIngredient}
          onCancel={() => setOpen(null)}
          onSubmit={submit}
        />
      )}
    </CookConfirmCtx.Provider>
  );
}
