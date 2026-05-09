import { useEffect, useMemo, useState } from "react";
import { Plus, X, Search } from "lucide-react";
import { getIngredients, type Ingredient } from "../api/meals";

export interface DraftIngredient {
  ingredientId?: number;
  name: string;
  quantity: number;
  unit: string;
  preparation?: string;
  category?: string;
}

interface Props {
  value: DraftIngredient[];
  onChange: (next: DraftIngredient[]) => void;
}

const FIELD =
  "rounded-[10px] border border-line bg-surface-2 px-3 py-2 text-[13.5px] text-ink-1 outline-none focus:border-accent focus:bg-surface-1 transition";

export default function IngredientEditor({ value, onChange }: Props) {
  const [pool, setPool] = useState<Ingredient[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => { getIngredients().then(setPool).catch(() => setPool([])); }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return pool.slice(0, 12);
    return pool.filter((p) => p.name.toLowerCase().includes(s)).slice(0, 12);
  }, [pool, search]);

  const updateRow = (idx: number, patch: Partial<DraftIngredient>) => {
    const next = value.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const removeRow = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const addExisting = (ing: Ingredient) => {
    onChange([
      ...value,
      { ingredientId: ing.id, name: ing.name, quantity: 1, unit: ing.defaultUnit, category: ing.category },
    ]);
    setPickerOpen(false);
    setSearch("");
  };

  const addNew = () => {
    const name = search.trim();
    if (!name) return;
    onChange([
      ...value,
      { name, quantity: 1, unit: "count" },
    ]);
    setPickerOpen(false);
    setSearch("");
  };

  return (
    <div className="flex flex-col gap-2">
      {value.map((row, i) => (
        <div key={i} className="grid grid-cols-[80px_80px_1fr_140px_28px] gap-2 items-center">
          <input
            type="number"
            value={row.quantity}
            onChange={(e) => updateRow(i, { quantity: Number(e.target.value) })}
            className={`${FIELD} tabular-nums`}
            min={0}
            step="0.01"
          />
          <input
            value={row.unit}
            onChange={(e) => updateRow(i, { unit: e.target.value })}
            className={FIELD}
            placeholder="unit"
          />
          <input
            value={row.name}
            onChange={(e) => updateRow(i, { name: e.target.value })}
            className={FIELD}
            placeholder="ingredient name"
          />
          <input
            value={row.preparation ?? ""}
            onChange={(e) => updateRow(i, { preparation: e.target.value || undefined })}
            className={FIELD}
            placeholder="prep (optional)"
          />
          <button
            type="button"
            onClick={() => removeRow(i)}
            className="text-ink-3 hover:text-danger w-7 h-7 grid place-items-center"
            aria-label="Remove ingredient"
          >
            <X size={14} />
          </button>
        </div>
      ))}

      {pickerOpen ? (
        <div className="bg-surface-1 border border-line rounded-[12px] p-3">
          <div className="flex items-center gap-2 mb-2">
            <Search size={14} className="text-ink-3" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ingredients…"
              className={`${FIELD} flex-1`}
            />
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => addExisting(p)}
                className="text-[12px] px-3 py-[5px] rounded-full bg-surface-2 border border-line hover:border-accent-line"
              >
                {p.name}
              </button>
            ))}
          </div>
          {search.trim() && !pool.some((p) => p.name.toLowerCase() === search.trim().toLowerCase()) && (
            <button
              type="button"
              onClick={addNew}
              className="text-[12.5px] text-accent-ink hover:underline"
            >
              + Create new ingredient: <strong>{search.trim()}</strong>
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="self-start inline-flex items-center gap-1.5 text-[13px] text-accent-ink font-medium hover:underline"
        >
          <Plus size={14} /> Add ingredient
        </button>
      )}
    </div>
  );
}
