import { useState } from "react";

interface Props {
  initialData?: any;
  onSubmit: (data: any) => void;
  submitLabel?: string;
}

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
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} className="space-y-4 max-w-2xl">
      <div>
        <label className="block text-sm font-medium text-gray-700">Name</label>
        <input value={form.name} onChange={(e) => update("name", e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" required />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Description</label>
        <textarea value={form.description || ""} onChange={(e) => update("description", e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" rows={2} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Meal Type</label>
          <select value={form.mealType} onChange={(e) => update("mealType", e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="cook_fresh">Cook Fresh</option>
            <option value="batch_prep">Batch Prep</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Servings</label>
          <input type="number" value={form.servings} onChange={(e) => update("servings", Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" min={1} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Prep Time (min)</label>
          <input type="number" value={form.prepTime || ""} onChange={(e) => update("prepTime", e.target.value ? Number(e.target.value) : null)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Cook Time (min)</label>
          <input type="number" value={form.cookTime || ""} onChange={(e) => update("cookTime", e.target.value ? Number(e.target.value) : null)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Calories</label>
          <input type="number" value={form.calories || ""} onChange={(e) => update("calories", e.target.value ? Number(e.target.value) : null)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Protein (g)</label>
          <input type="number" value={form.proteinG || ""} onChange={(e) => update("proteinG", e.target.value ? Number(e.target.value) : null)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Carbs (g)</label>
          <input type="number" value={form.carbsG || ""} onChange={(e) => update("carbsG", e.target.value ? Number(e.target.value) : null)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Fat (g)</label>
          <input type="number" value={form.fatG || ""} onChange={(e) => update("fatG", e.target.value ? Number(e.target.value) : null)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Tags (comma separated)</label>
        <input value={(form.tags || []).join(", ")} onChange={(e) => update("tags", e.target.value.split(",").map((t: string) => t.trim()).filter(Boolean))}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="chicken, quick, italian" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Instructions (one per line)</label>
        <textarea value={(form.instructions || []).join("\n")} onChange={(e) => update("instructions", e.target.value.split("\n").filter(Boolean))}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" rows={6} />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Ingredients</label>
        {(form.ingredients || []).map((ing: any, i: number) => (
          <div key={i} className="flex gap-2 mb-2 items-center text-sm">
            <span className="text-gray-700">{ing.quantity} {ing.unit} {ing.name || ing.ingredient?.name} {ing.preparation ? `(${ing.preparation})` : ""}</span>
          </div>
        ))}
      </div>
      <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
        {submitLabel}
      </button>
    </form>
  );
}
