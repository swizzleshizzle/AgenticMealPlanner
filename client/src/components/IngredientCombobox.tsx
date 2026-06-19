import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Ingredient } from "../api/ingredients";
import { filterIngredients } from "../lib/ingredientSearch";

interface Props {
  /** Current match, or null when the row will create a new ingredient. */
  matchedIngredient: { id: number; name: string } | null;
  /** Low-confidence parse match → warn styling on the input. */
  lowConfidence: boolean;
  /** The row's parsedName (shown when unmatched; preserved on pick). */
  parsedName: string;
  ingredients: Ingredient[];
  disabled: boolean;
  onPick: (ingredient: Ingredient) => void;
  /** User typed free text: parsedName = text, match cleared. */
  onText: (text: string) => void;
  onClear: () => void;
}

export default function IngredientCombobox({
  matchedIngredient, lowConfidence, parsedName, ingredients, disabled, onPick, onText, onClear,
}: Props) {
  // Display text: matched name when matched, parsedName when not.
  const [text, setText] = useState(matchedIngredient?.name ?? parsedName);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Re-sync display when the match changes from outside (pick/clear).
  // Deps are the match id only: this relies on the parent nulling the match on
  // every keystroke (onText), so same-ingredient re-picks still edge the id
  // through undefined. If the parent ever stops doing that, resync breaks.
  useEffect(() => {
    setText(matchedIngredient?.name ?? parsedName);
  }, [matchedIngredient?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close the dropdown if the row becomes disabled mid-interaction.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const results = useMemo(
    () => (open ? filterIngredients(text, ingredients) : []),
    [open, text, ingredients],
  );

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0">
      <div className="flex items-center gap-1">
        <input
          value={text}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            onText(e.target.value); // typing always means: free text, match cleared
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && open) {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          className={`h-8 w-full min-w-0 rounded-[8px] border px-2 text-[12.5px] text-ink-1 focus:outline-none focus:border-accent disabled:opacity-50 ${
            matchedIngredient
              ? lowConfidence
                ? "border-warn-line bg-warn-soft"
                : "border-accent-line bg-accent-soft"
              : "border-line bg-surface-1"
          }`}
        />
        {matchedIngredient && !disabled && (
          <button
            type="button"
            onClick={onClear}
            title="Clear match"
            className="shrink-0 w-5 h-5 grid place-items-center rounded-[4px] text-ink-3 hover:text-ink-1 hover:bg-surface-2"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 left-0 right-0 max-h-[180px] overflow-y-auto rounded-[8px] border border-line bg-surface-1 shadow-lg flex flex-col p-1">
          {results.map((i) => (
            <button
              key={i.id}
              type="button"
              onMouseDown={(e) => e.preventDefault() /* keep input focus */}
              onClick={() => { onPick(i); setOpen(false); }}
              className="text-left px-2 py-1.5 text-[12.5px] text-ink-1 hover:bg-surface-2 rounded-[4px]"
            >
              {i.name}
            </button>
          ))}
        </div>
      )}

      {!matchedIngredient && !disabled && (
        <div className="text-[10.5px] text-ink-3 mt-0.5 truncate">
          will create &ldquo;{text || parsedName}&rdquo;
        </div>
      )}
    </div>
  );
}
