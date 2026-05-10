import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Sparkles,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Flame,
  Leaf,
  Refrigerator,
  Plus,
  Check,
  Search,
  X,
  Trash2,
  Replace,
  Minus,
  ExternalLink,
} from "lucide-react";
import {
  addPlannedMeal,
  createPlan,
  formatLocalDate,
  generatePlan,
  getPlans,
  localMidnightFromISO,
  parseWeekParam,
  pickPlanForWeek,
  removePlannedMeal,
  updatePlan,
  updatePlannedMeal,
  type WeeklyPlan,
  type PlannedMeal,
} from "../api/plans";
import { getMeals, type Meal } from "../api/meals";
import { syncCalendar } from "../api/calendar";
import Pill from "../components/ui/Pill";
import Button from "../components/ui/Button";
import PhotoTile from "../components/ui/PhotoTile";
import { toneForMeal } from "../theme/photoTone";
import { useCookConfirm } from "../components/cookConfirm/CookConfirmProvider";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const DAY_LABELS: Record<string, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed",
  thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun",
};

function todayKey(): string {
  return DAYS[new Date().getDay()];
}

function dayDate(weekStart: string, dayKey: string): number {
  const start = localMidnightFromISO(weekStart);
  start.setDate(start.getDate() + DAYS.indexOf(dayKey as typeof DAYS[number]));
  return start.getDate();
}

function stepWeek(weekStart: string, deltaDays: number): string {
  const d = localMidnightFromISO(weekStart);
  d.setDate(d.getDate() + deltaDays);
  return formatLocalDate(d);
}

type Slot = "lunch" | "dinner";
type DayKey = typeof DAYS[number];
type PickerCtx =
  | { mode: "add"; day: DayKey; slot: Slot }
  | { mode: "swap"; day: DayKey; slot: Slot; plannedId: number };

