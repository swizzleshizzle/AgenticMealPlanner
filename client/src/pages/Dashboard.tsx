import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Sparkles,
  Flame,
  Leaf,
  Refrigerator,
  Clock,
  Users,
  Check,
  CheckCircle2,
  ArrowRight,
  ChevronRight,
  ShoppingCart,
  MessageCircle,
  Upload,
  CalendarDays,
} from "lucide-react";
import {
  getPlans,
  type WeeklyPlan,
  type PlannedMeal,
} from "../api/plans";
import { getPantry, type PantryCard } from "../api/pantry";
import { getShoppingList, type ShoppingItem } from "../api/shopping";
import Pill from "../components/ui/Pill";
import PhotoTile from "../components/ui/PhotoTile";
import SectionHead from "../components/ui/SectionHead";
import Button from "../components/ui/Button";
import { toneForMeal } from "../theme/photoTone";
import { useCookConfirm } from "../components/cookConfirm/CookConfirmProvider";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const DAY_LONG: Record<string, string> = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday",
  thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};
const DAY_LABELS: Record<string, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed",
  thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun",
};

function todayKey(): string {
  // DAYS is Sunday-first, matches JS getDay (0=Sun) directly.
  return DAYS[new Date().getDay()];
}

function expiresInDays(card: PantryCard): number | null {
  return card.nextExpirationDays ?? null;
}

function planWeekStart(plan: WeeklyPlan): Date {
  // Slice the date portion so "YYYY-MM-DD" and full-ISO inputs both produce
  // local midnight on the calendar date (avoids the TZ-shift that
  // new Date(fullIso).setHours(0,0,0,0) produces in negative-offset zones).
  return new Date(plan.weekStartDate.slice(0, 10) + "T00:00:00");
}

/** Returns true if the plan's week (7 days from weekStartDate) covers today. */
function planCoversToday(plan: WeeklyPlan): boolean {
  const start = planWeekStart(plan);
  if (Number.isNaN(start.getTime())) return false;
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const now = Date.now();
  return now >= start.getTime() && now < end.getTime();
}

function planNotPast(plan: WeeklyPlan): boolean {
  const start = planWeekStart(plan);
  if (Number.isNaN(start.getTime())) return false;
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return end.getTime() > Date.now();
}

