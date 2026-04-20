import { Link } from "react-router-dom";
import { Clock, Users, Flame, Leaf } from "lucide-react";
import type { Meal } from "../api/meals";
import Pill from "./ui/Pill";
import PhotoTile from "./ui/PhotoTile";
import { toneForMeal } from "../theme/photoTone";

interface Props {
  meal: Meal;
  photos?: boolean;
  compact?: boolean;
  to?: string;
}

export default function MealCard({ meal, photos = true, compact = false, to }: Props) {
  const isPrep = meal.mealType === "batch_prep";
  const tone = toneForMeal(meal);
  const totalTime = (meal.prepTime || 0) + (meal.cookTime || 0);

  return (
    <Link
      to={to ?? `/recipes/${meal.id}`}
      className="flex flex-col bg-surface-1 border border-line rounded-[14px] overflow-hidden text-left shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] hover:-translate-y-[2px] transition motion-reduce:transition-none"
    >
      {photos && <PhotoTile tone={tone} label={meal.name.toLowerCase()} aspect="16 / 10" round={0} />}
      <div className={`flex flex-col gap-2 ${compact ? "p-3.5" : "p-4"}`}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Pill tone={isPrep ? "prep" : "fresh"} size="sm">
            {isPrep ? <Flame size={11} /> : <Leaf size={11} />}
            {isPrep ? "Batch Prep" : "Cook Fresh"}
          </Pill>
          {!photos && meal.tags.slice(0, 1).map((t) => (
            <Pill key={t} size="sm" tone="ghost">{t}</Pill>
          ))}
        </div>
        <h3 className="text-[16px] font-semibold text-ink-1 -tracking-[0.01em] leading-tight">
          {meal.name}
        </h3>
        {!compact && meal.description && (
          <p className="text-[13px] text-ink-2 leading-snug line-clamp-2">{meal.description}</p>
        )}
        <div className="flex gap-3.5 text-[12px] text-ink-3 mt-0.5 flex-wrap">
          {totalTime > 0 && (
            <span className="inline-flex items-center gap-1">
              <Clock size={12} /> {totalTime}m
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Users size={12} /> {meal.servings}
          </span>
          {meal.calories && <span>{meal.calories} cal</span>}
        </div>
        {photos && meal.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {meal.tags.slice(0, 3).map((t) => (
              <Pill key={t} size="sm" tone="ghost">{t}</Pill>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
