// client/src/components/pantry/PantryCard.tsx
import { Refrigerator, Snowflake, BookMarked, Package } from "lucide-react";
import type { PantryCard as PantryCardData } from "../../api/pantry";
import Pill from "../ui/Pill";
import { formatQuantity } from "../../lib/formatQuantity";

const LOC_ICON: Record<string, typeof Refrigerator> = {
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

interface Props {
  card: PantryCardData;
  onOpen: (card: PantryCardData) => void;
}

function dominantLocation(card: PantryCardData): "fridge" | "freezer" | "pantry" | "mixed" {
  const counts = new Map<string, number>();
  for (const b of card.batches) counts.set(b.location, (counts.get(b.location) ?? 0) + 1);
  if (counts.size > 1) return "mixed";
  const [loc] = counts.keys();
  return (loc as any) ?? "pantry";
}

export default function PantryCard({ card, onOpen }: Props) {
  const loc = dominantLocation(card);
  const Icon = loc === "mixed" ? Package : LOC_ICON[loc];
  const days = card.nextExpirationDays;

  return (
    <button
      onClick={() => onOpen(card)}
      className="text-left bg-surface-1 border border-line rounded-[14px] p-4 hover:border-accent-line transition flex flex-col gap-2"
    >
      <div className="flex items-start gap-2">
        <div className="w-7 h-7 rounded-[8px] bg-accent-soft text-accent-ink grid place-items-center shrink-0">
          <Icon size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-ink-1 truncate capitalize">{card.ingredient.name}</div>
          <div className="text-[11px] text-ink-3">{CATEGORY_LABELS[card.ingredient.category] ?? card.ingredient.category}</div>
        </div>
        <Pill tone="ghost" size="sm">{card.batchCount}</Pill>
      </div>

      <div className="flex items-end justify-between gap-2 mt-1">
        <div className="text-[15px] tabular-nums text-ink-1">{formatTotals(card.totalsByUnit)}</div>
        <div className="flex gap-1.5">
          {card.isLowStock && <Pill tone="warn" size="sm">Low</Pill>}
          {days != null && (
            <Pill tone={days <= 0 ? "danger" : days <= 3 ? "warn" : "ghost"} size="sm">
              {days <= 0 ? "expired" : `${days}d`}
            </Pill>
          )}
          {loc === "mixed" && <Pill tone="ghost" size="sm">Mixed</Pill>}
        </div>
      </div>
    </button>
  );
}


function formatTotals(totals: Array<{ unit: string; qty: number }>) {
  if (totals.length === 0) return <span className="text-ink-3">—</span>;
  return totals.map((t) => `${formatQuantity(t.qty)} ${t.unit}`).join(" · ");
}
