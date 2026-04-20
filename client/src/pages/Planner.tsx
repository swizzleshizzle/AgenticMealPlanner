import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles,
  CalendarDays,
  Flame,
  Leaf,
  Plus,
  Check,
} from "lucide-react";
import {
  createPlan,
  generatePlan,
  getPlans,
  updatePlan,
  type WeeklyPlan,
} from "../api/plans";
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

function getNextMonday(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().split("T")[0];
}

function todayKey(): string {
  return DAYS[(new Date().getDay() + 6) % 7];
}

function dayDate(weekStart: string, dayKey: string): number {
  const start = new Date(weekStart + "T00:00:00");
  start.setDate(start.getDate() + DAYS.indexOf(dayKey as typeof DAYS[number]));
  return start.getDate();
}

export default function Planner() {
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [generating, setGenerating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    getPlans().then((p) => {
      const active = p.find((pl) => pl.status === "active") ?? p.find((pl) => pl.status === "draft") ?? p[0] ?? null;
      setPlan(active);
    });
  }, []);

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
  const startObj = new Date(weekStart + "T00:00:00");
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
                            <div className="mb-1.5">
                              <PhotoTile tone={toneForMeal(pm.meal)} aspect="16 / 9" round={6} compact />
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
                          <button className="flex items-center justify-center gap-1.5 border border-dashed border-line rounded-[10px] py-4 text-[11.5px] text-ink-3 hover:bg-surface-2 transition">
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
    </div>
  );
}
