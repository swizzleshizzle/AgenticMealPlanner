import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, CheckCircle2, Check } from "lucide-react";
import { createMeal, importRecipe } from "../api/meals";
import Button from "../components/ui/Button";
import MealForm from "../components/MealForm";

export default function RecipeImport() {
  const [stage, setStage] = useState<"upload" | "parsing" | "review" | "error">("upload");
  const [parsed, setParsed] = useState<any>(null);
  const [ingredientMap, setIngredientMap] = useState<Record<string, number>>({});
  const [importSessionId, setImportSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const handleFile = async (file: File) => {
    setStage("parsing");
    setError(null);
    try {
      const result = await importRecipe(file);
      setParsed(result.parsed);
      setIngredientMap(result.ingredientMap);
      setImportSessionId(result.importSessionId);
      setStage("review");
    } catch (e: any) {
      setError(e?.message ?? "Import failed");
      setStage("error");
    }
  };

  const handleSave = async (formData: any) => {
    const data = {
      ...formData,
      source: "hello_fresh",
      importSessionId,
      ingredients: formData.ingredients?.map((ing: any) => ({
        ingredientId: ingredientMap[ing.name],
        quantity: ing.quantity,
        unit: ing.unit,
        preparation: ing.preparation,
      })),
    };
    await createMeal(data);
    navigate("/recipes");
  };

  return (
    <div className="flex flex-col gap-5 max-w-[720px]">
      <div>
        <div className="text-[12px] uppercase tracking-[0.1em] text-ink-3 mb-1.5">
          AI-powered import
        </div>
        <h1 className="text-[26px] sm:text-[30px] font-semibold -tracking-[0.02em] text-ink-1">
          Import a recipe
        </h1>
        <p className="text-[14px] text-ink-2 mt-2">
          Drop a HelloFresh recipe card PDF or a photo. Claude will extract the ingredients, steps, and nutrition.
        </p>
      </div>

      {stage === "upload" && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <button
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            className={`flex flex-col items-center gap-3.5 py-12 sm:py-14 px-6 border-2 border-dashed rounded-[16px] bg-surface-1 text-center transition cursor-pointer ${
              dragOver ? "border-accent bg-accent-soft" : "border-line hover:border-accent-line"
            }`}
          >
            <div className="w-13 h-13 sm:w-14 sm:h-14 rounded-[14px] bg-accent-soft text-accent-ink grid place-items-center">
              <Upload size={22} />
            </div>
            <div>
              <div className="text-[15px] font-semibold text-ink-1">Drop a file here, or click to browse</div>
              <div className="text-[13px] text-ink-3 mt-1">PDF, PNG, JPG up to 10MB</div>
            </div>
          </button>
        </>
      )}

      {stage === "parsing" && (
        <div className="bg-surface-1 border border-line rounded-[16px] py-12 sm:py-14 px-6 text-center">
          <div
            className="w-11 h-11 mx-auto mb-4 rounded-full amp-spin"
            style={{
              borderWidth: 3,
              borderStyle: "solid",
              borderColor: "var(--accent-soft)",
              borderTopColor: "var(--accent)",
            }}
          />
          <div className="text-[15px] font-semibold text-ink-1 mb-1">Reading your recipe…</div>
          <div className="text-[13px] text-ink-3">Identifying ingredients, steps, and nutrition. ~20 seconds.</div>
        </div>
      )}

      {stage === "error" && (
        <div className="bg-warn-soft border border-warn-line rounded-[14px] p-4 text-warn-ink text-[13px]">
          {error ?? "Something went wrong."}
          <div className="mt-3">
            <Button variant="ghost" size="sm" onClick={() => setStage("upload")}>Try again</Button>
          </div>
        </div>
      )}

      {stage === "review" && parsed && (
        <div className="flex flex-col gap-4 amp-fade-in">
          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] bg-accent-soft border border-accent-line text-accent-ink text-[13px]">
            <CheckCircle2 size={15} />
            Parsed successfully. Review and save to your library.
          </div>
          <div className="bg-surface-1 border border-line rounded-[14px] p-5">
            <MealForm initialData={parsed} onSubmit={handleSave} submitLabel="Save to Library" />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="ghost" icon={Check} onClick={() => setStage("upload")}>
              Start over
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
