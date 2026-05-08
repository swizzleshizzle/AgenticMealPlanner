// client/src/components/pantry/BatchEditForm.tsx
import { useState } from "react";
import type { PantryBatch, PantryLocation } from "../../api/pantry";
import { updateBatch } from "../../api/pantry";
import Button from "../ui/Button";

const TAG_PRESETS = ["use_first", "opened", "thawing"] as const;

interface Props {
  batch: PantryBatch;
  onCancel: () => void;
  onSaved: () => void;
}

export default function BatchEditForm({ batch, onCancel, onSaved }: Props) {
  const [quantity, setQuantity] = useState(batch.quantity);
  const [unit, setUnit] = useState(batch.unit);
  const [location, setLocation] = useState<PantryLocation>(batch.location);
  const [expirationDate, setExpirationDate] = useState(batch.expirationDate?.slice(0, 10) ?? "");
  const [purchaseDate, setPurchaseDate] = useState(batch.purchaseDate?.slice(0, 10) ?? "");
  const [costAtPurchase, setCostAtPurchase] = useState(batch.costAtPurchase ?? "");
  const [tags, setTags] = useState<string[]>(batch.tags);
  const [customTag, setCustomTag] = useState("");

  const toggleTag = (t: string) => {
    setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
  };

  const save = async () => {
    await updateBatch(batch.id, {
      quantity,
      unit,
      location,
      expirationDate: expirationDate || null,
      purchaseDate: purchaseDate || null,
      costAtPurchase: costAtPurchase === "" ? null : Number(costAtPurchase),
      tags,
    });
    onSaved();
  };

  return (
    <div className="bg-surface-2 border border-accent-line rounded-[10px] p-3 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Quantity">
          <input type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className={inputCls} />
        </Field>
        <Field label="Unit">
          <input type="text" value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Location">
          <select value={location} onChange={(e) => setLocation(e.target.value as PantryLocation)} className={inputCls + " capitalize"}>
            <option value="fridge">Fridge</option>
            <option value="freezer">Freezer</option>
            <option value="pantry">Pantry</option>
          </select>
        </Field>
        <Field label="Expiration">
          <input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Purchased">
          <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Cost ($)">
          <input type="number" step="0.01" min={0} value={costAtPurchase as any} onChange={(e) => setCostAtPurchase(e.target.value)} className={inputCls} />
        </Field>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">Tags</label>
        <div className="flex flex-wrap gap-1.5">
          {TAG_PRESETS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggleTag(t)}
              className={`text-[11px] px-2 py-1 rounded-[8px] border ${
                tags.includes(t) ? "bg-accent-soft border-accent text-accent-ink" : "bg-surface-1 border-line text-ink-2"
              }`}
            >
              {t.replace(/_/g, " ")}
            </button>
          ))}
          {tags.filter((t) => !TAG_PRESETS.includes(t as any)).map((t) => (
            <button key={t} type="button" onClick={() => toggleTag(t)} className="text-[11px] px-2 py-1 rounded-[8px] border bg-accent-soft border-accent text-accent-ink">
              {t} ×
            </button>
          ))}
        </div>
        <div className="flex gap-2 mt-1">
          <input
            type="text"
            value={customTag}
            onChange={(e) => setCustomTag(e.target.value)}
            placeholder="Custom tag"
            className={inputCls + " flex-1"}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const t = customTag.trim().toLowerCase().replace(/\s+/g, "_");
              if (t && !tags.includes(t)) setTags([...tags, t]);
              setCustomTag("");
            }}
          >
            Add tag
          </Button>
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={save}>Save</Button>
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
