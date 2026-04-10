import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getMeal, deleteMeal, type Meal } from "../api/meals";

export default function RecipeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meal, setMeal] = useState<Meal | null>(null);

  useEffect(() => { getMeal(Number(id)).then(setMeal); }, [id]);

  if (!meal) return <p className="text-gray-400">Loading...</p>;

  const instructions = typeof meal.instructions === "string" ? JSON.parse(meal.instructions) : meal.instructions;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">{meal.name}</h2>
        <button onClick={async () => { await deleteMeal(meal.id); navigate("/recipes"); }} className="text-red-600 text-sm hover:underline">Delete</button>
      </div>
      <div className="flex gap-2 mb-4">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${meal.mealType === "batch_prep" ? "bg-purple-100 text-purple-700" : "bg-green-100 text-green-700"}`}>
          {meal.mealType === "batch_prep" ? "Batch Prep" : "Cook Fresh"}
        </span>
        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{meal.servings} servings</span>
        {meal.prepTime && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{meal.prepTime}m prep</span>}
        {meal.cookTime && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{meal.cookTime}m cook</span>}
      </div>
      {meal.description && <p className="text-gray-600 mb-6">{meal.description}</p>}
      {meal.calories && (
        <div className="grid grid-cols-4 gap-4 mb-6 bg-gray-50 rounded-lg p-4">
          <div className="text-center"><p className="text-lg font-bold text-gray-900">{meal.calories}</p><p className="text-xs text-gray-500">Calories</p></div>
          <div className="text-center"><p className="text-lg font-bold text-gray-900">{meal.proteinG}g</p><p className="text-xs text-gray-500">Protein</p></div>
          <div className="text-center"><p className="text-lg font-bold text-gray-900">{meal.carbsG}g</p><p className="text-xs text-gray-500">Carbs</p></div>
          <div className="text-center"><p className="text-lg font-bold text-gray-900">{meal.fatG}g</p><p className="text-xs text-gray-500">Fat</p></div>
        </div>
      )}
      <h3 className="font-semibold text-gray-900 mb-3">Ingredients</h3>
      <ul className="space-y-1 mb-6">
        {meal.ingredients.map((mi) => (
          <li key={mi.id} className="text-sm text-gray-700">
            {mi.quantity} {mi.unit} {mi.ingredient.name}
            {mi.preparation && <span className="text-gray-400"> ({mi.preparation})</span>}
          </li>
        ))}
      </ul>
      <h3 className="font-semibold text-gray-900 mb-3">Instructions</h3>
      <ol className="space-y-2">
        {(Array.isArray(instructions) ? instructions : []).map((step: string, i: number) => (
          <li key={i} className="text-sm text-gray-700 flex gap-3">
            <span className="font-medium text-gray-400 shrink-0">{i + 1}.</span>{step}
          </li>
        ))}
      </ol>
    </div>
  );
}
