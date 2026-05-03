import { useEffect, useMemo, useState } from "react";
import { Plus, Refrigerator, BookMarked, Snowflake, Receipt as ReceiptIcon } from "lucide-react";
import {
  addPantryItem,
  deletePantryItem,
  getPantry,
  type PantryItem,
} from "../api/pantry";
import { getIngredients, type Ingredient } from "../api/ingredients";
import Pill from "../components/ui/Pill";
import Button from "../components/ui/Button";
import AddFromReceiptModal from "../components/AddFromReceiptModal";
import SpendingStrip from "../components/SpendingStrip";
import RecentReceiptsStrip from "../components/RecentReceiptsStrip";

const LOCATIONS = ["fridge", "freezer", "pantry"] as const;
const LOC_TITLES: Record<string, string> = { fridge: "Fridge", freezer: "Freezer", pantry: "Pantry" };
const LOC_ICONS: Record<string, import("lucide-react").LucideIcon> = {
  fridge: Refrigerator,
  freezer: Snowflake,
  pantry: BookMarked,
};

const CATEGORY_LABELS: Record<string, string> = {
  produce: "Produce",
  protein: "Protein",
  dairy: "Dairy",
  pantry_staple: "Pantry",
  grain: "Grains",
  spice: "Spices",
  condiment: "Condiments",
  frozen: "Frozen",
  other: "Other",
};

