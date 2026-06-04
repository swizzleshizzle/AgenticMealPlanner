import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { PlannedMeal, DeductOverride } from "../../api/plans";
import type { PantryCard } from "../../api/pantry";
import type { Ingredient } from "../../api/ingredients";
import CookConfirmRow, { type CookConfirmRowState, type PantryHint } from "./CookConfirmRow";
import AddIngredientRow from "./AddIngredientRow";
import Button from "../ui/Button";
import ConfirmStep from "./ConfirmStep";
import type { ConfirmRowState } from "./ConfirmRow";
import type { CookPreviewInputLine, CookPreviewLine } from "../../api/plans";

const UNIT_OPTIONS_VOLUME = ["tsp", "tbsp", "cup", "ml", "l", "fl oz"];
const UNIT_OPTIONS_MASS = ["g", "kg", "oz", "lb"];
const UNIT_OPTIONS_COUNT = ["count"];

function familyFor(unit: string): string[] | null {
  if (UNIT_OPTIONS_VOLUME.includes(unit)) return UNIT_OPTIONS_VOLUME;
  if (UNIT_OPTIONS_MASS.includes(unit)) return UNIT_OPTIONS_MASS;
  if (UNIT_OPTIONS_COUNT.includes(unit)) return UNIT_OPTIONS_COUNT;
  return null;
}

function unitOptionsFor(unit: string, ingredientDefaultUnit: string): string[] {
  // Known family — return it. Covers the common case (recipe says "tbsp" → volume options).
  const own = familyFor(unit);
  if (own) return own;
  // Exotic unit (e.g. "whole", "stick") — fall back to the ingredient's default-unit family
  // so the user has somewhere sensible to switch to. Keep the exotic unit selectable.
  const fallback = familyFor(ingredientDefaultUnit) ?? [];
  return Array.from(new Set([unit, ...fallback]));
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
  pantryCards: PantryCard[];
  onCancel: () => void;
  onPreview: (lines: CookPreviewInputLine[]) => Promise<CookPreviewLine[]>;
  onSubmit: (overrides: DeductOverride[]) => Promise<void>;
  /** Phase B: persist a re-point as an alias. Omitted in Phase A (no learning). */
  onRepointPersist?: (aliasName: string, ingredientId: number) => void;
}

export default function CookConfirmModal({ pm, pantryByIngredient, pantryCards, onCancel, onPreview, onSubmit, onRepointPersist }: Props) {
  const multiplier = pm.servings / pm.meal.servings;

  const [rows, setRows] = useState<CookConfirmRowState[]>(() =>
    pm.meal.ingredients.map((mi) => ({
      key: `mi-${mi.id}`,
      ingredientId: mi.ingredient.id,
      ingredientName: mi.ingredient.name,
      ingredientDefaultUnit: mi.ingredient.defaultUnit,
      quantity: roundQty(mi.quantity * multiplier),
      unit: mi.unit,
      checked: true,
      adhoc: false,
    })),
  );
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"use" | "confirm">("use");
  const [confirmRows, setConfirmRows] = useState<ConfirmRowState[]>([]);

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
        ingredientDefaultUnit: i.defaultUnit,
        quantity: 1,
        unit: i.defaultUnit,
        checked: true,
        adhoc: true,
      },
    ]);
  };

  const goToConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const lines: CookPreviewInputLine[] = rows
        .filter((r) => r.checked && r.quantity > 0)
        .map((r) => ({ ingredientId: r.ingredientId, name: r.ingredientName, quantity: r.quantity, unit: r.unit }));
      const preview = await onPreview(lines);
      setConfirmRows(
        preview.map((p, i) => ({
          key: `cr-${i}`,
          sourceIngredientId: p.sourceIngredientId,
          name: p.name,
          matchedIngredientId: p.matchedIngredientId,
          matchedName: p.matchedName,
          confidence: p.confidence,
          deductQuantity: p.deductQuantity,
          deductUnit: p.deductUnit,
          pantryTotals: p.pantryTotals,
          projectedRemaining: p.projectedRemaining,
          included: p.included,
        })),
      );
      setStep("confirm");
    } finally {
      setBusy(false);
    }
  };

  const changeConfirmRow = (key: string, patch: Partial<ConfirmRowState>) =>
    setConfirmRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const repoint = (key: string, ing: Ingredient, card: PantryCard | undefined) => {
    setConfirmRows((prev) =>
      prev.map((r) =>
        r.key === key
          ? {
              ...r,
              matchedIngredientId: ing.id,
              matchedName: ing.name,
              confidence: "estimated" as const,
              included: true,
              deductUnit: card?.totalsByUnit[0]?.unit ?? card?.ingredient.defaultUnit ?? r.deductUnit,
              pantryTotals: card?.totalsByUnit ?? [],
              projectedRemaining: null,
            }
          : r,
      ),
    );
    const row = confirmRows.find((r) => r.key === key);
    if (row) onRepointPersist?.(row.name, ing.id);
  };

  const confirmSubmit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const overrides = confirmRows
        .filter((r) => r.included && r.matchedIngredientId != null && r.deductQuantity > 0)
        .map<DeductOverride>((r) => ({
          ingredientId: r.matchedIngredientId as number,
          quantity: r.deductQuantity,
          unit: r.deductUnit,
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
          {step === "use" ? (
            <>
              {rows.map((r) => (
                <CookConfirmRow
                  key={r.key}
                  row={r}
                  unitOptions={unitOptionsFor(r.unit, r.ingredientDefaultUnit)}
                  hint={formatTotalsByUnit(pantryByIngredient.get(r.ingredientId))}
                  onChange={(patch) => updateRow(r.key, patch)}
                  onRemove={r.adhoc ? () => removeRow(r.key) : undefined}
                />
              ))}
              <AddIngredientRow excludeIds={excludeIds} onPick={addAdhoc} />
            </>
          ) : (
            <ConfirmStep
              rows={confirmRows}
              cards={pantryCards}
              onChangeRow={changeConfirmRow}
              onRepoint={repoint}
            />
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-line-soft">
          {step === "use" ? (
            <>
              <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
              <Button variant="primary" onClick={goToConfirm} disabled={busy}>
                {busy ? "Checking…" : "Next"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setStep("use")} disabled={busy}>Back</Button>
              <Button variant="primary" onClick={confirmSubmit} disabled={busy}>
                {busy ? "Saving…" : "Confirm"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
