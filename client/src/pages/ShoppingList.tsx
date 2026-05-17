import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RefreshCw, CheckCircle2, Check, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import {
  formatLocalDate,
  getPlans,
  localMidnightFromISO,
  parseWeekParam,
  pickPlanForWeek,
  type WeeklyPlan,
} from "../api/plans";
import {
  generateShoppingList,
  getLowStockSuggestions,
  getShoppingList,
  toggleItem,
  getCustomShoppingItems,
  createCustomShoppingItem,
  updateCustomShoppingItem,
  deleteCustomShoppingItem,
  type LowStockSuggestion,
  type ShoppingItem,
  type CustomShoppingItem,
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

function stepWeek(weekStart: string, deltaDays: number): string {
  const d = localMidnightFromISO(weekStart);
  d.setDate(d.getDate() + deltaDays);
  return formatLocalDate(d);
}

export default function ShoppingList() {
  const [plans, setPlans] = useState<WeeklyPlan[]>([]);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [customItems, setCustomItems] = useState<CustomShoppingItem[]>([]);
  const [generating, setGenerating] = useState(false);
  const [lowStock, setLowStock] = useState<LowStockSuggestion[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();

  // The viewed week is the URL's source of truth. parseWeekParam normalizes
  // mid-week dates, garbage strings, or a missing param to a Sunday in
  // local time.
  const rawWeekParam = searchParams.get("week");
  const viewedWeek = parseWeekParam(rawWeekParam);

  // If the URL was missing or non-canonical, replace it (don't push) so the
  // initial-load redirect doesn't pollute browser history.
  useEffect(() => {
    if (rawWeekParam !== viewedWeek) {
      setSearchParams({ week: viewedWeek }, { replace: true });
    }
  }, [rawWeekParam, viewedWeek, setSearchParams]);

  useEffect(() => {
    getPlans().then(setPlans).catch(() => setPlans([]));
    getLowStockSuggestions().then(setLowStock).catch(() => setLowStock([]));
  }, []);

  const viewedPlan = useMemo(
    () => pickPlanForWeek(plans, viewedWeek),
    [plans, viewedWeek],
  );

  // Refetch items when viewedPlan.id changes (or when it goes from null to
  // non-null on initial plans load).
  useEffect(() => {
    if (!viewedPlan) {
      setItems([]);
      return;
    }
    getShoppingList(viewedPlan.id).then(setItems).catch(() => setItems([]));
  }, [viewedPlan?.id]);

  useEffect(() => {
    if (!viewedPlan) {
      setCustomItems([]);
      return;
    }
    getCustomShoppingItems(viewedPlan.id).then(setCustomItems).catch(() => setCustomItems([]));
  }, [viewedPlan?.id]);

  const todayWeek = useMemo(() => parseWeekParam(null), []);
  const isViewingToday = viewedWeek === todayWeek;
  const isPastWeek = viewedWeek < todayWeek;
  const navigate = useNavigate();

  const goPrevWeek = () => setSearchParams({ week: stepWeek(viewedWeek, -7) });
  const goNextWeek = () => setSearchParams({ week: stepWeek(viewedWeek, +7) });
  const goToday    = () => { if (!isViewingToday) setSearchParams({ week: todayWeek }); };

  const handleGenerate = async () => {
    if (!viewedPlan) return;
    setGenerating(true);
    try {
      setItems(await generateShoppingList(viewedPlan.id));
    } finally { setGenerating(false); }
  };

  const handleToggle = async (id: number, checked: boolean) => {
    if (isPastWeek) return; // past weeks are strictly read-only
    await toggleItem(id, checked);
    setItems(items.map((i) => i.id === id ? { ...i, checked } : i));
  };

  const toBuy = useMemo(() => items.filter((i) => !i.checked && i.quantityToBuy > 0), [items]);
  const alreadyHave = useMemo(() => items.filter((i) => !i.checked && i.quantityToBuy === 0), [items]);
  const done = useMemo(() => items.filter((i) => i.checked), [items]);

  const monthLabel = localMidnightFromISO(viewedWeek)
    .toLocaleDateString(undefined, { month: "long", day: "numeric" });

  return (
    <div className="flex flex-col gap-7 max-w-[720px]">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <button
              onClick={goPrevWeek}
              aria-label="Previous week"
              className="w-7 h-7 grid place-items-center rounded-[8px] text-ink-2 hover:bg-surface-2 hover:text-ink-1"
            >
              <ChevronLeft size={14} />
            </button>
            <div className="text-[12px] uppercase tracking-[0.1em] text-ink-3 select-none">
              Week of {monthLabel}{toBuy.length > 0 ? ` · ${toBuy.length} to buy` : ""}
            </div>
            <button
              onClick={goNextWeek}
              aria-label="Next week"
              className="w-7 h-7 grid place-items-center rounded-[8px] text-ink-2 hover:bg-surface-2 hover:text-ink-1"
            >
              <ChevronRight size={14} />
            </button>
            <button
              onClick={goToday}
              disabled={isViewingToday}
              className="ml-1 px-2 py-1 text-[11px] uppercase tracking-[0.08em] font-semibold rounded-[8px] text-ink-2 hover:bg-surface-2 hover:text-ink-1 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-ink-2"
            >
              Today
            </button>
          </div>
          <h1 className="text-[26px] sm:text-[30px] font-semibold -tracking-[0.02em] text-ink-1">Shopping List</h1>
        </div>
        {viewedPlan && !isPastWeek && items.length > 0 && (
          <Button variant="ghost" icon={RefreshCw} onClick={handleGenerate} disabled={generating}>
            {generating ? "Regenerating…" : "Regenerate"}
          </Button>
        )}
      </div>

      {!viewedPlan ? (
        <NoPlanCard
          isPastWeek={isPastWeek}
          viewedWeek={viewedWeek}
          monthLabel={monthLabel}
          onGoToPlanner={() => navigate(`/planner?week=${viewedWeek}`)}
        />
      ) : items.length === 0 ? (
        <NoListCard
          isPastWeek={isPastWeek}
          generating={generating}
          onGenerate={handleGenerate}
        />
      ) : null}

      {lowStock.length > 0 && (
        <div className="bg-surface-1 border border-line rounded-[14px] overflow-hidden">
          <div className="px-4 sm:px-5 py-3 text-[11px] text-ink-3 uppercase tracking-[0.08em] border-b border-line-soft flex justify-between">
            <span>Running low</span>
            <span>{lowStock.length} item{lowStock.length === 1 ? "" : "s"}</span>
          </div>
          {lowStock.map((s, i) => (
            <div
              key={s.ingredientId}
              className={`grid grid-cols-[1fr_auto] gap-3 items-center px-4 sm:px-5 py-3 ${i < lowStock.length - 1 ? "border-b border-line-soft" : ""}`}
            >
              <div>
                <div className="text-[14px] text-ink-1">{s.name}</div>
                <div className="text-[12px] text-ink-3">
                  currently {s.currentQty % 1 === 0 ? s.currentQty : s.currentQty.toFixed(2)} {s.currentUnit}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* TODO Task 27: wire add when shopping API supports adding a single item by ingredientId */}
                <button
                  className="px-2.5 py-1 text-[11px] font-semibold rounded-[8px] border border-line text-ink-2 hover:bg-surface-2 hover:text-ink-1"
                  onClick={() => {/* no-op: no single-item add endpoint yet */}}
                >
                  + Add to list
                </button>
                <button
                  className="px-2.5 py-1 text-[11px] font-semibold rounded-[8px] text-ink-3 hover:bg-surface-2 hover:text-ink-1"
                  onClick={() => setLowStock((prev) => prev.filter((x) => x.ingredientId !== s.ingredientId))}
                >
                  Hide
                </button>
              </div>
            </div>
          ))}
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
                <Row key={item.id} item={item} onToggle={handleToggle} last={i === list.length - 1} disabled={isPastWeek} />
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
            <Row key={item.id} item={item} onToggle={handleToggle} last={i === alreadyHave.length - 1} muted disabled={isPastWeek} />
          ))}
        </div>
      )}

      {done.length > 0 && (
        <div className="opacity-65 bg-surface-1 border border-line rounded-[14px] overflow-hidden">
          <div className="px-4 sm:px-5 py-3 text-[11px] text-ink-3 uppercase tracking-[0.08em]">
            Done · {done.length}
          </div>
          {done.map((item, i) => (
            <Row key={item.id} item={item} onToggle={handleToggle} last={i === done.length - 1} strikethrough disabled={isPastWeek} />
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
  item, onToggle, last, muted, strikethrough, disabled,
}: {
  item: ShoppingItem;
  onToggle: (id: number, checked: boolean) => void;
  last: boolean;
  muted?: boolean;
  strikethrough?: boolean;
  disabled?: boolean;
}) {
  // When disabled, render a plain <div> so the wrapper isn't clickable.
  // The hidden <input> isn't rendered either — it can't be reached visually
  // and it would be confusing to keep a tabbable disabled checkbox around.
  const Wrapper: any = disabled ? "div" : "label";
  return (
    <Wrapper
      className={`grid grid-cols-[auto_1fr_auto] gap-3 items-center px-4 sm:px-5 py-3 ${disabled ? "cursor-not-allowed opacity-80" : "cursor-pointer"} ${last ? "" : "border-b border-line-soft"}`}
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
      {!disabled && (
        <input
          type="checkbox"
          checked={item.checked}
          onChange={() => onToggle(item.id, !item.checked)}
          className="hidden"
        />
      )}
      <div
        className={`text-[14px] ${muted ? "text-ink-2" : "text-ink-1"}`}
        style={{ textDecoration: strikethrough ? "line-through" : "none" }}
      >
        {item.ingredient.name}
      </div>
      <div className="text-[12.5px] text-ink-3 tabular-nums">
        {item.quantityToBuy > 0 ? `${item.quantityToBuy} ${item.ingredient.defaultUnit ?? ""}` : `Have ${item.quantityNeeded} ${item.ingredient.defaultUnit ?? ""}`}
      </div>
    </Wrapper>
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

function NoPlanCard({
  isPastWeek,
  monthLabel,
  onGoToPlanner,
}: {
  isPastWeek: boolean;
  viewedWeek: string;
  monthLabel: string;
  onGoToPlanner: () => void;
}) {
  if (isPastWeek) {
    return (
      <div className="rounded-[16px] border border-dashed border-line bg-surface-1 p-8 text-center">
        <div className="text-[14px] text-ink-2">No plan recorded for this week.</div>
      </div>
    );
  }
  return (
    <div className="rounded-[16px] border border-dashed border-line bg-surface-1 p-8 text-center flex flex-col items-center gap-3">
      <div className="text-[14px] text-ink-2">No plan for the week of {monthLabel}.</div>
      <Button variant="ghost" onClick={onGoToPlanner}>
        Create one in the Planner →
      </Button>
    </div>
  );
}

function NoListCard({
  isPastWeek,
  generating,
  onGenerate,
}: {
  isPastWeek: boolean;
  generating: boolean;
  onGenerate: () => void;
}) {
  if (isPastWeek) {
    return (
      <div className="rounded-[16px] border border-dashed border-line bg-surface-1 p-8 text-center">
        <div className="text-[14px] text-ink-2">No shopping list for this week.</div>
      </div>
    );
  }
  return (
    <div className="rounded-[16px] border border-dashed border-line bg-surface-1 p-8 text-center flex flex-col items-center gap-3">
      <div className="text-[14px] text-ink-2">No shopping list yet.</div>
      <Button variant="primary" icon={RefreshCw} onClick={onGenerate} disabled={generating}>
        {generating ? "Generating…" : "Generate from this week's plan"}
      </Button>
    </div>
  );
}
