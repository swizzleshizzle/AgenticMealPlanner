import { useState } from "react";
import Button from "./ui/Button";
import { Check } from "lucide-react";

interface Props {
  initialData?: any;
  onSubmit: (data: any) => void;
  submitLabel?: string;
}

const FIELD =
  "w-full rounded-[10px] border border-line bg-surface-2 px-3 py-2 text-[13.5px] text-ink-1 outline-none focus:border-accent focus:bg-surface-1 transition";
const LABEL = "text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold mb-1.5 block";

export default function MealForm({ initialData, onSubmit, submitLabel = "Save" }: Props) {
  const [form, setForm] = useState(
    initialData || {
      name: "", description: "", mealType: "cook_fresh", servings: 2,
      prepTime: null, cookTime: null, tags: [], instructions: [],
      calories: null, proteinG: null, carbsG: null, fatG: null, ingredients: [],
    },
  );

  const update = (field: string, value: any) => setForm({ ...form, [field]: value });

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} className="flex flex-col gap-4">
      <div>
        <label className={LABEL}>Name</label>
        <input value={form.name} onChange={(e) => update("name", e.target.value)} className={FIELD} required />
      </div>
      <div>
        <label className={LABEL}>Description</label>
        <textarea value={form.description || ""} onChange={(e) => update("description", e.target.value)} className={FIELD} rows={2} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Meal Type</label>
          <select value={form.mealType} onChange={(e) => update("mealType", e.target.value)} className={FIELD}>
            <option value="cook_fresh">Cook Fresh</option>
            <option value="batch_prep">Batch Prep</option>
          </select>
        </div>
        <div>
          <label className={LABEL}>Servings</label>
          <input type="number" value={form.servings} onChange={(e) => update("servings", Number(e.target.value))} className={`${FIELD} tabular-nums`} min={1} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Prep Time (min)</label>
          <input type="number" value={form.prepTime || ""} onChange={(e) => update("prepTime", e.target.value ? Number(e.target.value) : null)} className={`${FIELD} tabular-nums`} />
        </div>
        <div>
          <label className={LABEL}>Cook Time (min)</label>
          <input type="number" value={form.cookTime || ""} onChange={(e) => update("cookTime", e.target.value ? Number(e.target.value) : null)} className={`${FIELD} tabular-nums`} />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className={LABEL}>Calories</label>
          <input type="number" value={form.calories || ""} onChange={(e) => update("calories", e.target.value ? Number(e.target.value) : null)} className={`${FIELD} tabular-nums`} />
        </div>
        <div>
          <label className={LABEL}>Protein (g)</label>
          <input type="number" value={form.proteinG || ""} onChange={(e) => update("proteinG", e.target.value ? Number(e.target.value) : null)} className={`${FIELD} tabular-nums`} />
        </div>
        <div>
          <label className={LABEL}>Carbs (g)</label>
          <input type="number" value={form.carbsG || ""} onChange={(e) => update("carbsG", e.target.value ? Number(e.target.value) : null)} className={`${FIELD} tabular-nums`} />
        </div>
        <div>
          <label className={LABEL}>Fat (g)</label>
          <input type="number" value={form.fatG || ""} onChange={(e) => update("fatG", e.target.value ? Number(e.target.value) : null)} className={`${FIELD} tabular-nums`} />
        </div>
      </div>
      <div>
        <label className={LABEL}>Tags (comma-separated)</label>
        <input
          value={(form.tags || []).join(", ")}
          onChange={(e) => update("tags", e.target.value.split(",").map((t: string) => t.trim()).filter(Boolean))}
          className={FIELD}
          placeholder="chicken, quick, italian"
        />
      </div>
      <div>
        <label className={LABEL}>Instructions (one per line)</label>
        <textarea
          value={(form.instructions || []).join("\n")}
          onChange={(e) => update("instructions", e.target.value.split("\n").filter(Boolean))}
          className={FIELD}
          rows={6}
        />
      </div>
      {(form.ingredients || []).length > 0 && (
        <div>
          <label className={LABEL}>Ingredients · {(form.ingredients || []).length}</label>
          <div className="bg-surface-2 border border-line-soft rounded-[10px] p-3 text-[13px] text-ink-2 leading-relaxed">
            {(form.ingredients || []).map((ing: any, i: number) => (
              <div key={i}>
                <strong className="text-ink-1">{ing.quantity} {ing.unit}</strong> {ing.name || ing.ingredient?.name}
                {ing.preparation && <em className="text-ink-3">, {ing.preparation}</em>}
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <Button type="submit" variant="primary" icon={Check}>{submitLabel}</Button>
      </div>
    </form>
  );
}
