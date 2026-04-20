import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  Clock,
  Flame,
  Leaf,
  Users,
  CalendarPlus,
  Replace,
  FileText,
  Trash2,
  X,
  ExternalLink,
} from "lucide-react";
import { deleteMeal, getMeal, type Meal } from "../api/meals";
import Pill from "../components/ui/Pill";
import PhotoTile from "../components/ui/PhotoTile";
import Button from "../components/ui/Button";
import { PHOTO_TONES, toneForMeal, type PhotoToneName } from "../theme/photoTone";

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
  const [pdfOpen, setPdfOpen] = useState(false);

  useEffect(() => { getMeal(Number(id)).then(setMeal).catch(() => setMeal(null)); }, [id]);

  if (!meal) {
    return <div className="text-ink-3 text-[14px]">Loading recipe…</div>;
  }

  const isPrep = meal.mealType === "batch_prep";
  const tone = toneForMeal(meal);
  const instructions = parseInstructions(meal.instructions);
  const hasNutrition = meal.calories != null;
  const hasPdf = meal.source === "hello_fresh" || !!meal.imageUrl;

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
        <PhotoTile tone={tone} label={meal.name.toLowerCase()} aspect="4 / 5" round={18} />
        <div className="flex flex-col gap-3.5">
          <div className="flex gap-1.5 flex-wrap">
            <Pill tone={isPrep ? "prep" : "fresh"} size="md">
              {isPrep ? <Flame size={12} /> : <Leaf size={12} />}
              {isPrep ? "Batch Prep" : "Cook Fresh"}
            </Pill>
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
            <Button variant="primary" icon={CalendarPlus}>Add to plan</Button>
            <Button variant="ghost" icon={Replace}>Scale servings</Button>
            {hasPdf && (
              <Button variant="ghost" icon={FileText} onClick={() => setPdfOpen(true)}>
                Original PDF
              </Button>
            )}
          </div>
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

      {pdfOpen && hasPdf && <PdfViewer meal={meal} onClose={() => setPdfOpen(false)} />}
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

function PdfViewer({ meal, onClose }: { meal: Meal; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const tone = toneForMeal(meal);
  const filename = (meal.imageUrl?.split("/").pop()) ?? `${meal.name.toLowerCase().replace(/\s+/g, "-")}.pdf`;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8 amp-fade-in"
      style={{ background: "rgba(30, 22, 10, 0.55)", backdropFilter: "blur(4px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-1 rounded-[16px] w-full max-w-[880px] max-h-[90vh] flex flex-col overflow-hidden border border-line"
        style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
      >
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-line-soft">
          <div className="w-8 h-8 rounded-[8px] bg-accent-soft text-accent-ink grid place-items-center">
            <FileText size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-ink-1 truncate">{filename}</div>
            <div className="text-[11px] text-ink-3 truncate">
              Original recipe card · {meal.source === "hello_fresh" ? "HelloFresh" : "Uploaded"}
            </div>
          </div>
          <Button variant="ghost" size="sm" icon={ExternalLink}>Open</Button>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 grid place-items-center rounded-[8px] text-ink-2 hover:bg-surface-2"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-auto bg-surface-2 p-4 sm:p-8 flex justify-center">
          <RecipeCardPaper meal={meal} tone={tone} />
        </div>
      </div>
    </div>
  );
}

function RecipeCardPaper({ meal, tone }: { meal: Meal; tone: PhotoToneName }) {
  const [a, b] = PHOTO_TONES[tone];
  const totalTime = (meal.prepTime ?? 0) + (meal.cookTime ?? 0);
  const instructions = parseInstructions(meal.instructions);
  return (
    <div
      className="w-full max-w-[620px] flex flex-col gap-4 p-8 sm:p-12"
      style={{
        aspectRatio: "8.5 / 11",
        background: "#FEFCF7",
        borderRadius: 4,
        boxShadow: "0 8px 28px rgba(0,0,0,0.12)",
        fontFamily: "Georgia, serif",
        color: "#2a2418",
      }}
    >
      <div className="flex justify-between text-[10px] uppercase tracking-[0.15em]" style={{ color: "#8a7555" }}>
        <span>Recipe Card</span>
        <span>#{String(meal.id).padStart(3, "0")}</span>
      </div>
      <div
        className="w-full grid place-items-center text-[10px] uppercase tracking-[0.1em] font-mono"
        style={{
          aspectRatio: "3/2",
          borderRadius: 4,
          background: `linear-gradient(135deg, ${a} 0%, ${b} 100%)`,
          color: "rgba(50,35,20,0.55)",
        }}
      >
        [ photo ]
      </div>
      <h1 className="m-0 text-[24px] sm:text-[26px] font-semibold leading-tight">{meal.name}</h1>
      <div className="flex gap-4 sm:gap-5 text-[11px] py-2 border-t border-b" style={{ color: "#8a7555", borderColor: "#e6dcc5" }}>
        {totalTime > 0 && <span><strong style={{ color: "#2a2418" }}>{totalTime}m</strong> total</span>}
        <span><strong style={{ color: "#2a2418" }}>{meal.servings}</strong> servings</span>
        {meal.calories && <span><strong style={{ color: "#2a2418" }}>{meal.calories}</strong> cal</span>}
      </div>
      {meal.description && (
        <p className="text-[13px] leading-relaxed m-0 italic" style={{ color: "#5a4d35" }}>
          {meal.description}
        </p>
      )}
      <div className="grid grid-cols-[1fr_1.3fr] gap-6">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] mb-2" style={{ color: "#8a7555" }}>Ingredients</div>
          {meal.ingredients.map((mi, i) => (
            <div key={i} className="text-[12px] leading-[1.7] py-[2px]" style={{ borderBottom: "1px dotted #d6cbac" }}>
              <strong>{mi.quantity} {mi.unit}</strong> {mi.ingredient?.name}
              {mi.preparation && <em style={{ color: "#8a7555" }}>, {mi.preparation}</em>}
            </div>
          ))}
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] mb-2" style={{ color: "#8a7555" }}>Method</div>
          <ol className="pl-4 m-0 text-[12px] leading-relaxed">
            {instructions.map((s, i) => <li key={i} className="mb-1.5">{s}</li>)}
          </ol>
        </div>
      </div>
      <div className="mt-auto pt-3 text-[9.5px] uppercase tracking-[0.08em] flex justify-between" style={{ color: "#a89678" }}>
        <span>{meal.source === "hello_fresh" ? "HelloFresh" : "Self-sourced"}</span>
        <span>Page 1 of 1</span>
      </div>
    </div>
  );
}
