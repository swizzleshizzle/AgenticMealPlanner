// client/src/components/pantry/BatchAddForm.tsx
import { useState } from "react";
import type { Ingredient } from "../../api/ingredients";
import type { PantryLocation } from "../../api/pantry";
import { createBatch } from "../../api/pantry";
import Button from "../ui/Button";

interface Props {
  ingredient: Ingredient;
  onCancel: () => void;
  onSaved: () => void;
}

export default function BatchAddForm({ ingredient, onCancel, onSaved }: Props) {
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState(ingredient.defaultUnit);
  const [location, setLocation] = useState<PantryLocation>(ingredient.defaultLocation ?? "pantry");
  const [expirationDate, setExpirationDate] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [costAtPurchase, setCostAtPurchase] = useState("");

  const save = async () => {
    await createBatch({
      ingredientId: ingredient.id,
      quantity,
      unit,
      location,
      expirationDate: expirationDate || null,
      purchaseDate,
      costAtPurchase: costAtPurchase === "" ? null : Number(costAtPurchase),
      tags: [],
    });
    onSaved();
  };

  return (
    <div className="bg-surface-2 border border-accent-line rounded-[10px] p-3 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Quantity"><input type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className={inputCls} /></Field>
        <Field label="Unit"><input value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls} /></Field>
        <Field label="Location">
          <select value={location} onChange={(e) => setLocation(e.target.value as PantryLocation)} className={inputCls + " capitalize"}>
            <option value="fridge">Fridge</option>
            <option value="freezer">Freezer</option>
            <option value="pantry">Pantry</option>
          </select>
        </Field>
        <Field label="Expiration"><input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} className={inputCls} /></Field>
        <Field label="Purchased"><input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className={inputCls} /></Field>
        <Field label="Cost ($)"><input type="number" step="0.01" min={0} value={costAtPurchase} onChange={(e) => setCostAtPurchase(e.target.value)} className={inputCls} /></Field>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={save}>Add batch</Button>
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
