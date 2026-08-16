import { useEffect, useMemo, useState } from "react";
import { X, Check } from "lucide-react";
import type { PlannedMeal, DeductOverride } from "../../api/plans";
import type { PantryCard } from "../../api/pantry";
import type { Ingredient } from "../../api/ingredients";
import CookConfirmRow, { type CookConfirmRowState, type PantryHint } from "./CookConfirmRow";
import AddIngredientRow from "./AddIngredientRow";
import Button from "../ui/Button";
import { formatQuantity, roundQuantity } from "../../lib/formatQuantity";
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


function formatTotalsByUnit(card: PantryCard | undefined): PantryHint {
  if (!card || card.batchCount === 0) return { text: "pantry: none", warn: false };
  const parts = card.totalsByUnit.map((t) => `${formatQuantity(t.qty)} ${t.unit}`);
  const suffix = card.batchCount > 1 ? ` (${card.batchCount} batches)` : "";
  return { text: `pantry: ${parts.join(" · ")}${suffix}`, warn: false };
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
      quantity: roundQuantity(mi.quantity * multiplier),
      unit: mi.unit,
      checked: true,
      adhoc: false,
    })),
  );
  const [busy, setBusy] = useState(false);
  // "loading": the automatic pantry check on open. "summary": the one-tap
  // happy path — clean deductions collapsed, only flagged rows shown.
  // "review": every deduction row, editable. "use": legacy recipe-amount
  // editor (scaling fixes, ad-hoc additions, and the fallback when the
  // preview call fails).
  const [step, setStep] = useState<"loading" | "summary" | "review" | "use">("loading");
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

  const runPreview = async (sourceRows: CookConfirmRowState[]): Promise<boolean> => {
    const lines: CookPreviewInputLine[] = sourceRows
      .filter((r) => r.checked && r.quantity > 0)
      .map((r) => ({ ingredientId: r.ingredientId, name: r.ingredientName, quantity: r.quantity, unit: r.unit }));
    try {
      const preview = await onPreview(lines);
      setConfirmRows(
        preview.map((p, i) => ({
          key: `cr-${i}`,
          sourceIngredientId: p.sourceIngredientId,
          name: p.name,
          matchedIngredientId: p.matchedIngredientId,
          matchedName: p.matchedName,
          confidence: p.confidence,
          deductQuantity: roundQuantity(p.deductQuantity),
          deductUnit: p.deductUnit,
          pantryTotals: p.pantryTotals,
          projectedRemaining: p.projectedRemaining,
          included: p.included,
        })),
      );
      return true;
    } catch {
      return false;
    }
  };

  // The pantry check runs automatically on open: the common case — cooked the
  // planned meal, mappings clean — should be one tap, not a two-step audit.
  useEffect(() => {
    let cancelled = false;
    runPreview(rows).then((ok) => {
      if (!cancelled) setStep(ok ? "summary" : "use");
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goToConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await runPreview(rows);
      if (ok) setStep("summary");
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

  // Clean rows auto-apply silently; anything the preview flagged (shaky match,
  // guessed conversion, no match) is the only thing the user is asked about.
  const cleanRows = confirmRows.filter((r) => r.confidence === "exact" || r.confidence === "converted");
  const flaggedRows = confirmRows.filter((r) => r.confidence === "estimated" || r.confidence === "none");

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
          {step === "loading" ? (
            <div className="py-10 text-center text-[13px] text-ink-3">Checking pantry…</div>
          ) : step === "use" ? (
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
          ) : step === "summary" ? (
            <>
              {cleanRows.length > 0 && (
                <div className="mt-2 mb-1 bg-accent-soft border border-accent-line rounded-[12px] px-4 py-3">
                  <div className="text-[12.5px] font-semibold text-accent-ink flex items-center gap-1.5">
                    <Check size={13} strokeWidth={3} /> Deduct as planned · {cleanRows.length}
                  </div>
                  <div className="text-[12px] text-ink-3 mt-1">
                    {cleanRows.map((r) => r.name).join(", ")}
                  </div>
                </div>
              )}
              {flaggedRows.length > 0 && (
                <>
                  <div className="px-1 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                    Needs attention · {flaggedRows.length}
                  </div>
                  <ConfirmStep
                    rows={flaggedRows}
                    cards={pantryCards}
                    onChangeRow={changeConfirmRow}
                    onRepoint={repoint}
                  />
                </>
              )}
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
          {step === "loading" ? (
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          ) : step === "use" ? (
            <>
              <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
              <Button variant="primary" onClick={goToConfirm} disabled={busy}>
                {busy ? "Checking…" : "Next"}
              </Button>
            </>
          ) : step === "summary" ? (
            <>
              <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
              <Button variant="ghost" onClick={() => setStep("review")} disabled={busy}>Review all</Button>
              <Button variant="primary" onClick={confirmSubmit} disabled={busy}>
                {busy ? "Saving…" : "Cook it"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setStep("summary")} disabled={busy}>Back</Button>
              <Button variant="ghost" onClick={() => setStep("use")} disabled={busy}>Edit amounts</Button>
              <Button variant="primary" onClick={confirmSubmit} disabled={busy}>
                {busy ? "Saving…" : "Cook it"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
