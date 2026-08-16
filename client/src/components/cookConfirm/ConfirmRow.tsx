import { Check } from "lucide-react";
import type { CookConfidence } from "../../api/plans";
import { formatQuantity } from "../../lib/formatQuantity";

export interface ConfirmRowState {
  key: string;
  sourceIngredientId: number;
  name: string;
  matchedIngredientId: number | null;
  matchedName: string | null;
  confidence: CookConfidence;
  deductQuantity: number;
  deductUnit: string;
  pantryTotals: Array<{ unit: string; qty: number }>;
  projectedRemaining: { qty: number; unit: string } | null;
  included: boolean;
}

const TIER_LABEL: Record<CookConfidence, string> = {
  exact: "",
  converted: "converted",
  estimated: "low confidence",
  none: "not in pantry",
};


interface Props {
  row: ConfirmRowState;
  unitOptions: string[];
  onChange: (patch: Partial<ConfirmRowState>) => void;
  onPick?: () => void; // opens the pantry-item picker for no-match rows
}

export default function ConfirmRow({ row, unitOptions, onChange, onPick }: Props) {
  const dim = !row.included;
  const flagged = row.confidence === "estimated" || row.confidence === "converted";
  const noMatch = row.confidence === "none" || row.matchedIngredientId === null;

  const totals = row.pantryTotals.map((t) => `${formatQuantity(t.qty)} ${t.unit}`).join(" · ") || "none";

  return (
    <div className="grid grid-cols-[18px_1fr_64px_88px] gap-2.5 items-center px-1 py-2.5 border-b border-line-soft">
      <button
        type="button"
        onClick={() => onChange({ included: !row.included })}
        aria-label={row.included ? "Skip this ingredient" : "Include this ingredient"}
        className={`w-4 h-4 inline-flex items-center justify-center rounded-[4px] border transition ${
          row.included ? "bg-accent border-accent text-accent-on" : "bg-transparent border-line"
        }`}
      >
        {row.included && <Check size={11} strokeWidth={3} />}
      </button>

      <div className={dim ? "opacity-50" : ""}>
        <div className="text-[13.5px] text-ink-1 leading-tight">
          {row.name}
          {row.matchedName && row.matchedName.toLowerCase() !== row.name.toLowerCase() && (
            <span className="text-ink-3"> → {row.matchedName}</span>
          )}
        </div>
        <div className={`text-[11px] mt-0.5 ${flagged ? "text-warn-ink" : "text-ink-3"}`}>
          {noMatch ? (
            <button type="button" onClick={onPick} className="underline hover:text-ink-1">
              pick pantry item…
            </button>
          ) : (
            <>
              pantry: {totals}
              {row.projectedRemaining && (
                <> · → {formatQuantity(row.projectedRemaining.qty)} {row.projectedRemaining.unit} left</>
              )}
              {TIER_LABEL[row.confidence] && <> · ⚠ {TIER_LABEL[row.confidence]}</>}
            </>
          )}
        </div>
      </div>

      <input
        type="number"
        step="any"
        min="0"
        value={row.deductQuantity}
        disabled={noMatch}
        onChange={(e) => onChange({ deductQuantity: Number(e.target.value) })}
        className={`px-2 py-1.5 text-[13px] bg-surface-2 border border-line rounded-[6px] text-right text-ink-1 tabular-nums focus:outline-none focus:border-accent ${dim || noMatch ? "opacity-50" : ""}`}
      />

      <select
        value={row.deductUnit}
        disabled={noMatch}
        onChange={(e) => onChange({ deductUnit: e.target.value })}
        className={`px-2 py-1.5 text-[13px] bg-surface-2 border border-line rounded-[6px] text-ink-1 focus:outline-none focus:border-accent ${dim || noMatch ? "opacity-50" : ""}`}
      >
        {unitOptions.map((u) => (
          <option key={u} value={u}>{u}</option>
        ))}
      </select>
    </div>
  );
}
