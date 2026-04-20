import { useEffect, useMemo, useState } from "react";
import { RefreshCw, CheckCircle2, Check } from "lucide-react";
import { getPlans, type WeeklyPlan } from "../api/plans";
import {
  generateShoppingList,
  getShoppingList,
  toggleItem,
  type ShoppingItem,
} from "../api/shopping";
import Button from "../components/ui/Button";

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

export default function ShoppingList() {
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    getPlans().then((plans) => {
      const active = plans.find((p) => p.status === "active") ?? plans[0] ?? null;
      setPlan(active);
      if (active) getShoppingList(active.id).then(setItems).catch(() => setItems([]));
    });
  }, []);

  const handleGenerate = async () => {
    if (!plan) return;
    setGenerating(true);
    try {
      setItems(await generateShoppingList(plan.id));
    } finally { setGenerating(false); }
  };

  const handleToggle = async (id: number, checked: boolean) => {
    await toggleItem(id, checked);
    setItems(items.map((i) => i.id === id ? { ...i, checked } : i));
  };

  const toBuy = useMemo(() => items.filter((i) => !i.checked && i.quantityToBuy > 0), [items]);
  const alreadyHave = useMemo(() => items.filter((i) => !i.checked && i.quantityToBuy === 0), [items]);
  const done = useMemo(() => items.filter((i) => i.checked), [items]);

  const monthLabel = plan?.weekStartDate
    ? new Date(plan.weekStartDate + "T00:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric" })
    : null;

  return (
    <div className="flex flex-col gap-7 max-w-[720px]">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          {monthLabel && (
            <div className="text-[12px] uppercase tracking-[0.1em] text-ink-3 mb-1.5">
              Week of {monthLabel} · {toBuy.length} to buy
            </div>
          )}
          <h1 className="text-[26px] sm:text-[30px] font-semibold -tracking-[0.02em] text-ink-1">Shopping List</h1>
        </div>
        {plan && (
          <Button variant="ghost" icon={RefreshCw} onClick={handleGenerate} disabled={generating}>
            {generating ? "Regenerating…" : items.length ? "Regenerate" : "Generate"}
          </Button>
        )}
      </div>

      {!plan && (
        <div className="rounded-[16px] border border-dashed border-line bg-surface-1 p-10 text-center text-ink-2">
          No active plan. Create one in the Planner first.
        </div>
      )}

      {toBuy.length > 0 && (
        <Section title="To buy" count={toBuy.length}>
          {byCategory(toBuy).map(([cat, list]) => (
            <div key={cat}>
              <div className="px-4 sm:px-5 pt-2.5 pb-1 text-[11px] font-semibold text-accent-ink tracking-[0.05em] uppercase">
                {CATEGORY_LABELS[cat] ?? cat}
              </div>
              {list.map((item, i) => (
                <Row key={item.id} item={item} onToggle={handleToggle} last={i === list.length - 1} />
              ))}
            </div>
          ))}
        </Section>
      )}

      {alreadyHave.length > 0 && (
        <div className="bg-accent-soft border border-accent-line rounded-[14px] overflow-hidden">
          <div className="px-4 sm:px-5 py-3 text-[11px] text-accent-ink uppercase tracking-[0.08em] flex items-center gap-1.5 font-semibold">
            <CheckCircle2 size={12} /> Already in pantry · {alreadyHave.length}
          </div>
          {alreadyHave.map((item, i) => (
            <Row key={item.id} item={item} onToggle={handleToggle} last={i === alreadyHave.length - 1} muted />
          ))}
        </div>
      )}

      {done.length > 0 && (
        <div className="opacity-65 bg-surface-1 border border-line rounded-[14px] overflow-hidden">
          <div className="px-4 sm:px-5 py-3 text-[11px] text-ink-3 uppercase tracking-[0.08em]">
            Done · {done.length}
          </div>
          {done.map((item, i) => (
            <Row key={item.id} item={item} onToggle={handleToggle} last={i === done.length - 1} strikethrough />
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="bg-surface-1 border border-line rounded-[14px] overflow-hidden">
      <div className="px-4 sm:px-5 py-3 text-[11px] text-ink-3 uppercase tracking-[0.08em] border-b border-line-soft flex justify-between">
        <span>{title}</span>
        <span>{count} item{count === 1 ? "" : "s"}</span>
      </div>
      {children}
    </div>
  );
}

function Row({
  item, onToggle, last, muted, strikethrough,
}: {
  item: ShoppingItem;
  onToggle: (id: number, checked: boolean) => void;
  last: boolean;
  muted?: boolean;
  strikethrough?: boolean;
}) {
  return (
    <label
      className={`grid grid-cols-[auto_1fr_auto] gap-3 items-center px-4 sm:px-5 py-3 cursor-pointer ${last ? "" : "border-b border-line-soft"}`}
    >
      <span
        className="w-5 h-5 rounded-[6px] grid place-items-center"
        style={{
          border: `1.5px solid ${item.checked ? "var(--accent)" : "var(--ink-3)"}`,
          background: item.checked ? "var(--accent)" : "transparent",
          color: "var(--accent-on)",
        }}
      >
        {item.checked && <Check size={13} strokeWidth={2.5} />}
      </span>
      <input
        type="checkbox"
        checked={item.checked}
        onChange={() => onToggle(item.id, !item.checked)}
        className="hidden"
      />
      <div
        className={`text-[14px] ${muted ? "text-ink-2" : "text-ink-1"}`}
        style={{ textDecoration: strikethrough ? "line-through" : "none" }}
      >
        {item.ingredient.name}
      </div>
      <div className="text-[12.5px] text-ink-3 tabular-nums">
        {item.quantityToBuy > 0 ? `${item.quantityToBuy} ${item.ingredient.defaultUnit ?? ""}` : `Have ${item.quantityNeeded} ${item.ingredient.defaultUnit ?? ""}`}
      </div>
    </label>
  );
}

function byCategory(list: ShoppingItem[]): [string, ShoppingItem[]][] {
  const g: Record<string, ShoppingItem[]> = {};
  for (const i of list) {
    const c = i.ingredient.category ?? "other";
    (g[c] = g[c] ?? []).push(i);
  }
  return Object.entries(g);
}
