import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  Clock,
  Flame,
  Leaf,
  Users,
  CalendarPlus,
  FileText,
  Trash2,
  Camera,
  FileUp,
  RefreshCw,
} from "lucide-react";
import { deleteMeal, getMeal, uploadMealPhoto, uploadMealPdf, extractMealThumbnail, type Meal } from "../api/meals";
import AddToPlanModal from "../components/AddToPlanModal";
import { useToast } from "../components/ui/ToastProvider";
import type { PlannedMeal } from "../api/plans";
import Pill from "../components/ui/Pill";
import PhotoTile from "../components/ui/PhotoTile";
import Button from "../components/ui/Button";
import { toneForMeal } from "../theme/photoTone";

const DAY_LONG: Record<string, string> = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday",
  thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};

function parseInstructions(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw);
      if (Array.isArray(j)) return j.map(String);
    } catch { /* not json */ }
    return raw.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export default function RecipeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meal, setMeal] = useState<Meal | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const toast = useToast();

  useEffect(() => { getMeal(Number(id)).then(setMeal).catch(() => setMeal(null)); }, [id]);

  if (!meal) {
    return <div className="text-ink-3 text-[14px]">Loading recipe…</div>;
  }

  const tone = toneForMeal(meal);
  const instructions = parseInstructions(meal.instructions);
  const hasNutrition = meal.calories != null;
  const hasPdf = !!meal.pdfPath;

  return (
    <div className="flex flex-col gap-6 max-w-[920px]">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => navigate("/recipes")}
          className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink-1"
        >
          <ChevronLeft size={14} /> Back to recipes
        </button>
        <button
          onClick={async () => { await deleteMeal(meal.id); navigate("/recipes"); }}
          className="inline-flex items-center gap-1.5 text-[12px] text-danger hover:underline"
        >
          <Trash2 size={13} /> Delete
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-7 items-start">
        {meal.imagePath ? (
          <img
            src={`/media/meals/${meal.id}/thumb.jpg?v=${meal.updatedAt ?? ""}`}
            alt={meal.name}
            className="w-full aspect-[4/5] object-cover rounded-[18px]"
          />
        ) : (
          <PhotoTile tone={tone} label={meal.name.toLowerCase()} aspect="4 / 5" round={18} />
        )}
        <div className="flex flex-col gap-3.5">
          <div className="flex gap-1.5 flex-wrap">
            {meal.canBatch && (
              <Pill tone="prep" size="md">
                <Flame size={12} />
                Batch Prep
              </Pill>
            )}
            {meal.canFresh && (
              <Pill tone="fresh" size="md">
                <Leaf size={12} />
                Cook Fresh
              </Pill>
            )}
            {meal.tags.map((t) => <Pill key={t} size="md" tone="ghost">{t}</Pill>)}
          </div>
          <h1 className="text-[28px] sm:text-[34px] font-semibold -tracking-[0.025em] text-ink-1 leading-[1.1]">
            {meal.name}
          </h1>
          {meal.description && (
            <p className="text-[15px] text-ink-2 leading-relaxed">{meal.description}</p>
          )}
          <div className="grid grid-cols-3 gap-3 mt-2">
            <MiniStat icon={Clock} label="Prep"   value={`${meal.prepTime ?? 0}m`} />
            <MiniStat icon={Flame} label="Cook"   value={`${meal.cookTime ?? 0}m`} />
            <MiniStat icon={Users} label="Yields" value={`${meal.servings}`} />
          </div>
          {hasNutrition && (
            <div className="grid grid-cols-4 bg-surface-2 rounded-[12px] py-3.5 mt-1">
              {[
                { l: "Cal",     v: meal.calories },
                { l: "Protein", v: `${meal.proteinG ?? 0}g` },
                { l: "Carbs",   v: `${meal.carbsG ?? 0}g` },
                { l: "Fat",     v: `${meal.fatG ?? 0}g` },
              ].map((n, i) => (
                <div key={n.l} className={`text-center ${i > 0 ? "border-l border-line" : ""}`}>
                  <div className="text-[17px] font-semibold text-ink-1">{n.v}</div>
                  <div className="text-[10.5px] text-ink-3 uppercase tracking-[0.07em] mt-0.5">{n.l}</div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 mt-2 flex-wrap">
            <Button variant="primary" icon={CalendarPlus} onClick={() => setAddOpen(true)}>
              Add to plan
            </Button>
            {hasPdf && (
              <Button
                variant="ghost"
                icon={FileText}
                onClick={() => window.open(`/media/meals/${meal.id}/source.pdf`, "_blank", "noopener,noreferrer")}
              >
                Original PDF
              </Button>
            )}
          </div>
          <MealAssetActions meal={meal} onUpdated={setMeal} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-8 mt-2">
        <div>
          <h2 className="text-[18px] font-semibold text-ink-1 -tracking-[0.01em] mb-3.5">Ingredients</h2>
          <ul className="list-none p-0 m-0 flex flex-col">
            {meal.ingredients.map((mi, i) => (
              <li
                key={mi.id ?? i}
                className={`flex items-baseline gap-2.5 py-2.5 text-[14px] ${i < meal.ingredients.length - 1 ? "border-b border-line-soft" : ""}`}
              >
                <span className="font-medium text-ink-1 tabular-nums min-w-[64px]">
                  {mi.quantity} {mi.unit}
                </span>
                <span className="text-ink-1 flex-1">
                  {mi.ingredient?.name ?? "(unknown)"}
                  {mi.preparation && (
                    <span className="text-ink-3 italic">, {mi.preparation}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-[18px] font-semibold text-ink-1 -tracking-[0.01em] mb-3.5">Instructions</h2>
          {instructions.length === 0 ? (
            <p className="text-[13px] text-ink-3">No instructions saved.</p>
          ) : (
            <ol className="list-none p-0 m-0 flex flex-col gap-3.5">
              {instructions.map((step, i) => (
                <li key={i} className="flex gap-3.5">
                  <div className="w-7 h-7 rounded-full bg-accent-soft text-accent-ink grid place-items-center text-[12px] font-semibold flex-shrink-0 tabular-nums">
                    {i + 1}
                  </div>
                  <div className="text-[14.5px] leading-relaxed text-ink-1 pt-1">{step}</div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {addOpen && (
        <AddToPlanModal
          meal={meal}
          onClose={() => setAddOpen(false)}
          onAdded={(pm: PlannedMeal) => {
            toast({
              message: `Added to ${DAY_LONG[pm.day] ?? pm.day} ${pm.mealSlot}`,
              action: { label: "View plan", onClick: () => navigate("/planner") },
            });
          }}
        />
      )}
    </div>
  );
}

function MiniStat({
  icon: Icon, label, value,
}: { icon: import("lucide-react").LucideIcon; label: string; value: string }) {
  return (
    <div className="bg-surface-1 border border-line rounded-[12px] py-2.5 px-3">
      <div className="flex items-center gap-1.5 text-ink-3 text-[11px] uppercase tracking-[0.07em] mb-1">
        <Icon size={12} /> {label}
      </div>
      <div className="text-[17px] font-semibold text-ink-1">{value}</div>
    </div>
  );
}

function MealAssetActions({ meal, onUpdated }: { meal: Meal; onUpdated: (m: Meal) => void }) {
  const photoInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"photo" | "pdf" | "extract" | null>(null);

  const guardAsync = async (label: typeof busy, fn: () => Promise<Meal>) => {
    setBusy(label);
    try {
      onUpdated(await fn());
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex gap-2 flex-wrap mt-2">
      <input
        ref={photoInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) guardAsync("photo", () => uploadMealPhoto(meal.id, f)); }}
      />
      <Button variant="ghost" size="sm" icon={Camera}
        disabled={busy !== null}
        onClick={() => photoInput.current?.click()}
      >
        {busy === "photo" ? "Uploading…" : "Replace photo"}
      </Button>

      <input
        ref={pdfInput}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) guardAsync("pdf", () => uploadMealPdf(meal.id, f)); }}
      />
      <Button variant="ghost" size="sm" icon={FileUp}
        disabled={busy !== null}
        onClick={() => pdfInput.current?.click()}
      >
        {busy === "pdf" ? "Uploading…" : meal.pdfPath ? "Replace PDF" : "Upload PDF"}
      </Button>

      {meal.pdfPath && (
        <Button variant="ghost" size="sm" icon={RefreshCw}
          disabled={busy !== null}
          onClick={async () => {
            if (meal.imageSource === "manual" && !window.confirm("The current photo is manual. Overwrite?")) return;
            const force = meal.imageSource === "manual";
            guardAsync("extract", () => extractMealThumbnail(meal.id, force));
          }}
        >
          {busy === "extract" ? "Re-extracting…" : "Re-run extraction"}
        </Button>
      )}
    </div>
  );
}
