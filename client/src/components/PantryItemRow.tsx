import { useState } from "react";
import type { PantryItem } from "../api/pantry";

interface Props {
  item: PantryItem;
  onUpdate: (id: number, data: any) => void;
  onDelete: (id: number) => void;
}

export default function PantryItemRow({ item, onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(item.quantity);

  const locationColors: Record<string, string> = {
    fridge: "bg-blue-100 text-blue-700",
    freezer: "bg-cyan-100 text-cyan-700",
    pantry: "bg-amber-100 text-amber-700",
  };

  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100">
      <div className="flex items-center gap-3">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${locationColors[item.location] || "bg-gray-100 text-gray-600"}`}>
          {item.location}
        </span>
        <span className="text-sm font-medium text-gray-900">{item.ingredient.name}</span>
      </div>
      <div className="flex items-center gap-3">
        {editing ? (
          <div className="flex items-center gap-2">
            <input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))}
              className="w-20 rounded border border-gray-300 px-2 py-1 text-sm" min={0} step={0.1} />
            <button onClick={() => { onUpdate(item.id, { quantity: qty }); setEditing(false); }}
              className="text-xs text-blue-600 hover:underline">Save</button>
            <button onClick={() => setEditing(false)} className="text-xs text-gray-400 hover:underline">Cancel</button>
          </div>
        ) : (
          <>
            <span className="text-sm text-gray-600">{item.quantity} {item.unit}</span>
            <button onClick={() => setEditing(true)} className="text-xs text-blue-600 hover:underline">Edit</button>
            <button onClick={() => onDelete(item.id)} className="text-xs text-red-500 hover:underline">Remove</button>
          </>
        )}
      </div>
    </div>
  );
}
