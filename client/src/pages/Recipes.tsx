import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Flame, Leaf, Upload } from "lucide-react";
import { getMeals, type Meal } from "../api/meals";
import MealCard from "../components/MealCard";
import Button from "../components/ui/Button";

const FILTERS = [
  { k: "all", label: "All", icon: null as null | typeof Flame },
  { k: "canBatch", label: "Batch-able", icon: Flame },
  { k: "canFresh", label: "Fresh-able", icon: Leaf },
] as const;

export default function Recipes() {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [tag, setTag] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => { getMeals().then(setMeals).catch(() => setMeals([])); }, []);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const m of meals) for (const t of m.tags) s.add(t);
    return [...s];
  }, [meals]);

  const filtered = meals.filter((m) => {
    if (filter === "canBatch" && !m.canBatch) return false;
    if (filter === "canFresh" && !m.canFresh) return false;
    if (tag && !m.tags.includes(tag)) return false;
    const s = search.toLowerCase().trim();
    if (s && !m.name.toLowerCase().includes(s) && !m.tags.some((t) => t.toLowerCase().includes(s))) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-7">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[12px] uppercase tracking-[0.1em] text-ink-3 mb-1.5">
            Library · {meals.length} recipe{meals.length === 1 ? "" : "s"}
          </div>
          <h1 className="text-[26px] sm:text-[30px] font-semibold -tracking-[0.02em] text-ink-1">Recipes</h1>
        </div>
        <Button variant="primary" icon={Upload} onClick={() => navigate("/recipes/import")}>
          Import recipe
        </Button>
      </div>

      <div className="flex gap-2.5 items-center flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[220px] bg-surface-1 border border-line rounded-[12px] h-[42px] px-3.5">
          <Search size={16} className="text-ink-3" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipes or tags…"
            className="flex-1 bg-transparent border-0 outline-none text-[14px] text-ink-1 placeholder:text-ink-3"
          />
        </div>
        <div className="flex gap-1 bg-surface-2 p-1 rounded-[12px]">
          {FILTERS.map((f) => {
            const Icon = f.icon;
            const active = filter === f.k;
            return (
              <button
                key={f.k}
                onClick={() => setFilter(f.k)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[13px] transition ${
                  active
                    ? "bg-surface-1 text-ink-1 font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                    : "text-ink-2 font-medium hover:text-ink-1"
                }`}
              >
                {Icon && <Icon size={12} />}
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 -mt-2">
          {allTags.map((t) => {
            const active = tag === t;
            return (
              <button
                key={t}
                onClick={() => setTag(active ? null : t)}
                className={`text-[12px] px-3 py-[4px] rounded-full font-medium border transition ${
                  active
                    ? "bg-accent text-accent-on border-accent"
                    : "bg-surface-1 text-ink-2 border-line hover:border-accent-line"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-[14px] text-ink-3">
          {meals.length === 0 ? "No recipes yet. Import your first recipe to get started." : "No recipes match. Try clearing filters."}
        </div>
      ) : (
        <div className="grid gap-4 sm:gap-4.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))" }}>
          {filtered.map((m) => <MealCard key={m.id} meal={m} />)}
        </div>
      )}
    </div>
  );
}
