import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getMeals, type Meal } from "../api/meals";
import MealCard from "../components/MealCard";

export default function Recipes() {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    getMeals().then(setMeals);
  }, []);

  const filtered = meals.filter((m) => {
    const matchesSearch = m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));
    const matchesFilter = filter === "all" || m.mealType === filter;
    return matchesSearch && matchesFilter;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Recipes</h2>
        <Link to="/recipes/import" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          Import Recipe
        </Link>
      </div>
      <div className="flex gap-3 mb-6">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search recipes or tags..."
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <select value={filter} onChange={(e) => setFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="all">All Types</option>
          <option value="batch_prep">Batch Prep</option>
          <option value="cook_fresh">Cook Fresh</option>
        </select>
      </div>
      {filtered.length === 0 ? (
        <p className="text-gray-500 text-center py-12">No recipes yet. Import your first Hello Fresh recipe!</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((meal) => (<MealCard key={meal.id} meal={meal} />))}
        </div>
      )}
    </div>
  );
}
