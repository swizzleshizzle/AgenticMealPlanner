import { useState, useEffect } from "react";
import { getPlans, type WeeklyPlan } from "../api/plans";
import { getShoppingList, generateShoppingList, toggleItem, type ShoppingItem } from "../api/shopping";
import ShoppingItemRow from "../components/ShoppingItemRow";

export default function ShoppingList() {
  const [activePlan, setActivePlan] = useState<WeeklyPlan | null>(null);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    getPlans().then((plans) => {
      const active = plans.find((p) => p.status === "active");
      if (active) {
        setActivePlan(active);
        getShoppingList(active.id).then(setItems);
      }
    });
  }, []);

  const handleGenerate = async () => {
    if (!activePlan) return;
    setGenerating(true);
    try {
      const list = await generateShoppingList(activePlan.id);
      setItems(list);
    } finally {
      setGenerating(false);
    }
  };

  const handleToggle = async (id: number, checked: boolean) => {
    await toggleItem(id, checked);
    if (activePlan) {
      const updated = await getShoppingList(activePlan.id);
      setItems(updated);
    }
  };

  const unchecked = items.filter((i) => !i.checked && i.quantityToBuy > 0);
  const checked = items.filter((i) => i.checked);
  const alreadyHave = items.filter((i) => !i.checked && i.quantityToBuy === 0);

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Shopping List</h2>
        {activePlan && (
          <button onClick={handleGenerate} disabled={generating}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {generating ? "Generating..." : items.length ? "Regenerate" : "Generate List"}
          </button>
        )}
      </div>
      {!activePlan && (<p className="text-gray-500 text-center py-12">No active meal plan. Create one in the Planner first.</p>)}
      {unchecked.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 px-4 mb-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide py-3">To Buy</h3>
          {unchecked.map((item) => (<ShoppingItemRow key={item.id} item={item} onToggle={handleToggle} />))}
        </div>
      )}
      {alreadyHave.length > 0 && (
        <div className="bg-green-50 rounded-xl border border-green-200 px-4 mb-6">
          <h3 className="text-sm font-semibold text-green-600 uppercase tracking-wide py-3">Already Have</h3>
          {alreadyHave.map((item) => (<ShoppingItemRow key={item.id} item={item} onToggle={handleToggle} />))}
        </div>
      )}
      {checked.length > 0 && (
        <div className="opacity-60 bg-white rounded-xl border border-gray-200 px-4">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide py-3">Done</h3>
          {checked.map((item) => (<ShoppingItemRow key={item.id} item={item} onToggle={handleToggle} />))}
        </div>
      )}
    </div>
  );
}
