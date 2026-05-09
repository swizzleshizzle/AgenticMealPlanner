import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { Ingredient } from "../../api/ingredients";
import { getIngredients } from "../../api/ingredients";

interface Props {
  /** ingredientIds already on the list — excluded from the typeahead so the modal can't dedupe a server-side 400. */
  excludeIds: number[];
  onPick: (ingredient: Ingredient) => void;
}

export default function AddIngredientRow({ excludeIds, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || ingredients.length > 0) return;
    getIngredients().then(setIngredients).catch(() => setIngredients([]));
  }, [open, ingredients.length]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const filtered = useMemo(() => {
    const exclude = new Set(excludeIds);
    const q = query.trim().toLowerCase();
    return ingredients
      .filter((i) => !exclude.has(i.id))
      .filter((i) => !q || i.name.toLowerCase().includes(q))
      .slice(0, 12);
  }, [ingredients, query, excludeIds]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2.5 w-full text-left px-1 py-3 text-[13px] text-ink-3 hover:bg-surface-2 hover:text-ink-1 border-b border-line-soft"
      >
        <span className="w-4 h-4 inline-flex items-center justify-center rounded-[4px] border border-dashed border-line">
          <Plus size={11} />
        </span>
        Add ingredient…
      </button>
    );
  }

  return (
    <div className="border-b border-line-soft py-2 px-1 flex flex-col gap-2">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search ingredients…"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
          }
        }}
        className="px-2.5 py-1.5 text-[13px] bg-surface-2 border border-line rounded-[6px] text-ink-1 focus:outline-none focus:border-accent"
      />
      {filtered.length > 0 && (
        <div className="max-h-[160px] overflow-y-auto flex flex-col">
          {filtered.map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => {
                onPick(i);
                setQuery("");
                setOpen(false);
              }}
              className="text-left px-2.5 py-1.5 text-[13px] text-ink-1 hover:bg-surface-2 rounded-[4px]"
            >
              {i.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
