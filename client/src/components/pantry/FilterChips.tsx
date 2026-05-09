// client/src/components/pantry/FilterChips.tsx
import { Search } from "lucide-react";
import type { PantryQuery, PantryLocation } from "../../api/pantry";
import type { IngredientCategory } from "../../api/ingredients";

const LOCATIONS: Array<PantryLocation | "all"> = ["all", "fridge", "freezer", "pantry"];
const CATEGORIES: Array<IngredientCategory | "all"> = [
  "all", "produce", "protein", "dairy", "pantry_staple", "grain", "spice", "condiment", "frozen", "other",
];
const CATEGORY_LABELS: Record<string, string> = {
  all: "All",
  produce: "Produce",
  protein: "Protein",
  dairy: "Dairy",
  pantry_staple: "Pantry",
  grain: "Grains",
  spice: "Spices",
  condiment: "Condiments",
  frozen: "Frozen",
  other: "Other",
};

const SORTS: Array<{ value: NonNullable<PantryQuery["sort"]>; label: string }> = [
  { value: "name", label: "Name" },
  { value: "expiring", label: "Expiring soon" },
  { value: "added", label: "Recently added" },
  { value: "lowstock", label: "Low stock first" },
];

interface Props {
  value: PantryQuery;
  onChange: (next: PantryQuery) => void;
}

export default function FilterChips({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          type="search"
          value={value.q ?? ""}
          onChange={(e) => onChange({ ...value, q: e.target.value || undefined })}
          placeholder="Search…"
          className="h-9 w-48 rounded-[10px] border border-line bg-surface-2 pl-8 pr-3 text-[13px] text-ink-1 placeholder:text-ink-3 focus:outline-none focus:border-accent"
        />
      </label>

      <select
        value={value.location ?? "all"}
        onChange={(e) => onChange({ ...value, location: e.target.value === "all" ? undefined : (e.target.value as PantryLocation) })}
        className="h-9 rounded-[10px] border border-line bg-surface-2 px-2.5 text-[13px] text-ink-1 focus:outline-none focus:border-accent capitalize"
      >
        {LOCATIONS.map((l) => <option key={l} value={l}>{l === "all" ? "All locations" : l}</option>)}
      </select>

      <select
        value={value.category ?? "all"}
        onChange={(e) => onChange({ ...value, category: e.target.value === "all" ? undefined : e.target.value })}
        className="h-9 rounded-[10px] border border-line bg-surface-2 px-2.5 text-[13px] text-ink-1 focus:outline-none focus:border-accent"
      >
        {CATEGORIES.map((c) => <option key={c} value={c}>{c === "all" ? "All categories" : CATEGORY_LABELS[c]}</option>)}
      </select>

      <select
        value={value.sort ?? "name"}
        onChange={(e) => onChange({ ...value, sort: e.target.value as PantryQuery["sort"] })}
        className="h-9 rounded-[10px] border border-line bg-surface-2 px-2.5 text-[13px] text-ink-1 focus:outline-none focus:border-accent"
      >
        {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>

      <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
        <input
          type="checkbox"
          checked={!!value.lowOnly}
          onChange={(e) => onChange({ ...value, lowOnly: e.target.checked || undefined })}
        />
        Running low only
      </label>
    </div>
  );
}
