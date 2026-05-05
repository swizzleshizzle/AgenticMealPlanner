import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, Plus, Minus, CalendarDays, Flame, Leaf, Refrigerator, ArrowRight } from "lucide-react";
import {
  addPlannedMeal,
  getPlans,
  getNextSunday,
  localMidnightFromISO,
  pickRelevantPlan,
  type WeeklyPlan,
  type PlannedMeal,
} from "../api/plans";
import type { Meal } from "../api/meals";
import Button from "./ui/Button";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
type DayKey = typeof DAYS[number];
type Slot = "lunch" | "dinner";
type CookStyle = "cook_fresh" | "batch_prep" | "leftovers";

const DAY_LABELS: Record<DayKey, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed",
  thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun",
};

interface Props {
  meal: Meal;
  onClose: () => void;
  onAdded: (pm: PlannedMeal) => void;
}

export default function AddToPlanModal({ meal, onClose, onAdded }: Props) {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<WeeklyPlan[] | null>(null);
  const [day, setDay] = useState<DayKey>("sunday");
  const [slot, setSlot] = useState<Slot>("lunch");
  const [servings, setServings] = useState<number>(meal.servings || 2);
  const [cookStyle, setCookStyle] = useState<CookStyle>("cook_fresh");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaultsApplied = useRef(false);

  // Esc-to-close + body-scroll lock, consistent with the other modals in this app.
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

  useEffect(() => {
    getPlans().then(setPlans).catch(() => setPlans([]));
  }, []);

  const targetPlan = useMemo(
    () => (plans ? pickRelevantPlan(plans) : null),
    [plans],
  );

  // Map of day -> slot occupancy for the target plan's week.
  const occupiedByDay = useMemo(() => {
    const map: Record<DayKey, { lunch: PlannedMeal | null; dinner: PlannedMeal | null }> =
      Object.fromEntries(DAYS.map((d) => [d, { lunch: null, dinner: null }])) as any;
    if (targetPlan) {
      for (const pm of targetPlan.plannedMeals) {
        const d = pm.day as DayKey;
        if (!(d in map)) continue;
        if (pm.mealSlot === "lunch" && !map[d].lunch) map[d].lunch = pm;
        if (pm.mealSlot === "dinner" && !map[d].dinner) map[d].dinner = pm;
      }
    }
    return map;
  }, [targetPlan]);

  // When the target plan first resolves, pick defaults: first empty {day, slot}
  // scanning Mon → Sun, Lunch → Dinner per day. Apply the Sunday-only isPrep
  // rule to the chosen defaults. Runs once.
  useEffect(() => {
    if (!targetPlan || defaultsApplied.current) return;
    defaultsApplied.current = true;
    for (const d of DAYS) {
      for (const s of ["lunch", "dinner"] as Slot[]) {
        if (!occupiedByDay[d][s]) {
          setDay(d);
          setSlot(s);
          setCookStyle(d === "sunday" && !!meal.canBatch ? "batch_prep" : "cook_fresh");
          return;
        }
      }
    }
    // Every slot taken — leave defaults; cookStyle stays cook_fresh.
  }, [targetPlan, occupiedByDay, meal.canBatch]);

  const targetWeekLabel = useMemo(() => {
    if (!targetPlan) return "";
    return localMidnightFromISO(targetPlan.weekStartDate).toLocaleDateString(
      undefined,
      { weekday: "long", month: "long", day: "numeric" },
    );
  }, [targetPlan]);

  const occupantHere = occupiedByDay[day][slot];

  const submit = async () => {
    if (!targetPlan) return;
    setSubmitting(true);
    setError(null);
    try {
      const pm = await addPlannedMeal(targetPlan.id, {
        mealId: meal.id,
        day,
        mealSlot: slot,
        servings,
        cookStyle,
      });
      onAdded(pm as PlannedMeal);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed to add. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const loading = plans === null;
  const noPlan = plans !== null && !targetPlan;

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
          <div className="w-8 h-8 rounded-[8px] bg-accent-soft text-accent-ink grid place-items-center">
            <CalendarDays size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-ink-1">Add to plan</div>
            <div className="text-[11px] text-ink-3 truncate">{meal.name}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 grid place-items-center rounded-[8px] text-ink-2 hover:bg-surface-2"
          >
            <X size={16} />
          </button>
        </div>

        {loading && (
          <div className="p-8 text-center text-[13px] text-ink-3">Loading plans…</div>
        )}

        {noPlan && (
          <NoPlanBody
            onGoToPlanner={() => { navigate("/planner"); onClose(); }}
            onCancel={onClose}
          />
        )}

        {!loading && targetPlan && (
          <>
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-5">
              <div className="text-[12px] text-ink-3">
                Adding to week of <span className="text-ink-1 font-medium">{targetWeekLabel}</span>
              </div>

              <Field label="Day">
                <div className="flex gap-1 flex-wrap">
                  {DAYS.map((d) => {
                    const active = day === d;
                    const bucket = occupiedByDay[d];
                    const full = !!(bucket.lunch && bucket.dinner);
                    return (
                      <button
                        key={d}
                        disabled={submitting}
                        onClick={() => setDay(d)}
                        className={`relative px-3 py-1.5 rounded-[8px] text-[12.5px] border transition ${
                          active
                            ? "bg-accent text-accent-on border-accent"
                            : "bg-surface-2 text-ink-1 border-line hover:border-accent-line"
                        } disabled:opacity-60`}
                      >
                        {DAY_LABELS[d]}
                        {full && (
                          <span
                            aria-hidden="true"
                            className={`absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${
                              active ? "bg-accent-on" : "bg-ink-3"
                            }`}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="Slot">
                <div className="flex gap-1.5">
                  {(["lunch", "dinner"] as const).map((s) => {
                    const active = slot === s;
                    return (
                      <button
                        key={s}
                        disabled={submitting}
                        onClick={() => setSlot(s)}
                        className={`px-3 py-1.5 rounded-[8px] text-[12.5px] capitalize border transition ${
                          active
                            ? "bg-accent text-accent-on border-accent"
                            : "bg-surface-2 text-ink-1 border-line hover:border-accent-line"
                        } disabled:opacity-60`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
                {occupantHere ? (
                  <div className="mt-1.5 text-[11.5px] text-warn-ink">
                    Already has <span className="font-medium">{occupantHere.meal.name}</span> in this slot. Confirming will add a second meal.
                  </div>
                ) : (
                  <div className="mt-1.5 text-[11.5px] text-ink-3">Slot is open.</div>
                )}
              </Field>

              <Field label="Servings">
                <div className="flex items-center gap-2">
                  <button
                    disabled={submitting || servings <= 1}
                    onClick={() => setServings((v) => Math.max(1, v - 1))}
                    aria-label="Decrease servings"
                    className="w-9 h-9 grid place-items-center rounded-[8px] bg-surface-2 border border-line text-ink-1 hover:border-accent-line disabled:opacity-40"
                  >
                    <Minus size={14} />
                  </button>
                  <div className="text-[16px] font-semibold text-ink-1 tabular-nums w-10 text-center">{servings}</div>
                  <button
                    disabled={submitting || servings >= 12}
                    onClick={() => setServings((v) => Math.min(12, v + 1))}
                    aria-label="Increase servings"
                    className="w-9 h-9 grid place-items-center rounded-[8px] bg-surface-2 border border-line text-ink-1 hover:border-accent-line disabled:opacity-40"
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
                    const active = cookStyle === value;
                    return (
                      <button
                        key={value}
                        disabled={submitting}
                        onClick={() => setCookStyle(value)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12.5px] border transition ${
                          active
                            ? "bg-accent text-accent-on border-accent"
                            : "bg-surface-2 text-ink-1 border-line hover:border-accent-line"
                        } disabled:opacity-60`}
                      >
                        <Icon size={12} /> {label}
                      </button>
                    );
                  })}
                </div>
              </Field>

              {error && (
                <div className="rounded-[10px] border border-warn-line bg-warn-soft text-warn-ink px-3 py-2 text-[13px]">
                  {error}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-4 sm:px-5 py-3 border-t border-line-soft bg-surface-2">
              <Button variant="ghost" size="sm" disabled={submitting} onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" disabled={submitting} onClick={submit}>
                {submitting ? "Adding…" : "Add to plan"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function NoPlanBody({
  onGoToPlanner,
  onCancel,
}: {
  onGoToPlanner: () => void;
  onCancel: () => void;
}) {
  const nextSundayLabel = useMemo(() => {
    const iso = getNextSunday();
    return localMidnightFromISO(iso).toLocaleDateString(undefined, {
      weekday: "long", month: "long", day: "numeric",
    });
  }, []);

  return (
    <>
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-3">
        <div className="w-11 h-11 rounded-[12px] bg-accent-soft text-accent-ink grid place-items-center">
          <CalendarDays size={22} />
        </div>
        <div className="text-[15px] font-semibold text-ink-1">No active plan yet</div>
        <div className="text-[13px] text-ink-2 leading-relaxed max-w-[320px]">
          The next plan would start {nextSundayLabel}. Head to the planner to set it up.
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 px-4 sm:px-5 py-3 border-t border-line-soft bg-surface-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" icon={ArrowRight} onClick={onGoToPlanner}>
          Go to planner
        </Button>
      </div>
    </>
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
