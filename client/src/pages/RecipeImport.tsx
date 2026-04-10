import { useState } from "react";
import { useNavigate } from "react-router-dom";
import FileUpload from "../components/FileUpload";
import MealForm from "../components/MealForm";
import { importRecipe, createMeal } from "../api/meals";

export default function RecipeImport() {
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<any>(null);
  const [ingredientMap, setIngredientMap] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleFile = async (file: File) => {
    setParsing(true);
    setError(null);
    try {
      const result = await importRecipe(file);
      setParsed(result.parsed);
      setIngredientMap(result.ingredientMap);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setParsing(false);
    }
  };

  const handleSave = async (formData: any) => {
    const mealData = {
      ...formData,
      source: "hello_fresh",
      ingredients: formData.ingredients?.map((ing: any) => ({
        ingredientId: ingredientMap[ing.name],
        quantity: ing.quantity,
        unit: ing.unit,
        preparation: ing.preparation,
      })),
    };
    await createMeal(mealData);
    navigate("/recipes");
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Import Recipe</h2>
      {!parsed && !parsing && (
        <FileUpload onFile={handleFile} accept=".pdf,.png,.jpg,.jpeg,.webp" />
      )}
      {parsing && (
        <div className="text-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-500">Parsing recipe with AI... this may take a moment.</p>
        </div>
      )}
      {error && (<div className="bg-red-50 text-red-700 p-4 rounded-lg mb-4">{error}</div>)}
      {parsed && (
        <div>
          <p className="text-sm text-gray-500 mb-4">Review the parsed recipe and make corrections before saving.</p>
          <MealForm initialData={parsed} onSubmit={handleSave} submitLabel="Save to Library" />
        </div>
      )}
    </div>
  );
}
