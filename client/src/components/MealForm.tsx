import { useEffect, useMemo, useRef, useState } from "react";
import IngredientEditor, { type DraftIngredient } from "./IngredientEditor";

export interface MealFormData {
  name: string;
  description: string | null;
  canBatch: boolean;
  canFresh: boolean;
  servings: number;
  prepTime: number | null;
  cookTime: number | null;
  tags: string[];
  instructions: string[];
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
  ingredients: DraftIngredient[];
  sourceUrl?: string | null;
}

interface Props {
  initialData?: Partial<MealFormData>;
  onChange?: (data: MealFormData, dirty: boolean) => void;
  formId?: string;
  onSubmit?: (data: MealFormData) => void;
}

const FIELD =
  "w-full rounded-[10px] border border-line bg-surface-2 px-3 py-2 text-[13.5px] text-ink-1 outline-none focus:border-accent focus:bg-surface-1 transition";
const LABEL = "text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold mb-1.5 block";

const EMPTY: MealFormData = {
  name: "", description: null, canBatch: false, canFresh: true,
  servings: 2, prepTime: null, cookTime: null, tags: [], instructions: [],
  calories: null, proteinG: null, carbsG: null, fatG: null, fiberG: null, sodiumMg: null,
  ingredients: [], sourceUrl: null,
};

export default function MealForm({ initialData, onChange, formId, onSubmit }: Props) {
  const [form, setForm] = useState<MealFormData>(() => ({ ...EMPTY, ...(initialData ?? {}) }));
  const initialRef = useRef<MealFormData>(form);

  // If parent swaps initialData (e.g., after async load), reset.
  useEffect(() => {
    if (!initialData) return;
    const next = { ...EMPTY, ...initialData };
    initialRef.current = next;
    setForm(next);
  }, [initialData]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initialRef.current), [form]);

  useEffect(() => { onChange?.(form, dirty); }, [form, dirty, onChange]);

  const update = (patch: Partial<MealFormData>) => setForm((prev) => ({ ...prev, ...patch }));

  return (
    <form
      id={formId}
      onSubmit={(e) => { e.preventDefault(); onSubmit?.(form); }}
      className="flex flex-col gap-4"
    >
      <div>
        <label className={LABEL}>Name</label>
        <input value={form.name} onChange={(e) => update({ name: e.target.value })} className={FIELD} required />
      </div>
      <div>
        <label className={LABEL}>Description</label>
        <textarea value={form.description ?? ""} onChange={(e) => update({ description: e.target.value || null })} className={FIELD} rows={2} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Cook Styles</label>
          <div className="flex flex-col gap-1.5 pt-1">
            <label className="inline-flex items-center gap-2 text-[13.5px] text-ink-1">
              <input type="checkbox" checked={form.canFresh} onChange={(e) => update({ canFresh: e.target.checked })} />
              Cook Fresh
            </label>
            <label className="inline-flex items-center gap-2 text-[13.5px] text-ink-1">
              <input type="checkbox" checked={form.canBatch} onChange={(e) => update({ canBatch: e.target.checked })} />
              Batch Prep
            </label>
          </div>
        </div>
        <div>
          <label className={LABEL}>Servings</label>
          <input type="number" value={form.servings} onChange={(e) => update({ servings: Number(e.target.value) })} className={`${FIELD} tabular-nums`} min={1} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Prep Time (min)</label>
          <input type="number" value={form.prepTime ?? ""} onChange={(e) => update({ prepTime: e.target.value ? Number(e.target.value) : null })} className={`${FIELD} tabular-nums`} />
        </div>
        <div>
          <label className={LABEL}>Cook Time (min)</label>
          <input type="number" value={form.cookTime ?? ""} onChange={(e) => update({ cookTime: e.target.value ? Number(e.target.value) : null })} className={`${FIELD} tabular-nums`} />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div><label className={LABEL}>Calories</label>
          <input type="number" value={form.calories ?? ""} onChange={(e) => update({ calories: e.target.value ? Number(e.target.value) : null })} className={`${FIELD} tabular-nums`} />
        </div>
        <div><label className={LABEL}>Protein (g)</label>
          <input type="number" value={form.proteinG ?? ""} onChange={(e) => update({ proteinG: e.target.value ? Number(e.target.value) : null })} className={`${FIELD} tabular-nums`} />
        </div>
        <div><label className={LABEL}>Carbs (g)</label>
          <input type="number" value={form.carbsG ?? ""} onChange={(e) => update({ carbsG: e.target.value ? Number(e.target.value) : null })} className={`${FIELD} tabular-nums`} />
        </div>
        <div><label className={LABEL}>Fat (g)</label>
          <input type="number" value={form.fatG ?? ""} onChange={(e) => update({ fatG: e.target.value ? Number(e.target.value) : null })} className={`${FIELD} tabular-nums`} />
        </div>
      </div>
      <div>
        <label className={LABEL}>Tags (comma-separated)</label>
        <input
          value={form.tags.join(", ")}
          onChange={(e) => update({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
          className={FIELD}
        />
      </div>
      <div>
        <label className={LABEL}>Ingredients · {form.ingredients.length}</label>
        <IngredientEditor value={form.ingredients} onChange={(next) => update({ ingredients: next })} />
      </div>
      <div>
        <label className={LABEL}>Instructions (one per line)</label>
        <textarea
          value={form.instructions.join("\n")}
          onChange={(e) => update({ instructions: e.target.value.split("\n").filter(Boolean) })}
          className={FIELD}
          rows={6}
        />
      </div>
    </form>
  );
}
