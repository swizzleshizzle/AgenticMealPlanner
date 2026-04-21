import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles,
  CalendarDays,
  Flame,
  Leaf,
  Plus,
  Check,
  Search,
  X,
} from "lucide-react";
import {
  addPlannedMeal,
  createPlan,
  generatePlan,
  getPlans,
  updatePlan,
  type WeeklyPlan,
  type PlannedMeal,
} from "../api/plans";
import { getMeals, type Meal } from "../api/meals";
import { syncCalendar } from "../api/calendar";
import Pill from "../components/ui/Pill";
import Button from "../components/ui/Button";
import PhotoTile from "../components/ui/PhotoTile";
import { toneForMeal } from "../theme/photoTone";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const DAY_LABELS: Record<string, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed",
  thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun",
};

function localMidnightFromISO(s: string): Date {
  // Accepts both "YYYY-MM-DD" and full ISO ("YYYY-MM-DDTHH:mm:ss.sssZ"); always
  // returns local midnight on the calendar date — preserves the date the user
  // chose regardless of their timezone offset.
  return new Date(s.slice(0, 10) + "T00:00:00");
}

function formatLocalDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getNextMonday(): string {
  // Returns the upcoming Monday on-or-after today, formatted as YYYY-MM-DD in
  // local time. Called on a Monday → returns today.
  const now = new Date();
  const day = now.getDay();
  const diff = (8 - day) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return formatLocalDate(monday);
}

function todayKey(): string {
  return DAYS[(new Date().getDay() + 6) % 7];
}

function dayDate(weekStart: string, dayKey: string): number {
  const start = localMidnightFromISO(weekStart);
  start.setDate(start.getDate() + DAYS.indexOf(dayKey as typeof DAYS[number]));
  return start.getDate();
}

function planCoversToday(plan: WeeklyPlan): boolean {
  const start = localMidnightFromISO(plan.weekStartDate);
  if (Number.isNaN(start.getTime())) return false;
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const now = Date.now();
  return now >= start.getTime() && now < end.getTime();
}

function planNotPast(plan: WeeklyPlan): boolean {
  // Plan is current or upcoming (end-of-week is after now). Past plans hide.
  const start = localMidnightFromISO(plan.weekStartDate);
  if (Number.isNaN(start.getTime())) return false;
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return end.getTime() > Date.now();
}

type Slot = "lunch" | "dinner";
type DayKey = typeof DAYS[number];

