// client/src/components/pantry/IngredientEditForm.tsx
import { useState } from "react";
import type { Ingredient, IngredientCategory, PantryLocation } from "../../api/ingredients";
import { updateIngredient } from "../../api/ingredients";
import Button from "../ui/Button";

const CATEGORIES: IngredientCategory[] = [
  "produce", "protein", "dairy", "pantry_staple", "grain", "spice", "condiment", "frozen", "other",
];

interface Props {
  ingredient: Ingredient;
  onCancel: () => void;
  onSaved: () => void;
}

export default function IngredientEditForm({ ingredient, onCancel, onSaved }: Props) {
  const [name, setName] = useState(ingredient.name);
  const [category, setCategory] = useState<IngredientCategory>(ingredient.category);
  const [defaultUnit, setDefaultUnit] = useState(ingredient.defaultUnit);
  const [defaultLocation, setDefaultLocation] = useState<PantryLocation | "">(ingredient.defaultLocation ?? "");
  const [densityGPerMl, setDensityGPerMl] = useState<string>(ingredient.densityGPerMl?.toString() ?? "");
  const [gramsPerCount, setGramsPerCount] = useState<string>(ingredient.gramsPerCount?.toString() ?? "");
  const [shelfFridge, setShelfFridge] = useState<string>(ingredient.shelfLifeFridgeDays?.toString() ?? "");
  const [shelfFreezer, setShelfFreezer] = useState<string>(ingredient.shelfLifeFreezerDays?.toString() ?? "");
  const [shelfPantry, setShelfPantry] = useState<string>(ingredient.shelfLifePantryDays?.toString() ?? "");
  const [lowStockThreshold, setLowStockThreshold] = useState<string>(ingredient.lowStockThreshold?.toString() ?? "");
  const [lowStockUnit, setLowStockUnit] = useState(ingredient.lowStockUnit ?? "");

  const toNum = (s: string) => s === "" ? null : Number(s);

  const save = async () => {
    await updateIngredient(ingredient.id, {
      name: name.toLowerCase().trim(),
      category,
      defaultUnit: defaultUnit.trim(),
      defaultLocation: defaultLocation || null,
      densityGPerMl: toNum(densityGPerMl),
      gramsPerCount: toNum(gramsPerCount),
      shelfLifeFridgeDays: toNum(shelfFridge),
      shelfLifeFreezerDays: toNum(shelfFreezer),
      shelfLifePantryDays: toNum(shelfPantry),
      lowStockThreshold: toNum(lowStockThreshold),
      lowStockUnit: lowStockUnit || null,
    });
    onSaved();
  };

  return (
    <div className="bg-surface-2 border border-accent-line rounded-[10px] p-3 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
        <Field label="Category">
          <select value={category} onChange={(e) => setCategory(e.target.value as IngredientCategory)} className={inputCls}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Default unit"><input value={defaultUnit} onChange={(e) => setDefaultUnit(e.target.value)} className={inputCls} /></Field>
        <Field label="Default location">
          <select value={defaultLocation} onChange={(e) => setDefaultLocation(e.target.value as any)} className={inputCls + " capitalize"}>
            <option value="">—</option>
            <option value="fridge">Fridge</option>
            <option value="freezer">Freezer</option>
            <option value="pantry">Pantry</option>
          </select>
        </Field>
        <Field label="Density (g/mL)"><input type="number" step="0.001" value={densityGPerMl} onChange={(e) => setDensityGPerMl(e.target.value)} className={inputCls} /></Field>
        <Field label="Grams per count"><input type="number" step="0.1" value={gramsPerCount} onChange={(e) => setGramsPerCount(e.target.value)} className={inputCls} /></Field>
        <Field label="Shelf life (fridge, days)"><input type="number" min={0} value={shelfFridge} onChange={(e) => setShelfFridge(e.target.value)} className={inputCls} /></Field>
        <Field label="Shelf life (freezer, days)"><input type="number" min={0} value={shelfFreezer} onChange={(e) => setShelfFreezer(e.target.value)} className={inputCls} /></Field>
        <Field label="Shelf life (pantry, days)"><input type="number" min={0} value={shelfPantry} onChange={(e) => setShelfPantry(e.target.value)} className={inputCls} /></Field>
        <Field label="Low-stock threshold"><input type="number" step="0.01" min={0} value={lowStockThreshold} onChange={(e) => setLowStockThreshold(e.target.value)} className={inputCls} /></Field>
        <Field label="Low-stock unit"><input value={lowStockUnit} onChange={(e) => setLowStockUnit(e.target.value)} className={inputCls} /></Field>
      </div>

      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={save}>Save ingredient</Button>
      </div>
    </div>
  );
}

const inputCls = "h-9 w-full rounded-[10px] border border-line bg-surface-1 px-2.5 text-[13px] text-ink-1 outline-none focus:border-accent";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">{label}</label>
      {children}
    </div>
  );
}