export default function Dashboard() {
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [pantry, setPantry] = useState<PantryCard[]>([]);
  const [shopping, setShopping] = useState<ShoppingItem[]>([]);
  const [now] = useState(() => new Date());
  const navigate = useNavigate();
  const { openForMeal } = useCookConfirm();

  const load = useCallback(() => {
    getPlans().then((plans) => {
      // Prefer the plan covering today; otherwise surface the soonest upcoming
      // so the dashboard is useful in the gap between active plans.
      const candidates = plans
        .filter(planNotPast)
        .sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate));
      const next = candidates.find(planCoversToday) ?? candidates[0] ?? null;
      setPlan(next);
      if (next) getShoppingList(next.id).then((r) => setShopping(r.items)).catch(() => setShopping([]));
    }).catch(() => setPlan(null));
    getPantry().then(setPantry).catch(() => setPantry([]));
  }, [setPlan, setShopping, setPantry]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onDone = () => { load(); };
    window.addEventListener("cookconfirm:done", onDone);
    return () => window.removeEventListener("cookconfirm:done", onDone);
  }, [load]);

  const today = todayKey();
  const planIsCurrent = plan ? planCoversToday(plan) : false;
  const currentPlan = planIsCurrent ? plan : null;
  const todayMeals = currentPlan?.plannedMeals.filter((m) => m.day === today) ?? [];
  const tonight = todayMeals.find((m) => m.mealSlot === "dinner");
  const otherToday = todayMeals.filter((m) => m.mealSlot !== "dinner");

  const upcoming = useMemo(() => {
    if (!currentPlan) return [];
    const startIdx = DAYS.indexOf(today as typeof DAYS[number]);
    return DAYS.slice(startIdx + 1, startIdx + 5).map((d) => ({
      day: d,
      meals: currentPlan.plannedMeals.filter((m) => m.day === d),
    }));
  }, [currentPlan, today]);

  const totals = useMemo(() => {
    if (!currentPlan) return { calories: 0, protein: 0, carbs: 0, fat: 0 };
    return currentPlan.plannedMeals.reduce(
      (acc, pm) => {
        if (pm.status === "skipped") return acc;
        const scale = pm.servings / (pm.meal.servings || 1);
        acc.calories += (pm.meal.calories || 0) * scale;
        acc.protein += (pm.meal.proteinG || 0) * scale;
        acc.carbs   += (pm.meal.carbsG || 0) * scale;
        acc.fat     += (pm.meal.fatG || 0) * scale;
        return acc;
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    );
  }, [plan]);

  const expiringSoon = pantry
    .map((p) => ({ p, d: expiresInDays(p) }))
    .filter((x) => x.d != null && x.d! <= 4)
    .sort((a, b) => (a.d! - b.d!))
    .slice(0, 4);

  const toBuyCount = shopping.filter((s) => !s.checked && s.quantityToBuy > 0).length;

  const greeting = (() => {
    const h = now.getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  const dateLabel = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const handleCooked = (pm: PlannedMeal) => {
    if (!plan) return;
    openForMeal(plan.id, pm.id);
  };

  return (
    <div className="flex flex-col gap-7">
      {/* greeting */}
      <div>
        <div className="text-[12px] uppercase tracking-[0.1em] text-ink-3 mb-1.5">
          {dateLabel}
        </div>
        <h1 className="text-[28px] sm:text-[32px] font-semibold -tracking-[0.02em] text-ink-1">
          {greeting}, Mike.
        </h1>
        <p className="text-[15px] text-ink-2 mt-1">
          {tonight ? "Here's what's for dinner tonight." : "Nothing planned tonight — open the planner to set up the week."}
        </p>
      </div>

      {!currentPlan && plan && (
        <UpcomingPlanCard plan={plan} />
      )}

      {!currentPlan && !plan && (
        <div className="rounded-[16px] border border-dashed border-line bg-surface-1 p-10 text-center">
          <p className="text-ink-2 mb-4">No active meal plan this week.</p>
          <Link
            to="/planner"
            className="inline-flex items-center gap-1.5 bg-accent text-accent-on rounded-[10px] px-4 py-2 text-[13px] font-medium hover:opacity-90"
          >
            Plan this week <ArrowRight size={14} />
          </Link>
        </div>
      )}

      {/* hero — tonight */}
      {tonight && (
        <article className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] bg-surface-1 rounded-[20px] border border-line overflow-hidden shadow-[var(--shadow-hero)]">
          <div className="min-h-[200px] lg:min-h-[320px]">
            {tonight.meal.imagePath ? (
              <img
                src={`/media/meals/${tonight.meal.id}/thumb.jpg`}
                alt={tonight.meal.name}
                className="w-full h-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <PhotoTile
                tone={toneForMeal(tonight.meal)}
                label={`tonight — ${tonight.meal.name.toLowerCase()}`}
                aspect={null}
                round={0}
              />
            )}
          </div>
          <div className="p-6 sm:p-9 flex flex-col gap-4 justify-center">
            <div className="flex gap-1.5 flex-wrap">
              <Pill tone="accent" size="md">
                <Sparkles size={12} /> Tonight's dinner
              </Pill>
              <Pill tone={
                tonight.cookStyle === "batch_prep" ? "prep" :
                tonight.cookStyle === "leftovers"  ? "prep" :
                "fresh"
              } size="md">
                {tonight.cookStyle === "batch_prep" && <><Flame size={12} /> From Sunday prep</>}
                {tonight.cookStyle === "leftovers"  && <><Refrigerator size={12} /> Leftovers</>}
                {tonight.cookStyle === "cook_fresh" && <><Leaf size={12} /> Cook fresh</>}
              </Pill>
              {tonight.status === "cooked" && (
                <Pill tone="accent" size="md">
                  <Check size={12} /> Cooked
                </Pill>
              )}
            </div>
            <h2 className="text-[24px] sm:text-[28px] font-semibold -tracking-[0.02em] leading-tight text-ink-1">
              {tonight.meal.name}
            </h2>
            {tonight.meal.description && (
              <p className="text-[14px] text-ink-2 leading-relaxed">{tonight.meal.description}</p>
            )}
            <div className="flex gap-5 text-[13px] text-ink-2 flex-wrap">
              {(tonight.meal.prepTime || tonight.meal.cookTime) != null && (
                <span className="inline-flex items-center gap-1.5">
                  <Clock size={14} />
                  {(tonight.meal.prepTime || 0) + (tonight.meal.cookTime || 0)} min
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Users size={14} /> {tonight.servings} servings
              </span>
              {tonight.meal.calories && <span>{tonight.meal.calories} cal</span>}
            </div>
            {(tonight.cookStyle === "batch_prep" || tonight.cookStyle === "leftovers") && tonight.status !== "cooked" && (
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] bg-prep-soft border border-prep-line text-prep-ink text-[13px]">
                <Refrigerator size={16} />
                <span>Pull from the fridge — reheat covered, ~5 min at 350°F.</span>
              </div>
            )}
            <div className="flex gap-2 flex-wrap mt-1">
              {tonight.status !== "cooked" && (
                <Button variant="primary" icon={CheckCircle2} onClick={() => handleCooked(tonight)}>
                  Mark as cooked
                </Button>
              )}
              <Button variant="ghost" onClick={() => navigate(`/recipes/${tonight.meal.id}`, { state: { from: "/" } })}>
                View recipe
              </Button>
              <Button variant="quiet" onClick={() => navigate("/chat")}>Swap</Button>
            </div>
          </div>
        </article>
      )}

      {/* two-column: rest of today + week, sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-6">
        <div>
          {currentPlan && (
            <>
              <SectionHead eyebrow="Rest of today" title="Other meals" />
              <div className="flex flex-col gap-2.5">
                {otherToday.length === 0 ? (
                  <div className="text-[13px] text-ink-3 py-2">No other meals planned today.</div>
                ) : otherToday.map((pm) => (
                  <button
                    key={pm.id}
                    onClick={() => navigate(`/recipes/${pm.meal.id}`, { state: { from: "/" } })}
                    className="flex items-center gap-3.5 p-3.5 bg-surface-1 border border-line rounded-[14px] text-left transition hover:shadow-[var(--shadow-card-hover)]"
                  >
                    <div className="w-[64px] sm:w-[72px] flex-shrink-0 aspect-square rounded-[10px] overflow-hidden">
                      {pm.meal.imagePath ? (
                        <img
                          src={`/media/meals/${pm.meal.id}/thumb.jpg`}
                          alt={pm.meal.name}
                          className="w-full h-full object-cover"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <PhotoTile tone={toneForMeal(pm.meal)} aspect="1 / 1" round={10} compact />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 mb-0.5">{pm.mealSlot}</div>
                      <div className="text-[15px] font-semibold text-ink-1 -tracking-[0.01em] truncate">{pm.meal.name}</div>
                      <div className="text-[12px] text-ink-3 mt-0.5">
                        {pm.servings} servings{pm.meal.calories ? ` · ${pm.meal.calories} cal` : ""}
                      </div>
                    </div>
                    {pm.status === "cooked" ? (
                      <Pill tone="accent" size="sm"><Check size={11} /> Cooked</Pill>
                    ) : (
                      <ChevronRight size={18} className="text-ink-3" />
                    )}
                  </button>
                ))}
              </div>

              <div className="mt-8">
                <SectionHead
                  eyebrow="Coming up"
                  title="This week"
                  action={
                    <Button variant="quiet" size="sm" onClick={() => navigate("/planner")}>
                      Full planner <ArrowRight size={13} />
                    </Button>
                  }
                />
                <div className="bg-surface-1 border border-line rounded-[14px] overflow-hidden">
                  {upcoming.length === 0 ? (
                    <div className="p-5 text-[13px] text-ink-3">Nothing planned for the rest of the week.</div>
                  ) : upcoming.map(({ day, meals }) => {
                    const dinner = meals.find((m) => m.mealSlot === "dinner");
                    return (
                      <div
                        key={day}
                        className="grid grid-cols-[88px_1fr_auto] items-center px-4 sm:px-5 py-3.5 border-b border-line-soft last:border-b-0"
                      >
                        <div>
                          <div className="text-[13px] font-semibold text-ink-1 capitalize">{DAY_LABELS[day]}</div>
                          <div className="text-[11px] text-ink-3">{meals.length} meal{meals.length !== 1 ? "s" : ""}</div>
                        </div>
                        {dinner ? (
                          <div className="min-w-0">
                            <div className="text-[14px] text-ink-1 font-medium truncate">{dinner.meal.name}</div>
                            <div className="text-[12px] text-ink-3">
                              {dinner.cookStyle === "batch_prep" && "From prep"}
                              {dinner.cookStyle === "leftovers"  && "Leftovers"}
                              {dinner.cookStyle === "cook_fresh" && "Cook fresh"}
                              {" · "}{dinner.servings} servings
                            </div>
                          </div>
                        ) : (
                          <div className="text-[13px] text-ink-3 italic">Open night</div>
                        )}
                        <Pill tone={dinner && dinner.cookStyle !== "cook_fresh" ? "prep" : "fresh"} size="sm">
                          {dinner?.cookStyle === "batch_prep" && <><Flame size={10} /> Prep</>}
                          {dinner?.cookStyle === "leftovers"  && <><Refrigerator size={10} /> Leftovers</>}
                          {(!dinner || dinner.cookStyle === "cook_fresh") && <><Leaf size={10} /> Fresh</>}
                        </Pill>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* right column */}
        <div className="flex flex-col gap-4">
          {currentPlan && (
            <div className="bg-surface-1 border border-line rounded-[14px] p-4 sm:p-5">
              <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 mb-2.5">This week · 7 days</div>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Calories" value={Math.round(totals.calories).toLocaleString()} />
                <Stat label="Protein"  value={`${Math.round(totals.protein)}g`} />
                <Stat label="Carbs"    value={`${Math.round(totals.carbs)}g`} />
                <Stat label="Fat"      value={`${Math.round(totals.fat)}g`} />
              </div>
            </div>
          )}

          {expiringSoon.length > 0 && (
            <div className="bg-surface-1 border border-line rounded-[14px] p-4 sm:p-5">
              <div className="flex items-center justify-between mb-2.5">
                <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Use soon</div>
                <button
                  onClick={() => navigate("/pantry")}
                  className="text-[12px] text-accent-ink hover:underline"
                >
                  Pantry →
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {expiringSoon.map(({ p, d }) => (
                  <div key={p.ingredient.id} className="flex items-center justify-between text-[13px]">
                    <span className="text-ink-1 truncate pr-2">{p.ingredient.name}</span>
                    <Pill tone="warn" size="sm">{d}d</Pill>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-surface-1 border border-line rounded-[14px] p-1.5">
            <Shortcut icon={ShoppingCart} label="Shopping list" sub={`${toBuyCount} items to buy`} to="/shopping" />
            <Shortcut icon={MessageCircle} label="Ask the assistant" sub="Swap, skip, or scale meals" to="/chat" />
            <Shortcut icon={Upload} label="Import a recipe" sub="Upload a PDF or photo" to="/recipes/import" />
            {!currentPlan && (
              <Shortcut icon={CalendarDays} label="Plan this week" sub="Sunday prep starts here" to="/planner" last />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[22px] font-semibold text-ink-1 -tracking-[0.02em] leading-none">{value}</div>
      <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 mt-1">{label}</div>
    </div>
  );
}

function Shortcut({
  icon: Icon, label, sub, to, last,
}: { icon: import("lucide-react").LucideIcon; label: string; sub: string; to: string; last?: boolean }) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 w-full px-3.5 py-3 text-left transition rounded-[10px] hover:bg-surface-2 ${last ? "" : "border-b border-line-soft"}`}
    >
      <div className="w-9 h-9 rounded-[10px] bg-accent-soft text-accent-ink grid place-items-center flex-shrink-0">
        <Icon size={17} strokeWidth={1.85} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-medium text-ink-1 truncate">{label}</div>
        <div className="text-[11.5px] text-ink-3 truncate">{sub}</div>
      </div>
      <ChevronRight size={16} className="text-ink-3" />
    </Link>
  );
}

function UpcomingPlanCard({ plan }: { plan: WeeklyPlan }) {
  const start = planWeekStart(plan);
  const startLabel = start.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const ms = start.getTime() - Date.now();
  const daysAway = Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  // Show first day's meals as a preview (or first 3 meals if multi-day spread).
  const firstDayKey = DAYS[0];
  const firstDayMeals = plan.plannedMeals.filter((m) => m.day === firstDayKey).slice(0, 3);
  const preview = firstDayMeals.length > 0
    ? firstDayMeals
    : plan.plannedMeals.slice(0, 3);

  return (
    <article className="bg-surface-1 rounded-[20px] border border-line overflow-hidden p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <Pill tone="accent" size="md">
            <CalendarDays size={12} /> Coming up
          </Pill>
          <h2 className="text-[20px] sm:text-[22px] font-semibold -tracking-[0.02em] text-ink-1 mt-2">
            Next plan starts {startLabel}
          </h2>
          <p className="text-[13px] text-ink-3 mt-1">
            {daysAway === 1 ? "Tomorrow" : `${daysAway} days away`} · {plan.plannedMeals.length} meals queued
          </p>
        </div>
        <Link
          to="/planner"
          className="inline-flex items-center gap-1.5 bg-accent text-accent-on rounded-[10px] px-4 py-2 text-[13px] font-medium hover:opacity-90"
        >
          View plan <ArrowRight size={14} />
        </Link>
      </div>
      {preview.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {preview.map((pm) => (
            <Link
              key={pm.id}
              to={`/recipes/${pm.meal.id}`}
              state={{ from: "/" }}
              className="flex items-center gap-3 p-2.5 bg-surface-2 border border-line-soft rounded-[12px] text-left hover:border-line transition"
            >
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
                <div className="text-[12.5px] font-semibold text-ink-1 leading-tight line-clamp-2">{pm.meal.name}</div>
                <div className="text-[10.5px] text-ink-3 mt-0.5 capitalize">{pm.day} · {pm.mealSlot}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </article>
  );
}
