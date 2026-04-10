import { useState, useEffect } from "react";
import { getPlans, createPlan, generatePlan, updatePlan, updatePlannedMeal, type WeeklyPlan } from "../api/plans";
import { syncCalendar } from "../api/calendar";
import PlanDayColumn from "../components/PlanDayColumn";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function getNextMonday(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().split("T")[0];
}

export default function Planner() {
  const [plans, setPlans] = useState<WeeklyPlan[]>([]);
  const [activePlan, setActivePlan] = useState<WeeklyPlan | null>(null);
  const [generating, setGenerating] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    getPlans().then((p) => {
      setPlans(p);
      const active = p.find((pl) => pl.status === "active" || pl.status === "draft");
      if (active) setActivePlan(active);
    });
  }, []);

  const handleNewPlan = async () => {
    const plan = await createPlan(getNextMonday());
    setActivePlan(plan);
    setPlans((prev) => [plan, ...prev]);
  };

  const handleGenerate = async () => {
    if (!activePlan) return;
    setGenerating(true);
    try {
      const updated = await generatePlan(activePlan.id);
      setActivePlan(updated);
    } finally {
      setGenerating(false);
    }
  };

  const handleActivate = async () => {
    if (!activePlan) return;
    const updated = await updatePlan(activePlan.id, { status: "active" });
    setActivePlan(updated);
  };

  const reload = async () => {
    if (!activePlan) return;
    const plans = await getPlans();
    const updated = plans.find((p) => p.id === activePlan.id);
    if (updated) setActivePlan(updated);
  };

  const handleMarkCooked = async (plannedMealId: number) => {
    if (!activePlan) return;
    await updatePlannedMeal(activePlan.id, plannedMealId, { status: "cooked" });
    reload();
  };

  const handleSkip = async (plannedMealId: number) => {
    if (!activePlan) return;
    await updatePlannedMeal(activePlan.id, plannedMealId, { status: "skipped" });
    reload();
  };

  const handleSyncCalendar = async () => {
    if (!activePlan) return;
    setSyncing(true);
    try {
      await syncCalendar(activePlan.id);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Weekly Planner</h2>
        <div className="flex gap-2">
          {!activePlan && (
            <button onClick={handleNewPlan} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
              Plan This Week
            </button>
          )}
          {activePlan?.status === "draft" && (
            <>
              <button onClick={handleGenerate} disabled={generating}
                className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
                {generating ? "Generating..." : "Auto-Generate"}
              </button>
              <button onClick={handleActivate} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700">
                Confirm Plan
              </button>
            </>
          )}
          {activePlan?.status === "active" && (
            <button onClick={handleSyncCalendar} disabled={syncing}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
              {syncing ? "Syncing..." : "Sync to Calendar"}
            </button>
          )}
        </div>
      </div>
      {!activePlan ? (
        <p className="text-gray-500 text-center py-12">No active plan. Create one to get started!</p>
      ) : (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${
              activePlan.status === "draft" ? "bg-yellow-100 text-yellow-700" :
              activePlan.status === "active" ? "bg-green-100 text-green-700" :
              "bg-gray-100 text-gray-600"
            }`}>{activePlan.status}</span>
            <span className="text-sm text-gray-500">Week of {new Date(activePlan.weekStartDate).toLocaleDateString()}</span>
          </div>
          <div className="grid grid-cols-7 gap-3 overflow-x-auto">
            {DAYS.map((day) => (
              <PlanDayColumn key={day} day={day}
                meals={activePlan.plannedMeals.filter((m) => m.day === day)}
                onMarkCooked={handleMarkCooked} onSkip={handleSkip} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
