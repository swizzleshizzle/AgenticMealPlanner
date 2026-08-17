import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatQuantity } from "../lib/formatQuantity";
import { coverageLabel } from "../lib/coverageLabel";
import { purchaseLabel } from "../lib/purchaseLabel";
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
  const [staples, setStaples] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [lowStock, setLowStock] = useState<LowStockSuggestion[]>([]);
  const [draftName, setDraftName] = useState("");
  const [draftQty, setDraftQty] = useState("");
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

  // Which plan the current `items` / `customItems` state belongs to. Rendering
  // is gated on these matching the viewed plan, so switching weeks can never
  // show the old week's list under the new week's header, and a slow response
  // for a week the user already left is dropped instead of clobbering the view.
  const [loadedPlanId, setLoadedPlanId] = useState<number | null>(null);
  const [customLoadedPlanId, setCustomLoadedPlanId] = useState<number | null>(null);

  // Refetch items when viewedPlan.id changes (or when it goes from null to
  // non-null on initial plans load).
  useEffect(() => {
    if (!viewedPlan) {
      setItems([]);
      setStaples([]);
      setLoadedPlanId(null);
      return;
    }
    const planId = viewedPlan.id;
    let stale = false;
    getShoppingList(planId)
      .then((r) => { if (stale) return; setItems(r.items); setStaples(r.staples); setLoadedPlanId(planId); })
      .catch(() => { if (stale) return; setItems([]); setStaples([]); setLoadedPlanId(planId); });
    return () => { stale = true; };
  }, [viewedPlan?.id]);

  useEffect(() => {
    if (!viewedPlan) {
      setCustomItems([]);
      setCustomLoadedPlanId(null);
      return;
    }
    const planId = viewedPlan.id;
    let stale = false;
    getCustomShoppingItems(planId)
      .then((r) => { if (stale) return; setCustomItems(r); setCustomLoadedPlanId(planId); })
      .catch(() => { if (stale) return; setCustomItems([]); setCustomLoadedPlanId(planId); });
    return () => { stale = true; };
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
      const r = await generateShoppingList(viewedPlan.id);
      setItems(r.items);
      setStaples(r.staples);
      setLoadedPlanId(viewedPlan.id);
    } finally { setGenerating(false); }
  };

  const handleToggle = async (id: number, checked: boolean) => {
    if (isPastWeek) return; // past weeks are strictly read-only
    await toggleItem(id, checked);
    setItems(items.map((i) => i.id === id ? { ...i, checked } : i));
  };

  const handleToggleCustom = async (id: number, checked: boolean) => {
    if (isPastWeek) return;
    const prev = customItems;
    setCustomItems(customItems.map((i) => i.id === id ? { ...i, checked } : i));
    try {
      await updateCustomShoppingItem(id, { checked });
    } catch {
      setCustomItems(prev);
    }
  };

  const handleDeleteCustom = async (id: number) => {
    if (isPastWeek) return;
    const prev = customItems;
    setCustomItems(customItems.filter((i) => i.id !== id));
    try {
      await deleteCustomShoppingItem(id);
    } catch {
      setCustomItems(prev);
    }
  };

  // Low-stock suggestions land on the list as custom items — they survive the
  // live recompute by design (a manual shopping_items row would be deleted the
  // next time the list reconciles against the plan's needs).
  const handleAddLowStock = async (s: LowStockSuggestion) => {
    if (!viewedPlan || isPastWeek) return;
    const topUp =
      s.threshold != null && s.thresholdUnit && s.thresholdUnit === s.currentUnit && s.threshold > s.currentQty
        ? `${formatQuantity(s.threshold - s.currentQty)} ${s.thresholdUnit}`
        : undefined;
    const created = await createCustomShoppingItem(viewedPlan.id, { name: s.name, qtyText: topUp });
    setCustomItems((prev) => [...prev, created]);
    setLowStock((prev) => prev.filter((x) => x.ingredientId !== s.ingredientId));
  };

  const handleAddCustom = async () => {
    const name = draftName.trim();
    if (!name || !viewedPlan || isPastWeek) return;
    const qtyText = draftQty.trim();
    const optimisticId = -Date.now(); // negative id so it can't collide with real ones
    const optimistic: CustomShoppingItem = {
      id: optimisticId,
      planId: viewedPlan.id,
      name,
      qtyText: qtyText || null,
      checked: false,
      createdAt: new Date().toISOString(),
    };
    setCustomItems([...customItems, optimistic]);
    setDraftName("");
    setDraftQty("");
    try {
      const created = await createCustomShoppingItem(viewedPlan.id, { name, qtyText: qtyText || undefined });
      setCustomItems((prev) => prev.map((i) => i.id === optimisticId ? created : i));
    } catch {
      setCustomItems((prev) => prev.filter((i) => i.id !== optimisticId));
    }
  };

  // Only render list state that belongs to the viewed plan — while a week's
  // fetch is in flight, its sections show as loading rather than the previous
  // week's data.
  const listLoaded = viewedPlan != null && loadedPlanId === viewedPlan.id;
  const visibleItems = useMemo(() => (listLoaded ? items : []), [listLoaded, items]);
  const visibleStaples = listLoaded ? staples : [];
  const visibleCustomItems = useMemo(
    () => (viewedPlan != null && customLoadedPlanId === viewedPlan.id ? customItems : []),
    [viewedPlan?.id, customLoadedPlanId, customItems],
  );

  // Estimate rows (need === 0) are unconvertible-unit items — show them under
  // "To buy" with a "qty?" hint rather than as "Have 0".
  const toBuy = useMemo(
    () => visibleItems.filter((i) => !i.checked && (i.quantityToBuy > 0 || i.quantityNeeded === 0)),
    [visibleItems],
  );
  const alreadyHave = useMemo(
    () => visibleItems.filter((i) => !i.checked && i.quantityToBuy === 0 && i.quantityNeeded > 0),
    [visibleItems],
  );
  const done = useMemo(() => visibleItems.filter((i) => i.checked), [visibleItems]);

  const customToBuy = useMemo(() => visibleCustomItems.filter((i) => !i.checked), [visibleCustomItems]);
  const customDone = useMemo(() => visibleCustomItems.filter((i) =>  i.checked), [visibleCustomItems]);

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
              {(() => {
                const total = toBuy.length + customToBuy.length;
                return `Week of ${monthLabel}${total > 0 ? ` · ${total} to buy` : ""}`;
              })()}
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
        {/* Regenerate button removed: the list now recomputes live on every load. */}
      </div>

      {!viewedPlan ? (
        <NoPlanCard
          isPastWeek={isPastWeek}
          viewedWeek={viewedWeek}
          monthLabel={monthLabel}
          onGoToPlanner={() => navigate(`/planner?week=${viewedWeek}`)}
        />
      ) : !listLoaded ? (
        <div className="bg-surface-1 border border-line rounded-[14px] px-4 sm:px-5 py-5 text-[13px] text-ink-3">
          Loading week…
        </div>
      ) : visibleItems.length === 0 ? (
        <NoListCard
          isPastWeek={isPastWeek}
          generating={generating}
          onGenerate={handleGenerate}
          compact={visibleCustomItems.length > 0 || !isPastWeek}
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
                <button
                  className="px-2.5 py-1 text-[11px] font-semibold rounded-[8px] border border-line text-ink-2 hover:bg-surface-2 hover:text-ink-1 disabled:opacity-40 disabled:cursor-default"
                  disabled={!viewedPlan || isPastWeek}
                  onClick={() => handleAddLowStock(s)}
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

      {listLoaded && (toBuy.length > 0 || customToBuy.length > 0 || !isPastWeek) && (
        <Section title="To buy" count={toBuy.length + customToBuy.length}>
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
          <div>
            <div className="px-4 sm:px-5 pt-2.5 pb-1 text-[11px] font-semibold text-accent-ink tracking-[0.05em] uppercase">
              Extras
            </div>
            {customToBuy.map((item, i) => (
              <CustomRow
                key={item.id}
                item={item}
                onToggle={handleToggleCustom}
                onDelete={handleDeleteCustom}
                last={i === customToBuy.length - 1 && isPastWeek}
                disabled={isPastWeek}
              />
            ))}
            {!isPastWeek && (
              <div className="grid grid-cols-[auto_1fr_auto_auto] gap-3 items-center px-4 sm:px-5 py-3">
                <span className="w-5 h-5" aria-hidden />
                <input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddCustom(); }}
                  maxLength={200}
                  placeholder="Add an item (e.g. toilet paper)"
                  className="text-[14px] bg-transparent outline-none text-ink-1 placeholder:text-ink-3"
                />
                <input
                  type="text"
                  value={draftQty}
                  onChange={(e) => setDraftQty(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddCustom(); }}
                  maxLength={50}
                  placeholder="Qty"
                  className="text-[12.5px] bg-transparent outline-none text-ink-3 placeholder:text-ink-3 text-right tabular-nums w-20"
                />
                <button
                  type="button"
                  onClick={handleAddCustom}
                  disabled={draftName.trim().length === 0}
                  aria-label="Add item"
                  className="w-6 h-6 grid place-items-center rounded-[6px] text-ink-3 hover:bg-surface-2 hover:text-ink-1 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-default"
                >
                  <Plus size={14} />
                </button>
              </div>
            )}
          </div>
        </Section>
      )}

      {visibleStaples.length > 0 && (
        <details className="bg-surface-1 border border-line rounded-[14px] overflow-hidden">
          <summary className="cursor-pointer list-none px-4 sm:px-5 py-3 text-[11px] text-ink-3 uppercase tracking-[0.08em] flex justify-between">
            <span>Season to taste</span>
            <span>{visibleStaples.length} item{visibleStaples.length === 1 ? "" : "s"}</span>
          </summary>
          <div className="px-4 sm:px-5 pb-3 text-[13px] text-ink-2">
            {visibleStaples.join(", ")}
          </div>
        </details>
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

      {(done.length + customDone.length) > 0 && (
        <div className="opacity-65 bg-surface-1 border border-line rounded-[14px] overflow-hidden">
          <div className="px-4 sm:px-5 py-3 text-[11px] text-ink-3 uppercase tracking-[0.08em]">
            Done · {done.length + customDone.length}
          </div>
          {done.map((item, i) => (
            <Row
              key={`g-${item.id}`}
              item={item}
              onToggle={handleToggle}
              last={i === done.length - 1 && customDone.length === 0}
              strikethrough
              disabled={isPastWeek}
            />
          ))}
          {customDone.map((item, i) => (
            <CustomRow
              key={`c-${item.id}`}
              item={item}
              onToggle={handleToggleCustom}
              onDelete={handleDeleteCustom}
              last={i === customDone.length - 1}
              strikethrough
              disabled={isPastWeek}
            />
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
      <div className="text-[12.5px] text-ink-3 tabular-nums text-right">
        {(() => {
          if (item.quantityNeeded === 0) return "qty?";
          if (item.quantityToBuy <= 0) {
            return coverageLabel(item.quantityNeeded, item.quantityOnHand, item.ingredient.defaultUnit ?? "");
          }
          // Speak "store" when the ingredient knows how it's sold: packs and
          // bunches up front, the precise recipe amount as fine print.
          const retail = purchaseLabel(item.quantityToBuy, item.ingredient.defaultUnit ?? "", item.ingredient);
          if (retail) {
            return (
              <>
                <div className="text-ink-1">{retail.main}</div>
                <div className="text-[11px]">{retail.detail}</div>
              </>
            );
          }
          return `${formatQuantity(item.quantityToBuy)} ${item.ingredient.defaultUnit ?? ""}`;
        })()}
        {item.partial && item.quantityNeeded > 0 && (
          <div className="text-[11px] text-ink-3 italic">units differ — check pantry first</div>
        )}
      </div>
    </Wrapper>
  );
}

function CustomRow({
  item, onToggle, onDelete, last, strikethrough, disabled,
}: {
  item: CustomShoppingItem;
  onToggle: (id: number, checked: boolean) => void;
  onDelete: (id: number) => void;
  last: boolean;
  strikethrough?: boolean;
  disabled?: boolean;
}) {
  const Wrapper: any = disabled ? "div" : "label";
  return (
    <Wrapper
      className={`group grid grid-cols-[auto_1fr_auto_auto] gap-3 items-center px-4 sm:px-5 py-3 ${disabled ? "cursor-not-allowed opacity-80" : "cursor-pointer"} ${last ? "" : "border-b border-line-soft"}`}
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
        className="text-[14px] text-ink-1"
        style={{ textDecoration: strikethrough ? "line-through" : "none" }}
      >
        {item.name}
      </div>
      <div className="text-[12.5px] text-ink-3 tabular-nums">
        {item.qtyText ?? ""}
      </div>
      {!disabled && !strikethrough ? (
        <button
          type="button"
          aria-label={`Delete ${item.name}`}
          onClick={(e) => { e.preventDefault(); onDelete(item.id); }}
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 w-6 h-6 grid place-items-center rounded-[6px] text-ink-3 hover:bg-surface-2 hover:text-ink-1 transition-opacity"
        >
          <X size={13} />
        </button>
      ) : <span />}
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
  compact,
}: {
  isPastWeek: boolean;
  generating: boolean;
  onGenerate: () => void;
  compact?: boolean;
}) {
  if (isPastWeek) {
    return (
      <div className="rounded-[16px] border border-dashed border-line bg-surface-1 p-8 text-center">
        <div className="text-[14px] text-ink-2">No shopping list for this week.</div>
      </div>
    );
  }
  if (compact) {
    return (
      <div className="rounded-[14px] border border-dashed border-line bg-surface-1 p-4 flex items-center justify-between gap-3">
        <div className="text-[13px] text-ink-2">No generated list yet.</div>
        <Button variant="ghost" icon={RefreshCw} onClick={onGenerate} disabled={generating}>
          {generating ? "Generating…" : "Generate from this week's plan"}
        </Button>
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
