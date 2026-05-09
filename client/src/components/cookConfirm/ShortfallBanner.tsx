import { X } from "lucide-react";
import type { DeductShortfall } from "../../api/plans";

interface Props {
  shortfalls: DeductShortfall[];
  onDismiss: () => void;
}

function formatQty(n: number): string {
  if (n === Math.floor(n)) return String(n);
  return n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function lineFor(s: DeductShortfall): string {
  switch (s.reason) {
    case "insufficient":
      return `${s.ingredientName}: needed ${formatQty(s.requestedQuantity)} ${s.requestedUnit}, had ${formatQty(s.availableQuantity)} ${s.requestedUnit}`;
    case "no_density":
      return `${s.ingredientName}: couldn't deduct (no density set for ${s.requestedUnit})`;
    case "no_pantry":
      return `${s.ingredientName}: not in pantry`;
  }
}

export default function ShortfallBanner({ shortfalls, onDismiss }: Props) {
  if (shortfalls.length === 0) return null;
  return (
    <div className="bg-warn-soft border border-warn-line border-l-[3px] border-l-warn-ink rounded-[12px] px-4 py-3.5 mb-4">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="text-[13px] font-semibold text-warn-ink">Marked cooked — pantry came up short</div>
        <button onClick={onDismiss} aria-label="Dismiss" className="text-warn-ink/70 hover:text-warn-ink">
          <X size={14} />
        </button>
      </div>
      <ul className="m-0 p-0 list-none text-[12.5px] text-warn-ink/85">
        {shortfalls.map((s, i) => (
          <li key={i} className="py-0.5">• {lineFor(s)}</li>
        ))}
      </ul>
    </div>
  );
}
