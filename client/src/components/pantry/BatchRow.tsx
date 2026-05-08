// client/src/components/pantry/BatchRow.tsx
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { PantryBatch } from "../../api/pantry";
import Pill from "../ui/Pill";

interface Props {
  batch: PantryBatch;
  onEdit: () => void;
  onDelete: () => void;
}

export default function BatchRow({ batch, onEdit, onDelete }: Props) {
  const exp = batch.expirationDate ? new Date(batch.expirationDate) : null;
  const days = exp ? Math.max(0, Math.ceil((exp.getTime() - Date.now()) / 86400000)) : null;
  const purchase = batch.purchaseDate ? new Date(batch.purchaseDate).toLocaleDateString() : null;
  const cost = batch.costAtPurchase ? `$${parseFloat(batch.costAtPurchase).toFixed(2)}` : null;

  return (
    <div className="bg-surface-2 border border-line-soft rounded-[10px] p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] text-ink-1 tabular-nums">
          {batch.quantity} {batch.unit} · <span className="capitalize">{batch.location}</span>
        </div>
        <div className="flex gap-1.5">
          {days != null && (
            <Pill tone={days <= 0 ? "danger" : days <= 3 ? "warn" : "ghost"} size="sm">
              {days <= 0 ? "expired" : `${days}d`}
            </Pill>
          )}
        </div>
      </div>

      {batch.tags.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {batch.tags.map((t) => (
            <Pill key={t} tone={t === "use_first" ? "warn" : "ghost"} size="sm">
              {t.replace(/_/g, " ")}
            </Pill>
          ))}
        </div>
      )}

      {(purchase || cost) && (
        <div className="text-[11px] text-ink-3">
          {purchase && `Bought ${purchase}`}{purchase && cost ? " · " : ""}{cost}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button onClick={onEdit} className="text-[11px] text-accent flex items-center gap-1 hover:underline">
          <Pencil size={11} /> Edit
        </button>
        <button onClick={onDelete} className="text-[11px] text-danger flex items-center gap-1 hover:underline">
          <Trash2 size={11} /> Delete
        </button>
      </div>
    </div>
  );
}
