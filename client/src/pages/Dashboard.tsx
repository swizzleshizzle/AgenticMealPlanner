import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getPlans, updatePlannedMeal, type WeeklyPlan, type PlannedMeal } from "../api/plans";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function getTodaysMeals(plan: WeeklyPlan): PlannedMeal[] {
  const today = DAYS[new Date().getDay()];
  return plan.plannedMeals.filter((m) => m.day === today);
}

function getWeekNutrition(plan: WeeklyPlan) {
  let calories = 0, protein = 0, carbs = 0, fat = 0;
  for (const pm of plan.plannedMeals) {
    if (pm.status === "skipped") continue;
    const scale = pm.servings / pm.meal.servings;
    calories += (pm.meal.calories || 0) * scale;
    protein += (pm.meal.proteinG || 0) * scale;
    carbs += (pm.meal.carbsG || 0) * scale;
    fat += (pm.meal.fatG || 0) * scale;
  }
  return { calories: Math.round(calories), protein: Math.round(protein), carbs: Math.round(carbs), fat: Math.round(fat) };
}

export default function Dashboard() {
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);

  const load = () => {
    getPlans().then((plans) => {
      const active = plans.find((p) => p.status === "active");
      if (active) setPlan(active);
    });
  };

  useEffect(load, []);

  const todaysMeals = plan ? getTodaysMeals(plan) : [];
  const nutrition = plan ? getWeekNutrition(plan) : null;

  const handleCooked = async (pm: PlannedMeal) => {
    if (!plan) return;
    await updatePlannedMeal(plan.id, pm.id, { status: "cooked" });
    load();
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h2>
      {!plan ? (
        <div className="text-center py-12">
          <p className="text-gray-500 mb-4">No active meal plan this week.</p>
          <Link to="/planner" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
            Plan This Week
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Today's Meals</h3>
            {todaysMeals.length === 0 ? (
              <p className="text-gray-500 text-sm">Nothing planned for today.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {todaysMeals.map((pm) => (
                  <div key={pm.id} className={`bg-white rounded-xl border p-4 ${
                    pm.status === "cooked" ? "border-green-200 bg-green-50" : "border-gray-200"
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-gray-500 uppercase">{pm.mealSlot}</span>
                      {pm.isPrep && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">From Prep</span>}
                    </div>
                    <h4 className="font-semibold text-gray-900">{pm.meal.name}</h4>
                    <p className="text-sm text-gray-500 mt-1">{pm.servings} servings</p>
                    {pm.meal.calories && (<p className="text-xs text-gray-400 mt-1">{pm.meal.calories} cal per serving</p>)}
                    {pm.status === "planned" && (
                      <button onClick={() => handleCooked(pm)} className="mt-3 text-sm text-green-600 font-medium hover:underline">
                        Mark as Cooked
                      </button>
                    )}
                    {pm.status === "cooked" && (<span className="mt-3 text-sm text-green-600 font-medium block">Cooked!</span>)}
                  </div>
                ))}
              </div>
            )}
          </div>
          {nutrition && (
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-3">This Week's Nutrition</h3>
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900">{nutrition.calories}</p>
                  <p className="text-xs text-gray-500">Total Calories</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900">{nutrition.protein}g</p>
                  <p className="text-xs text-gray-500">Protein</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900">{nutrition.carbs}g</p>
                  <p className="text-xs text-gray-500">Carbs</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900">{nutrition.fat}g</p>
                  <p className="text-xs text-gray-500">Fat</p>
                </div>
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <Link to="/planner" className="text-sm text-blue-600 hover:underline">View Full Plan</Link>
            <Link to="/shopping" className="text-sm text-blue-600 hover:underline">Shopping List</Link>
            <Link to="/chat" className="text-sm text-blue-600 hover:underline">Chat with Assistant</Link>
          </div>
        </div>
      )}
    </div>
  );
}