export default function Planner() {
  const [plans, setPlans] = useState<WeeklyPlan[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [picker, setPicker] = useState<PickerCtx | null>(null);
  const [editing, setEditing] = useState<PlannedMeal | null>(null);
  const [generating, setGenerating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { openForMeal } = useCookConfirm();

  // The viewed week is the URL's source of truth. parseWeekParam normalizes
  // anything weird (mid-week dates, garbage strings, missing param) to the
  // Monday of the relevant calendar week.
  const rawWeekParam = searchParams.get("week");
  const viewedWeek = parseWeekParam(rawWeekParam);

  // If the URL was missing or non-canonical, replace it (don't push) so the
  // user's browser history doesn't get cluttered with redirects on first
  // load.
  useEffect(() => {
    if (rawWeekParam !== viewedWeek) {
      setSearchParams({ week: viewedWeek }, { replace: true });
    }
  }, [rawWeekParam, viewedWeek, setSearchParams]);

  const loadPlans = () => getPlans().then(setPlans).catch(() => setPlans([]));

  useEffect(() => {
    loadPlans();
    getMeals().then(setMeals).catch(() => setMeals([]));
    const onDone = () => { loadPlans(); };
    window.addEventListener("cookconfirm:done", onDone);
    return () => window.removeEventListener("cookconfirm:done", onDone);
  }, []);

  const viewedPlan = useMemo(
    () => pickPlanForWeek(plans, viewedWeek),
    [plans, viewedWeek],
  );

  const weekDuplicates = useMemo(
    () => plans.filter((p) => p.weekStartDate.slice(0, 10) === viewedWeek),
    [plans, viewedWeek],
  );

  // Track which duplicate is currently in view. Defaults to the same one
  // pickPlanForWeek picks; clicking the switcher cycles forward.
  const [duplicateIndex, setDuplicateIndex] = useState(0);

  // When the viewed week changes, reset the duplicate cursor.
  useEffect(() => {
    setDuplicateIndex(0);
  }, [viewedWeek]);

  // Override the viewedPlan derivation when there are duplicates and the
  // user has rotated past the first one. We sort the duplicates the same
  // way pickPlanForWeek does (drafts first, then by id).
  const sortedDuplicates = useMemo(() => {
    const drafts = weekDuplicates.filter((p) => p.status === "draft").sort((a, b) => a.id - b.id);
    const others = weekDuplicates.filter((p) => p.status !== "draft").sort((a, b) => a.id - b.id);
    return [...drafts, ...others];
  }, [weekDuplicates]);

  const effectiveViewedPlan =
    sortedDuplicates.length > 1
      ? sortedDuplicates[duplicateIndex % sortedDuplicates.length]
      : viewedPlan;

  const todayWeek = useMemo(() => parseWeekParam(null), []);
  const isViewingToday = viewedWeek === todayWeek;
  const isPastWeek = viewedWeek < todayWeek;

  const goPrevWeek = () => setSearchParams({ week: stepWeek(viewedWeek, -7) });
  const goNextWeek = () => setSearchParams({ week: stepWeek(viewedWeek, +7) });
  const goToday    = () => { if (!isViewingToday) setSearchParams({ week: todayWeek }); };

  const handlePick = async (mealId: number) => {
    if (!effectiveViewedPlan || !picker) return;
    const meal = meals.find((m) => m.id === mealId);
    if (picker.mode === "add") {
      const canBatchHere = picker.day === "sunday" && !!meal?.canBatch;
      const planned = await addPlannedMeal(effectiveViewedPlan.id, {
        mealId,
        day: picker.day,
        mealSlot: picker.slot,
        servings: meal?.servings ?? 2,
        cookStyle: canBatchHere ? "batch_prep" : "cook_fresh",
      });
      setPlans((prev) =>
        prev.map((p) =>
          p.id === effectiveViewedPlan.id
            ? { ...p, plannedMeals: [...p.plannedMeals, planned as PlannedMeal] }
            : p,
        ),
      );
    } else {
      const updated = await updatePlannedMeal(effectiveViewedPlan.id, picker.plannedId, { mealId });
      setPlans((prev) =>
        prev.map((p) =>
          p.id === effectiveViewedPlan.id
            ? { ...p, plannedMeals: p.plannedMeals.map((pm) => (pm.id === updated.id ? updated : pm)) }
            : p,
        ),
      );
      if (editing?.id === updated.id) setEditing(updated);
    }
    setPicker(null);
  };

  const updatePm = async (pm: PlannedMeal, patch: Partial<PlannedMeal>) => {
    if (!effectiveViewedPlan) return;
    const updated = await updatePlannedMeal(effectiveViewedPlan.id, pm.id, patch);
    setPlans((prev) =>
      prev.map((p) =>
        p.id === effectiveViewedPlan.id
          ? { ...p, plannedMeals: p.plannedMeals.map((x) => (x.id === updated.id ? updated : x)) }
          : p,
      ),
    );
    if (editing?.id === updated.id) setEditing(updated);
  };

  const removePm = async (pm: PlannedMeal) => {
    if (!effectiveViewedPlan) return;
    await removePlannedMeal(effectiveViewedPlan.id, pm.id);
    setPlans((prev) =>
      prev.map((p) =>
        p.id === effectiveViewedPlan.id
          ? { ...p, plannedMeals: p.plannedMeals.filter((x) => x.id !== pm.id) }
          : p,
      ),
    );
    if (editing?.id === pm.id) setEditing(null);
  };

  const handleNew = async () => {
    const next = await createPlan(viewedWeek);
    setPlans((prev) => [...prev, next]);
  };

  const handleGenerate = async () => {
    if (!effectiveViewedPlan) return;
    setGenerating(true);
    try {
      const updated = await generatePlan(effectiveViewedPlan.id);
      setPlans((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } finally { setGenerating(false); }
  };

  const handleActivate = async () => {
    if (!effectiveViewedPlan) return;
    const updated = await updatePlan(effectiveViewedPlan.id, { status: "active" });
    setPlans((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const handleSync = async () => {
    if (!effectiveViewedPlan) return;
    setSyncing(true);
    try { await syncCalendar(effectiveViewedPlan.id); } finally { setSyncing(false); }
  };

  const today = isViewingToday ? todayKey() : null;

  const weekStart = viewedWeek;
  const startObj = localMidnightFromISO(weekStart);
  const monthLabel = startObj.toLocaleDateString(undefined, { month: "long", day: "numeric" });

  const summary = useMemo(() => {
    if (!effectiveViewedPlan) return null;
    const active = effectiveViewedPlan.plannedMeals.filter((m) => m.status !== "skipped");
    const prep = active.filter((m) => m.cookStyle === "batch_prep").length;
    const fresh = active.filter((m) => m.cookStyle === "cook_fresh").length;
    const leftover = active.filter((m) => m.cookStyle === "leftovers").length;
    let totalProtein = 0, count = 0;
    for (const pm of active) {
      const scale = pm.servings / (pm.meal.servings || 1);
      if (pm.meal.proteinG) {
        totalProtein += pm.meal.proteinG * scale;
        count += 1;
      }
    }
    const avgProtein = count > 0 ? Math.round(totalProtein / count) : 0;
    return { prep, fresh, leftover, avgProtein };
  }, [effectiveViewedPlan]);

  return (
    <div className="flex flex-col gap-7">
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
              Week of {monthLabel}
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
          <h1 className="text-[26px] sm:text-[30px] font-semibold -tracking-[0.02em] text-ink-1">
            Weekly Planner
          </h1>
        </div>
        <div className="flex gap-2.5 items-center flex-wrap">
          {effectiveViewedPlan && (
            <Pill tone={effectiveViewedPlan.status === "active" ? "accent" : effectiveViewedPlan.status === "draft" ? "warn" : "neutral"} size="md">
              {effectiveViewedPlan.status === "active" ? <Check size={11} /> : null}
              {effectiveViewedPlan.status === "active" ? "Active plan" : effectiveViewedPlan.status === "draft" ? "Draft" : effectiveViewedPlan.status}
            </Pill>
          )}
          {effectiveViewedPlan?.status === "draft" && (
            <>
              <Button variant="ghost" icon={Sparkles} onClick={handleGenerate} disabled={generating}>
                {generating ? "Generating…" : "Auto-generate"}
              </Button>
              <Button variant="primary" onClick={handleActivate}>Confirm plan</Button>
            </>
          )}
          {effectiveViewedPlan?.status === "active" && (
            <Button variant="primary" icon={CalendarDays} onClick={handleSync} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync to Calendar"}
            </Button>
          )}
        </div>
      </div>

      {sortedDuplicates.length > 1 && (
        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] bg-warn-soft border border-warn-line text-warn-ink text-[12.5px]">
          <span>
            Showing <span className="font-semibold capitalize">{effectiveViewedPlan?.status}</span>.
            +{sortedDuplicates.length - 1} other plan{sortedDuplicates.length - 1 === 1 ? "" : "s"} for this week.
          </span>
          <button
            onClick={() => {
              setDuplicateIndex((i) => (i + 1) % sortedDuplicates.length);
              setEditing(null);
              setPicker(null);
            }}
            aria-label={`Switch to next plan for this week (showing ${(duplicateIndex % sortedDuplicates.length) + 1} of ${sortedDuplicates.length})`}
            className="ml-auto text-[12.5px] font-semibold underline hover:no-underline"
          >
            Switch
          </button>
        </div>
      )}

      {!effectiveViewedPlan ? (
        <>
          <EmptyWeekCard
            isPastWeek={isPastWeek}
            weekLabel={monthLabel}
            onCreate={handleNew}
          />
          <EmptyWeekGrid weekStart={weekStart} today={today} />
        </>
      ) : (
        <>
          {/* mobile: horizontal scrollable strip; desktop: 7-col grid */}
          <div className="lg:grid lg:grid-cols-7 lg:gap-3 flex gap-3 overflow-x-auto amp-no-scrollbar -mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 snap-x snap-mandatory">
            {DAYS.map((day) => {
              const meals = effectiveViewedPlan.plannedMeals.filter((m) => m.day === day);
              const isToday = day === today;
              return (
                <div
                  key={day}
                  className={`snap-start shrink-0 w-[72%] sm:w-[44%] lg:w-auto bg-surface-1 rounded-[14px] p-3 flex flex-col gap-2.5 min-h-[280px] border ${
                    isToday ? "border-accent shadow-[0_0_0_3px_var(--accent-soft)]" : "border-line"
                  }`}
                >
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className={`text-[11px] uppercase tracking-[0.08em] font-semibold ${isToday ? "text-accent-ink" : "text-ink-3"}`}>
                        {DAY_LABELS[day]}
                      </div>
                      <div className="text-[20px] font-semibold text-ink-1 -tracking-[0.02em] mt-px">
                        {dayDate(weekStart, day)}
                      </div>
                    </div>
                    {isToday && <Pill tone="accent" size="sm">Today</Pill>}
                  </div>

                  {(["lunch", "dinner"] as const).map((slot) => {
                    const pm = meals.find((m) => m.mealSlot === slot);
                    return (
                      <div key={slot} className="flex flex-col gap-1">
                        <div className="text-[10px] uppercase tracking-[0.08em] text-ink-3">{slot}</div>
                        {pm ? (
                          <button
                            onClick={() => setEditing(pm)}
                            className={`block text-left rounded-[10px] p-2 transition border ${
                              pm.status === "cooked"
                                ? "bg-accent-soft border-accent-line"
                                : pm.status === "skipped"
                                ? "bg-surface-2 border-line-soft opacity-60"
                                : "bg-surface-2 border-line-soft hover:border-line"
                            }`}
                          >
                            <div className="mb-1.5 aspect-[16/9] rounded-[6px] overflow-hidden">
                              {pm.meal.imagePath ? (
                                <img
                                  src={`/media/meals/${pm.meal.id}/thumb.jpg`}
                                  alt={pm.meal.name}
                                  className="w-full h-full object-cover"
                                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                />
                              ) : (
                                <PhotoTile tone={toneForMeal(pm.meal)} aspect="16 / 9" round={6} compact />
                              )}
                            </div>
                            <div className="text-[12.5px] font-semibold text-ink-1 leading-tight line-clamp-2">
                              {pm.meal.name}
                            </div>
                            <div className="flex items-center gap-1 mt-1 text-[10.5px] text-ink-3">
                              {pm.cookStyle === "batch_prep" && <><Flame size={10} /> Prep</>}
                              {pm.cookStyle === "cook_fresh" && <><Leaf size={10} /> Fresh</>}
                              {pm.cookStyle === "leftovers"  && <><Refrigerator size={10} /> Leftovers</>}
                              <span>·</span><span>{pm.servings}×</span>
                              {pm.status === "cooked" && (
                                <>
                                  <span>·</span>
                                  <span className="text-accent-ink font-semibold">Cooked</span>
                                </>
                              )}
                              {pm.status === "skipped" && (
                                <>
                                  <span>·</span>
                                  <span className="text-ink-3 font-semibold">Skipped</span>
                                </>
                              )}
                            </div>
                          </button>
                        ) : (
                          <button
                            onClick={() => setPicker({ mode: "add", day, slot })}
                            className="flex items-center justify-center gap-1.5 border border-dashed border-line rounded-[10px] py-4 text-[11.5px] text-ink-3 hover:bg-surface-2 hover:border-line transition"
                          >
                            <Plus size={12} /> Add
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {summary && (
            <div className="flex items-center gap-3.5 p-3.5 pl-4 bg-surface-1 border border-line rounded-[14px] flex-wrap sm:flex-nowrap">
              <div className="w-9 h-9 rounded-[10px] bg-accent-soft text-accent-ink grid place-items-center flex-shrink-0">
                <Sparkles size={17} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold text-ink-1">
                  Plan looks balanced — {summary.prep} batch-prep session{summary.prep !== 1 ? "s" : ""}, {summary.fresh} fresh cook{summary.fresh !== 1 ? "s" : ""}{summary.leftover > 0 ? `, ${summary.leftover} leftover meal${summary.leftover !== 1 ? "s" : ""}` : ""}{summary.avgProtein > 0 ? `, ${summary.avgProtein}g avg protein per meal` : ""}.
                </div>
                <div className="text-[12px] text-ink-3 mt-0.5">
                  Adjust anything from chat, or sync to your calendar when ready.
                </div>
              </div>
              <Button variant="soft" size="sm" onClick={() => navigate("/chat")}>
                Adjust via chat
              </Button>
            </div>
          )}
        </>
      )}

      {picker && (
        <MealPickerModal
          day={picker.day}
          slot={picker.slot}
          mode={picker.mode}
          meals={meals}
          onPick={handlePick}
          onClose={() => setPicker(null)}
        />
      )}

      {editing && (
        <PlannedMealEditModal
          pm={editing}
          onChange={(patch) => updatePm(editing, patch)}
          onSwap={() => setPicker({ mode: "swap", day: editing.day as DayKey, slot: editing.mealSlot as Slot, plannedId: editing.id })}
          onRemove={() => removePm(editing)}
          onOpenRecipe={() => navigate(`/recipes/${editing.meal.id}`)}
          onClose={() => setEditing(null)}
          onCookedRequested={() => {
            if (!effectiveViewedPlan) return;
            const pm = editing;
            setEditing(null);
            openForMeal(effectiveViewedPlan.id, pm.id);
          }}
        />
      )}
    </div>
  );
}

function MealPickerModal({
  day, slot, mode, meals, onPick, onClose,
}: {
  day: DayKey;
  slot: Slot;
  mode: "add" | "swap";
  meals: Meal[];
  onPick: (mealId: number) => Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return meals;
    return meals.filter((m) =>
      m.name.toLowerCase().includes(q) ||
      m.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [meals, query]);

  const slotLabel = slot === "lunch" ? "lunch" : "dinner";
  const dayLabel = DAY_LABELS[day];

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8 amp-fade-in"
      style={{ background: "rgba(30, 22, 10, 0.55)", backdropFilter: "blur(4px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-1 rounded-[16px] w-full max-w-[640px] max-h-[80vh] flex flex-col overflow-hidden border border-line"
        style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
      >
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-line-soft">
          <div className="w-8 h-8 rounded-[8px] bg-accent-soft text-accent-ink grid place-items-center">
            {mode === "swap" ? <Replace size={16} /> : <Plus size={16} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-ink-1">
              {mode === "swap" ? "Swap recipe" : "Add a recipe"}
            </div>
            <div className="text-[11px] text-ink-3">For {dayLabel} {slotLabel}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 grid place-items-center rounded-[8px] text-ink-2 hover:bg-surface-2"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 sm:px-5 py-3 border-b border-line-soft">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search recipes…"
              className="w-full pl-9 pr-3 py-2 text-[13.5px] bg-surface-2 border border-line rounded-[10px] text-ink-1 placeholder:text-ink-3 focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 sm:p-3">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-[13px] text-ink-3">No recipes match.</div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {filtered.map((m) => {
                const tone = toneForMeal(m);
                const busy = busyId === m.id;
                return (
                  <li key={m.id}>
                    <button
                      disabled={busy || busyId !== null}
                      onClick={async () => {
                        setBusyId(m.id);
                        try { await onPick(m.id); } catch (e: any) { alert(e.message); }
                        finally { setBusyId(null); }
                      }}
                      className="w-full flex items-center gap-3 p-2 rounded-[10px] text-left hover:bg-surface-2 disabled:opacity-60 disabled:cursor-wait transition border border-transparent hover:border-line-soft"
                    >
                      <div className="w-12 h-12 rounded-[8px] overflow-hidden flex-shrink-0">
                        {m.imagePath ? (
                          <img
                            src={`/media/meals/${m.id}/thumb.jpg`}
                            alt={m.name}
                            className="w-full h-full object-cover"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                          />
                        ) : (
                          <PhotoTile tone={tone} aspect="1 / 1" round={8} compact />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] font-semibold text-ink-1 leading-tight truncate">{m.name}</div>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-ink-3 flex-wrap">
                          {m.canBatch && (
                            <span className="inline-flex items-center gap-1"><Flame size={10} /> Batch</span>
                          )}
                          {m.canFresh && (
                            <span className="inline-flex items-center gap-1"><Leaf size={10} /> Fresh</span>
                          )}
                          {m.calories && <><span>·</span><span>{m.calories} cal</span></>}
                        </div>
                      </div>
                      {busy && <div className="text-[11px] text-ink-3">Adding…</div>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function PlannedMealEditModal({
  pm, onChange, onSwap, onRemove, onOpenRecipe, onClose, onCookedRequested,
}: {
  pm: PlannedMeal;
  onChange: (patch: Partial<PlannedMeal>) => Promise<void>;
  onSwap: () => void;
  onRemove: () => Promise<void>;
  onOpenRecipe: () => void;
  onClose: () => void;
  onCookedRequested: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const guarded = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  };

  const statuses: Array<{ value: string; label: string }> = [
    { value: "planned", label: "Planned" },
    { value: "cooked", label: "Cooked" },
    { value: "skipped", label: "Skipped" },
  ];

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8 amp-fade-in"
      style={{ background: "rgba(30, 22, 10, 0.55)", backdropFilter: "blur(4px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-1 rounded-[16px] w-full max-w-[520px] max-h-[88vh] flex flex-col overflow-hidden border border-line"
        style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
      >
        <div className="flex items-start gap-3 px-4 sm:px-5 py-3.5 border-b border-line-soft">
          <div className="w-12 h-12 rounded-[8px] overflow-hidden flex-shrink-0">
            {pm.meal.imagePath ? (
              <img
                src={`/media/meals/${pm.meal.id}/thumb.jpg`}
                alt={pm.meal.name}
                className="w-full h-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <PhotoTile tone={toneForMeal(pm.meal)} aspect="1 / 1" round={8} compact />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-semibold text-ink-1 leading-tight line-clamp-2">{pm.meal.name}</div>
            <button
              onClick={onOpenRecipe}
              className="inline-flex items-center gap-1 mt-1 text-[11.5px] text-accent-ink hover:underline"
            >
              <ExternalLink size={11} /> Open recipe
            </button>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 grid place-items-center rounded-[8px] text-ink-2 hover:bg-surface-2"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-5">
          <Field label="Status">
            <div className="flex gap-1.5 flex-wrap">
              {statuses.map((s) => {
                const active = pm.status === s.value;
                return (
                  <button
                    key={s.value}
                    disabled={busy || active}
                    onClick={() => {
                      if (s.value === "cooked") {
                        onCookedRequested();
                      } else {
                        guarded(() => onChange({ status: s.value }));
                      }
                    }}
                    className={`px-3 py-1.5 rounded-[8px] text-[12.5px] border transition ${
                      active
                        ? "bg-accent text-accent-on border-accent"
                        : "bg-surface-2 text-ink-1 border-line hover:border-accent-line"
                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Day">
            <select
              value={pm.day}
              disabled={busy}
              onChange={(e) => guarded(() => onChange({ day: e.target.value }))}
              className="w-full px-3 py-2 text-[13px] bg-surface-2 border border-line rounded-[8px] text-ink-1 focus:outline-none focus:border-accent disabled:opacity-60"
            >
              {DAYS.map((d) => (
                <option key={d} value={d}>{DAY_LABELS[d]}</option>
              ))}
            </select>
          </Field>

          <Field label="Slot">
            <div className="flex gap-1.5">
              {(["lunch", "dinner"] as const).map((s) => {
                const active = pm.mealSlot === s;
                return (
                  <button
                    key={s}
                    disabled={busy || active}
                    onClick={() => guarded(() => onChange({ mealSlot: s }))}
                    className={`px-3 py-1.5 rounded-[8px] text-[12.5px] capitalize border transition ${
                      active
                        ? "bg-accent text-accent-on border-accent"
                        : "bg-surface-2 text-ink-1 border-line hover:border-accent-line"
                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Servings">
            <div className="flex items-center gap-2">
              <button
                disabled={busy || pm.servings <= 1}
                onClick={() => guarded(() => onChange({ servings: pm.servings - 1 }))}
                className="w-9 h-9 grid place-items-center rounded-[8px] bg-surface-2 border border-line text-ink-1 hover:border-accent-line disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Decrease servings"
              >
                <Minus size={14} />
              </button>
              <div className="text-[16px] font-semibold text-ink-1 tabular-nums w-10 text-center">{pm.servings}</div>
              <button
                disabled={busy || pm.servings >= 12}
                onClick={() => guarded(() => onChange({ servings: pm.servings + 1 }))}
                className="w-9 h-9 grid place-items-center rounded-[8px] bg-surface-2 border border-line text-ink-1 hover:border-accent-line disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Increase servings"
              >
                <Plus size={14} />
              </button>
            </div>
          </Field>

          <Field label="Cook style">
            <div className="flex gap-1.5 flex-wrap">
              {([
                { value: "cook_fresh", label: "Cook fresh", Icon: Leaf },
                { value: "batch_prep", label: "Batch prep", Icon: Flame },
                { value: "leftovers",  label: "Leftovers",  Icon: Refrigerator },
              ] as const).map(({ value, label, Icon }) => {
                const active = pm.cookStyle === value;
                return (
                  <button
                    key={value}
                    disabled={busy || active}
                    onClick={() => guarded(() => onChange({ cookStyle: value }))}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12.5px] border transition ${
                      active
                        ? "bg-accent text-accent-on border-accent"
                        : "bg-surface-2 text-ink-1 border-line hover:border-accent-line"
                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                  >
                    <Icon size={12} /> {label}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Recipe">
            <Button variant="ghost" size="sm" icon={Replace} disabled={busy} onClick={onSwap}>
              Swap to a different recipe
            </Button>
          </Field>
        </div>

        <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 border-t border-line-soft bg-surface-2">
          {confirmingRemove ? (
            <>
              <span className="text-[12px] text-ink-2">Remove from plan?</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmingRemove(false)}>Cancel</Button>
                <Button
                  variant="danger"
                  size="sm"
                  icon={Trash2}
                  disabled={busy}
                  onClick={() => guarded(onRemove)}
                >
                  Remove
                </Button>
              </div>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                disabled={busy}
                onClick={() => setConfirmingRemove(true)}
              >
                Remove
              </Button>
              <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">{label}</div>
      {children}
    </div>
  );
}

function EmptyWeekCard({
  isPastWeek,
  weekLabel,
  onCreate,
}: {
  isPastWeek: boolean;
  weekLabel: string;
  onCreate: () => void;
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
      <div className="text-[14px] text-ink-2">No plan for this week yet.</div>
      <Button variant="primary" icon={Plus} onClick={onCreate}>
        Create plan for the week of {weekLabel}
      </Button>
    </div>
  );
}

function EmptyWeekGrid({ weekStart, today }: { weekStart: string; today: string | null }) {
  return (
    <div aria-hidden="true" className="lg:grid lg:grid-cols-7 lg:gap-3 flex gap-3 overflow-x-auto amp-no-scrollbar -mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 snap-x snap-mandatory opacity-60">
      {DAYS.map((day) => {
        const isToday = day === today;
        return (
          <div
            key={day}
            className={`snap-start shrink-0 w-[72%] sm:w-[44%] lg:w-auto bg-surface-1 rounded-[14px] p-3 flex flex-col gap-2.5 min-h-[280px] border ${
              isToday ? "border-accent" : "border-line-soft"
            }`}
          >
            <div className="flex items-baseline justify-between">
              <div>
                <div className={`text-[11px] uppercase tracking-[0.08em] font-semibold ${isToday ? "text-accent-ink" : "text-ink-3"}`}>
                  {DAY_LABELS[day]}
                </div>
                <div className="text-[20px] font-semibold text-ink-3 -tracking-[0.02em] mt-px">
                  {dayDate(weekStart, day)}
                </div>
              </div>
            </div>
            {(["lunch", "dinner"] as const).map((slot) => (
              <div key={slot} className="flex flex-col gap-1">
                <div className="text-[10px] uppercase tracking-[0.08em] text-ink-3">{slot}</div>
                <div className="border border-dashed border-line-soft rounded-[10px] py-4 bg-surface-2/40" />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