export default function Planner() {
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [picker, setPicker] = useState<{ day: DayKey; slot: Slot } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    getPlans().then((p) => {
      // Show the most relevant non-past plan: prefer one that covers today,
      // otherwise the soonest upcoming. Past plans hide so the user gets the
      // New plan CTA instead of a stale board.
      const candidates = p.filter(planNotPast)
        .sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate));
      const covering = candidates.filter(planCoversToday);
      const active = covering.find((pl) => pl.status === "draft")
                  ?? covering[0]
                  ?? candidates[0]
                  ?? null;
      setPlan(active);
    });
    getMeals().then(setMeals).catch(() => setMeals([]));
  }, []);

  const handlePick = async (mealId: number) => {
    if (!plan || !picker) return;
    const meal = meals.find((m) => m.id === mealId);
    const planned = await addPlannedMeal(plan.id, {
      mealId,
      day: picker.day,
      mealSlot: picker.slot,
      servings: meal?.servings ?? 2,
      isPrep: meal?.mealType === "batch_prep",
    });
    setPlan({ ...plan, plannedMeals: [...plan.plannedMeals, planned as PlannedMeal] });
    setPicker(null);
  };

  const handleNew = async () => {
    const next = await createPlan(getNextMonday());
    setPlan(next);
  };

  const handleGenerate = async () => {
    if (!plan) return;
    setGenerating(true);
    try {
      const updated = await generatePlan(plan.id);
      setPlan(updated);
    } finally { setGenerating(false); }
  };

  const handleActivate = async () => {
    if (!plan) return;
    const updated = await updatePlan(plan.id, { status: "active" });
    setPlan(updated);
  };

  const handleSync = async () => {
    if (!plan) return;
    setSyncing(true);
    try { await syncCalendar(plan.id); } finally { setSyncing(false); }
  };

  const today = todayKey();

  const weekStart = plan?.weekStartDate ?? getNextMonday();
  const startObj = localMidnightFromISO(weekStart);
  const monthLabel = startObj.toLocaleDateString(undefined, { month: "long", day: "numeric" });

  const summary = useMemo(() => {
    if (!plan) return null;
    const prep = plan.plannedMeals.filter((m) => m.isPrep && m.status !== "skipped").length;
    const fresh = plan.plannedMeals.filter((m) => !m.isPrep && m.status !== "skipped").length;
    let totalProtein = 0, count = 0;
    for (const pm of plan.plannedMeals) {
      if (pm.status === "skipped") continue;
      const scale = pm.servings / (pm.meal.servings || 1);
      if (pm.meal.proteinG) {
        totalProtein += pm.meal.proteinG * scale;
        count += 1;
      }
    }
    const avgProtein = count > 0 ? Math.round(totalProtein / count) : 0;
    return { prep, fresh, avgProtein };
  }, [plan]);

  return (
    <div className="flex flex-col gap-7">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[12px] uppercase tracking-[0.1em] text-ink-3 mb-1.5">
            Week of {monthLabel}
          </div>
          <h1 className="text-[26px] sm:text-[30px] font-semibold -tracking-[0.02em] text-ink-1">
            Weekly Planner
          </h1>
        </div>
        <div className="flex gap-2.5 items-center flex-wrap">
          {plan && (
            <Pill tone={plan.status === "active" ? "accent" : plan.status === "draft" ? "warn" : "neutral"} size="md">
              {plan.status === "active" ? <Check size={11} /> : null}
              {plan.status === "active" ? "Active plan" : plan.status === "draft" ? "Draft" : plan.status}
            </Pill>
          )}
          {!plan && (
            <Button variant="primary" icon={Plus} onClick={handleNew}>New plan</Button>
          )}
          {plan?.status === "draft" && (
            <>
              <Button variant="ghost" icon={Sparkles} onClick={handleGenerate} disabled={generating}>
                {generating ? "Generating…" : "Auto-generate"}
              </Button>
              <Button variant="primary" onClick={handleActivate}>Confirm plan</Button>
            </>
          )}
          {plan?.status === "active" && (
            <Button variant="primary" icon={CalendarDays} onClick={handleSync} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync to Calendar"}
            </Button>
          )}
        </div>
      </div>

      {!plan ? (
        <div className="rounded-[16px] border border-dashed border-line bg-surface-1 p-10 text-center text-ink-2">
          No active plan yet. Start one for next week.
        </div>
      ) : (
        <>
          {/* mobile: horizontal scrollable strip; desktop: 7-col grid */}
          <div className="lg:grid lg:grid-cols-7 lg:gap-3 flex gap-3 overflow-x-auto amp-no-scrollbar -mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 snap-x snap-mandatory">
            {DAYS.map((day) => {
              const meals = plan.plannedMeals.filter((m) => m.day === day);
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
                            onClick={() => navigate(`/recipes/${pm.meal.id}`)}
                            className={`block text-left rounded-[10px] p-2 transition border ${
                              pm.status === "cooked"
                                ? "bg-accent-soft border-accent-line"
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
                              {pm.isPrep ? <Flame size={10} /> : <Leaf size={10} />}
                              {pm.isPrep ? "Prep" : "Fresh"}
                              <span>·</span><span>{pm.servings}×</span>
                              {pm.status === "cooked" && (
                                <>
                                  <span>·</span>
                                  <span className="text-accent-ink font-semibold">Cooked</span>
                                </>
                              )}
                            </div>
                          </button>
                        ) : (
                          <button
                            onClick={() => setPicker({ day, slot })}
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
                  Plan looks balanced — {summary.prep} batch-prep session{summary.prep !== 1 ? "s" : ""}, {summary.fresh} fresh cook{summary.fresh !== 1 ? "s" : ""}{summary.avgProtein > 0 ? `, ${summary.avgProtein}g avg protein per meal` : ""}.
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
          meals={meals}
          onPick={handlePick}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

function MealPickerModal({
  day, slot, meals, onPick, onClose,
}: {
  day: DayKey;
  slot: Slot;
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
            <Plus size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-ink-1">Add a recipe</div>
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
                const isPrep = m.mealType === "batch_prep";
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
                        <div className="flex items-center gap-1 mt-0.5 text-[11px] text-ink-3">
                          {isPrep ? <Flame size={10} /> : <Leaf size={10} />}
                          {isPrep ? "Batch prep" : "Cook fresh"}
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
