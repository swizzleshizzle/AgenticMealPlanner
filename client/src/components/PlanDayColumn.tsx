import type { PlannedMeal } from "../api/plans";

interface Props {
  day: string;
  meals: PlannedMeal[];
  onMarkCooked: (id: number) => void;
  onSkip: (id: number) => void;
}

const slotOrder = ["breakfast", "lunch", "dinner"];

export default function PlanDayColumn({ day, meals, onMarkCooked, onSkip }: Props) {
  const sorted = [...meals].sort((a, b) => slotOrder.indexOf(a.mealSlot) - slotOrder.indexOf(b.mealSlot));

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 min-w-[180px]">
      <h3 className="font-semibold text-gray-900 capitalize mb-3">{day}</h3>
      {sorted.length === 0 ? (
        <p className="text-xs text-gray-400">No meals planned</p>
      ) : (
        <div className="space-y-3">
          {sorted.map((pm) => (
            <div key={pm.id} className={`rounded-lg p-3 text-sm ${
              pm.status === "cooked" ? "bg-green-50 border border-green-200" :
              pm.status === "skipped" ? "bg-gray-50 border border-gray-200 opacity-50" :
              "bg-blue-50 border border-blue-200"
            }`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-500 uppercase">{pm.mealSlot}</span>
                {pm.cookStyle === "batch_prep" && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">Prep</span>}
                {pm.cookStyle === "leftovers"  && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Leftovers</span>}
              </div>
              <p className="font-medium text-gray-900">{pm.meal.name}</p>
              <p className="text-xs text-gray-400">{pm.servings} servings</p>
              {pm.status === "planned" && (
                <div className="flex gap-2 mt-2">
                  <button onClick={() => onMarkCooked(pm.id)} className="text-xs text-green-600 hover:underline">Cooked</button>
                  <button onClick={() => onSkip(pm.id)} className="text-xs text-gray-400 hover:underline">Skip</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
