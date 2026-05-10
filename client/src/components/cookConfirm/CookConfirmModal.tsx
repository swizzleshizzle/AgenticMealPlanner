import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { PlannedMeal, DeductOverride } from "../../api/plans";
import type { PantryCard } from "../../api/pantry";
import type { Ingredient } from "../../api/ingredients";
import CookConfirmRow, { type CookConfirmRowState, type PantryHint } from "./CookConfirmRow";
import AddIngredientRow from "./AddIngredientRow";
import Button from "../ui/Button";

const UNIT_OPTIONS_VOLUME = ["tsp", "tbsp", "cup", "ml", "l", "fl oz"];
const UNIT_OPTIONS_MASS = ["g", "kg", "oz", "lb"];
const UNIT_OPTIONS_COUNT = ["count"];

function unitOptionsFor(unit: string): string[] {
  if (UNIT_OPTIONS_VOLUME.includes(unit)) return UNIT_OPTIONS_VOLUME;
  if (UNIT_OPTIONS_MASS.includes(unit)) return UNIT_OPTIONS_MASS;
  if (UNIT_OPTIONS_COUNT.includes(unit)) return UNIT_OPTIONS_COUNT;
  // Unknown family — only allow the original unit.
  return [unit];
}

function formatQty(n: number): string {
  if (n === Math.floor(n)) return String(n);
  return n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatTotalsByUnit(card: PantryCard | undefined): PantryHint {
  if (!card || card.batchCount === 0) return { text: "pantry: none", warn: false };
  const parts = card.totalsByUnit.map((t) => `${formatQty(t.qty)} ${t.unit}`);
  const suffix = card.batchCount > 1 ? ` (${card.batchCount} batches)` : "";
  return { text: `pantry: ${parts.join(" · ")}${suffix}`, warn: false };
}

function roundQty(n: number): number {
  return Math.round(n * 100) / 100;
}

let adhocCounter = 0;

interface Props {
  pm: PlannedMeal;
  pantryByIngredient: Map<number, PantryCard>;
  onCancel: () => void;
  onSubmit: (overrides: DeductOverride[]) => Promise<void>;
}

export default function CookConfirmModal({ pm, pantryByIngredient, onCancel, onSubmit }: Props) {
  const multiplier = pm.servings / pm.meal.servings;

  const [rows, setRows] = useState<CookConfirmRowState[]>(() =>
    pm.meal.ingredients.map((mi) => ({
      key: `mi-${mi.id}`,
      ingredientId: mi.ingredient.id,
      ingredientName: mi.ingredient.name,
      quantity: roundQty(mi.quantity * multiplier),
      unit: mi.unit,
      checked: true,
      adhoc: false,
    })),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onCancel, busy]);

  const excludeIds = useMemo(() => rows.map((r) => r.ingredientId), [rows]);

  const updateRow = (key: string, patch: Partial<CookConfirmRowState>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
  };

  const addAdhoc = (i: Ingredient) => {
    adhocCounter += 1;
    setRows((prev) => [
      ...prev,
      {
        key: `adhoc-${adhocCounter}`,
        ingredientId: i.id,
        ingredientName: i.name,
        quantity: 1,
        unit: i.defaultUnit,
        checked: true,
        adhoc: true,
      },
    ]);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const overrides = rows
        .filter((r) => r.checked && r.quantity > 0)
        .map<DeductOverride>((r) => ({
          ingredientId: r.ingredientId,
          quantity: r.quantity,
          unit: r.unit,
        }));
      await onSubmit(overrides);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-[300] flex items-center justify-center p-4 amp-fade-in"
      style={{ background: "rgba(20, 14, 6, 0.55)", backdropFilter: "blur(4px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-1 border border-line rounded-[16px] w-full max-w-[560px] max-h-[88vh] flex flex-col"
        style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
      >
        <div className="flex items-start gap-3 px-5 py-4 border-b border-line-soft">
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-semibold text-ink-1 leading-tight">{pm.meal.name}</div>
            <div className="text-[12px] text-ink-3 mt-0.5">
              {pm.servings} servings · scaled from recipe ({pm.meal.servings} svgs)
            </div>
          </div>
          <button onClick={onCancel} aria-label="Close" className="w-8 h-8 grid place-items-center rounded-[8px] text-ink-2 hover:bg-surface-2">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          {rows.map((r) => (
            <CookConfirmRow
              key={r.key}
              row={r}
              unitOptions={unitOptionsFor(r.unit)}
              hint={formatTotalsByUnit(pantryByIngredient.get(r.ingredientId))}
              onChange={(patch) => updateRow(r.key, patch)}
              onRemove={r.adhoc ? () => removeRow(r.key) : undefined}
            />
          ))}
          <AddIngredientRow excludeIds={excludeIds} onPick={addAdhoc} />
        </div>

        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-line-soft">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Mark cooked"}
          </Button>
        </div>
      </div>
    </div>
  );
}
