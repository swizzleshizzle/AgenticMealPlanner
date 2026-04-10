import { Link } from "react-router-dom";
import type { Meal } from "../api/meals";

export default function MealCard({ meal }: { meal: Meal }) {
  return (
    <Link
      to={`/recipes/${meal.id}`}
      className="block bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
    >
      {meal.imageUrl && (
        <img src={meal.imageUrl} alt={meal.name} className="w-full h-40 object-cover" />
      )}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            meal.mealType === "batch_prep"
              ? "bg-purple-100 text-purple-700"
              : "bg-green-100 text-green-700"
          }`}>
            {meal.mealType === "batch_prep" ? "Batch Prep" : "Cook Fresh"}
          </span>
        </div>
        <h3 className="font-semibold text-gray-900">{meal.name}</h3>
        {meal.description && (
          <p className="text-sm text-gray-500 mt-1 line-clamp-2">{meal.description}</p>
        )}
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
          <span>{meal.servings} servings</span>
          {meal.prepTime && <span>{meal.prepTime}m prep</span>}
          {meal.cookTime && <span>{meal.cookTime}m cook</span>}
          {meal.calories && <span>{meal.calories} cal</span>}
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {meal.tags.map((tag) => (
            <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}
