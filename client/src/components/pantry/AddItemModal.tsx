// client/src/components/pantry/AddItemModal.tsx
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { getIngredients, type Ingredient, type IngredientCategory, type PantryLocation } from "../../api/ingredients";
import { createBatch } from "../../api/pantry";
import Button from "../ui/Button";

const CATEGORIES: IngredientCategory[] = [
  "produce", "protein", "dairy", "pantry_staple", "grain", "spice", "condiment", "frozen", "other",
];

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

type Tab = "existing" | "new";

export default function AddItemModal({ onClose, onAdded }: Props) {
  const [tab, setTab] = useState<Tab>("existing");
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [search, setSearch] = useState("");

  // Common batch fields
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState("");
  const [location, setLocation] = useState<PantryLocation>("pantry");
  const [expirationDate, setExpirationDate] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [costAtPurchase, setCostAtPurchase] = useState("");

  // Existing-tab state
  const [selected, setSelected] = useState<Ingredient | null>(null);

  // New-tab state
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<IngredientCategory>("other");
  const [newDefaultUnit, setNewDefaultUnit] = useState("count");
  const [newIsOneOff, setNewIsOneOff] = useState(false);

  useEffect(() => {
    getIngredients().then(setIngredients).catch(() => setIngredients([]));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ingredients.slice(0, 30);
    return ingredients.filter((i) => i.name.includes(q)).slice(0, 30);
  }, [ingredients, search]);

  const selectIngredient = (i: Ingredient) => {
    setSelected(i);
    setUnit(i.defaultUnit);
    setLocation(i.defaultLocation ?? "pantry");
  };

  const submit = async () => {
    if (tab === "existing") {
      if (!selected) return;
      await createBatch({
        ingredientId: selected.id,
        quantity,
        unit,
        location,
        expirationDate: expirationDate || null,
        purchaseDate,
        costAtPurchase: costAtPurchase === "" ? null : Number(costAtPurchase),
      });
    } else {
      if (!newName.trim()) return;
      await createBatch({
        newIngredient: {
          name: newName,
          category: newCategory,
          defaultUnit: newDefaultUnit,
          defaultLocation: location,
          isOneOff: newIsOneOff,
        },
        quantity,
        unit: unit || newDefaultUnit,
        location,
        expirationDate: expirationDate || null,
        purchaseDate,
        costAtPurchase: costAtPurchase === "" ? null : Number(costAtPurchase),
      });
    }
    onAdded();
    onClose();
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8 amp-fade-in" style={{ background: "rgba(30, 22, 10, 0.55)", backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} className="bg-surface-1 rounded-[16px] w-full max-w-[600px] max-h-[88vh] flex flex-col overflow-hidden border border-line">
        <div className="flex items-start gap-3 px-5 py-4 border-b border-line-soft">
          <div className="flex-1">
            <div className="text-[14px] font-semibold text-ink-1">Add item</div>
            <div className="text-[11px] text-ink-3">Pick an existing ingredient or create a new one</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 grid place-items-center rounded-[8px] text-ink-2 hover:bg-surface-2"><X size={16} /></button>
        </div>

        <div className="px-5 pt-4 flex gap-2">
          <TabButton active={tab === "existing"} onClick={() => setTab("existing")}>Existing</TabButton>
          <TabButton active={tab === "new"} onClick={() => setTab("new")}>New ingredient</TabButton>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3">
          {tab === "existing" ? (
            <>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ingredients…" className={inputCls} />
              <div className="max-h-40 overflow-y-auto border border-line-soft rounded-[10px]">
                {filtered.map((i) => (
                  <button key={i.id} onClick={() => selectIngredient(i)} className={`w-full text-left px-3 py-2 text-[13px] hover:bg-surface-2 ${selected?.id === i.id ? "bg-accent-soft text-accent-ink" : "text-ink-1"}`}>
                    <span className="capitalize">{i.name}</span>
                    <span className="text-[11px] text-ink-3 ml-2">{i.category}</span>
                  </button>
                ))}
                {filtered.length === 0 && <div className="px-3 py-2 text-[12px] text-ink-3">No matches.</div>}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Name"><input value={newName} onChange={(e) => setNewName(e.target.value)} className={inputCls} /></Field>
              <Field label="Category">
                <select value={newCategory} onChange={(e) => setNewCategory(e.target.value as IngredientCategory)} className={inputCls}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Default unit"><input value={newDefaultUnit} onChange={(e) => setNewDefaultUnit(e.target.value)} className={inputCls} /></Field>
              <div className="flex items-end">
                <label className="text-[12px] text-ink-2 flex items-center gap-1.5">
                  <input type="checkbox" checked={newIsOneOff} onChange={(e) => setNewIsOneOff(e.target.checked)} />
                  One-off (don't add to ingredient list)
                </label>
              </div>
            </div>
          )}

          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold mt-2">Batch</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Quantity"><input type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className={inputCls} /></Field>
            <Field label="Unit"><input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={tab === "new" ? newDefaultUnit : ""} className={inputCls} /></Field>
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
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-line-soft">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={submit}>Add</Button>
        </div>
      </div>
    </div>
  );
}

const inputCls = "h-9 w-full rounded-[10px] border border-line bg-surface-2 px-2.5 text-[13px] text-ink-1 outline-none focus:border-accent";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">{label}</label>
      {children}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-[10px] text-[13px] ${active ? "bg-accent-soft text-accent-ink" : "text-ink-2 hover:bg-surface-2"}`}
    >
      {children}
    </button>
  );
}