function expiresInDays(item: PantryItem): number | null {
  if (!item.expirationDate) return null;
  const ms = new Date(item.expirationDate).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export default function Pantry() {
  const [items, setItems] = useState<PantryItem[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newItem, setNewItem] = useState({ ingredientId: 0, quantity: 1, unit: "", location: "pantry" });
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [receiptRefreshKey, setReceiptRefreshKey] = useState(0);

  const load = () => {
    getPantry().then(setItems).catch(() => setItems([]));
    getIngredients().then(setIngredients).catch(() => setIngredients([]));
  };
  useEffect(load, []);

  const grouped = useMemo(() => {
    const g: Record<string, PantryItem[]> = { fridge: [], freezer: [], pantry: [] };
    for (const it of items) (g[it.location] ?? g.pantry).push(it);
    return g;
  }, [items]);

  const handleAdd = async () => {
    if (!newItem.ingredientId) return;
    const ing = ingredients.find((i) => i.id === newItem.ingredientId);
    await addPantryItem({
      ...newItem,
      unit: newItem.unit || ing?.defaultUnit || "count",
    });
    setShowAdd(false);
    setNewItem({ ingredientId: 0, quantity: 1, unit: "", location: "pantry" });
    load();
  };

  return (
    <div className="flex flex-col gap-7">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[12px] uppercase tracking-[0.1em] text-ink-3 mb-1.5">
            {items.length} item{items.length === 1 ? "" : "s"} on hand
          </div>
          <h1 className="text-[26px] sm:text-[30px] font-semibold -tracking-[0.02em] text-ink-1">Pantry</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon={ReceiptIcon} onClick={() => setShowReceiptModal(true)}>
            Add from receipt
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => setShowAdd((v) => !v)}>
            Add item
          </Button>
        </div>
      </div>

      <SpendingStrip refreshKey={receiptRefreshKey} />
      <RecentReceiptsStrip refreshKey={receiptRefreshKey} />

      {showAdd && (
        <div className="bg-surface-1 border border-line rounded-[14px] p-4 flex gap-3 items-end flex-wrap amp-fade-in">
          <Field label="Ingredient">
            <select
              value={newItem.ingredientId}
              onChange={(e) => setNewItem({ ...newItem, ingredientId: Number(e.target.value) })}
              className="h-9 rounded-[10px] border border-line bg-surface-2 px-2.5 text-[13px] text-ink-1 outline-none focus:border-accent"
            >
              <option value={0}>Select…</option>
              {ingredients.map((ing) => (<option key={ing.id} value={ing.id}>{ing.name}</option>))}
            </select>
          </Field>
          <Field label="Quantity">
            <input
              type="number"
              value={newItem.quantity}
              onChange={(e) => setNewItem({ ...newItem, quantity: Number(e.target.value) })}
              className="h-9 w-24 rounded-[10px] border border-line bg-surface-2 px-3 text-[13px] text-ink-1 outline-none focus:border-accent tabular-nums"
              min={0}
            />
          </Field>
          <Field label="Unit">
            <input
              type="text"
              value={newItem.unit}
              onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
              placeholder="auto"
              className="h-9 w-24 rounded-[10px] border border-line bg-surface-2 px-3 text-[13px] text-ink-1 outline-none focus:border-accent"
            />
          </Field>
          <Field label="Location">
            <select
              value={newItem.location}
              onChange={(e) => setNewItem({ ...newItem, location: e.target.value })}
              className="h-9 rounded-[10px] border border-line bg-surface-2 px-2.5 text-[13px] text-ink-1 outline-none focus:border-accent capitalize"
            >
              {LOCATIONS.map((l) => <option key={l} value={l}>{LOC_TITLES[l]}</option>)}
            </select>
          </Field>
          <Button variant="primary" onClick={handleAdd}>Add</Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
        {LOCATIONS.map((loc) => {
          const Icon = LOC_ICONS[loc];
          const list = grouped[loc] ?? [];
          return (
            <div key={loc} className="bg-surface-1 border border-line rounded-[14px] overflow-hidden">
              <div className="flex items-center gap-2 px-4 sm:px-5 py-3.5 border-b border-line-soft">
                <div className="w-7 h-7 rounded-[8px] bg-accent-soft text-accent-ink grid place-items-center">
                  <Icon size={15} />
                </div>
                <div className="flex-1">
                  <div className="text-[14px] font-semibold text-ink-1">{LOC_TITLES[loc]}</div>
                  <div className="text-[11px] text-ink-3">{list.length} item{list.length === 1 ? "" : "s"}</div>
                </div>
              </div>
              <div>
                {list.length === 0 ? (
                  <div className="px-4 sm:px-5 py-5 text-[12.5px] text-ink-3">Nothing here.</div>
                ) : list.map((p, i) => (
                  <Row key={p.id} item={p} last={i === list.length - 1} onDelete={async (id) => { await deletePantryItem(id); load(); }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {showReceiptModal && (
        <AddFromReceiptModal
          onClose={() => setShowReceiptModal(false)}
          onCommitted={() => {
            setReceiptRefreshKey((k) => k + 1);
            load(); // refresh pantry items so newly-added pantry rows appear
          }}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">{label}</label>
      {children}
    </div>
  );
}

function Row({ item, last, onDelete }: { item: PantryItem; last: boolean; onDelete: (id: number) => void }) {
  const d = expiresInDays(item);
  return (
    <div
      className={`grid grid-cols-[1fr_auto_auto] gap-2.5 items-center px-4 sm:px-5 py-2.5 ${last ? "" : "border-b border-line-soft"} group`}
    >
      <div>
        <div className="text-[13.5px] text-ink-1 font-medium truncate">{item.ingredient.name}</div>
        <div className="text-[11px] text-ink-3 mt-px">{CATEGORY_LABELS[item.ingredient.category] ?? item.ingredient.category}</div>
      </div>
      <div className="text-[13px] text-ink-2 tabular-nums">
        {item.quantity} {item.unit}
      </div>
      {d != null ? (
        <Pill tone={d <= 3 ? "warn" : "ghost"} size="sm">{d}d</Pill>
      ) : (
        <button
          onClick={() => onDelete(item.id)}
          className="text-[11px] text-ink-3 opacity-0 group-hover:opacity-100 transition hover:text-danger"
        >
          remove
        </button>
      )}
    </div>
  );
}
