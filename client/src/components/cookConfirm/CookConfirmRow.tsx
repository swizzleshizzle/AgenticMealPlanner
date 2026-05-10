import { Check, X } from "lucide-react";

export interface CookConfirmRowState {
  /** Stable React key (recipe `mealIngredient.id` for recipe rows; "adhoc-${counter}" for ad-hoc). */
  key: string;
  ingredientId: number;
  ingredientName: string;
  quantity: number;
  unit: string;
  /** Whether this row will be sent to the server. Recipe rows default true; ad-hoc rows always true. */
  checked: boolean;
  /** True for ad-hoc rows. Affects whether the X (remove) button shows. */
  adhoc: boolean;
}

export interface PantryHint {
  /** "240 ml" or "480 g · 1 lb (2 batches)" or "none". */
  text: string;
  /** True when the row's selected unit is cross-family vs pantry batches and density is missing. */
  warn: boolean;
}

interface Props {
  row: CookConfirmRowState;
  unitOptions: string[];
  hint: PantryHint;
  onChange: (patch: Partial<CookConfirmRowState>) => void;
  onRemove?: () => void; // only set for ad-hoc rows
}

export default function CookConfirmRow({ row, unitOptions, hint, onChange, onRemove }: Props) {
  const dim = !row.checked;
  return (
    <div className="grid grid-cols-[18px_1fr_64px_88px_16px] gap-2.5 items-center px-1 py-2.5 border-b border-line-soft">
      <button
        type="button"
        onClick={() => onChange({ checked: !row.checked })}
        aria-label={row.checked ? "Skip this ingredient" : "Include this ingredient"}
        className={`w-4 h-4 inline-flex items-center justify-center rounded-[4px] border transition ${
          row.checked
            ? "bg-accent border-accent text-accent-on"
            : "bg-transparent border-line"
        }`}
      >
        {row.checked && <Check size={11} strokeWidth={3} />}
      </button>

      <div className={dim ? "opacity-50" : ""}>
        <div className="text-[13.5px] text-ink-1 leading-tight">{row.ingredientName}</div>
        <div className={`text-[11px] mt-0.5 ${hint.warn ? "text-warn-ink" : "text-ink-3"}`}>
          {hint.text}
        </div>
      </div>

      <input
        type="number"
        step="any"
        min="0"
        value={row.quantity}
        onChange={(e) => onChange({ quantity: Number(e.target.value) })}
        className={`px-2 py-1.5 text-[13px] bg-surface-2 border border-line rounded-[6px] text-right text-ink-1 tabular-nums focus:outline-none focus:border-accent ${dim ? "opacity-50" : ""}`}
      />

      <select
        value={row.unit}
        onChange={(e) => onChange({ unit: e.target.value })}
        className={`px-2 py-1.5 text-[13px] bg-surface-2 border border-line rounded-[6px] text-ink-1 focus:outline-none focus:border-accent ${dim ? "opacity-50" : ""}`}
      >
        {unitOptions.map((u) => (
          <option key={u} value={u}>{u}</option>
        ))}
      </select>

      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove this ingredient"
          className="text-ink-3 hover:text-ink-1 grid place-items-center"
        >
          <X size={13} />
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}
