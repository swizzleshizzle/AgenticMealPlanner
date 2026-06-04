import { useState } from "react";
import type { PantryCard } from "../../api/pantry";
import type { Ingredient } from "../../api/ingredients";
import ConfirmRow, { type ConfirmRowState } from "./ConfirmRow";
import AddIngredientRow from "./AddIngredientRow";

interface Props {
  rows: ConfirmRowState[];
  cards: PantryCard[]; // pantry items with stock, for the re-point picker
  onChangeRow: (key: string, patch: Partial<ConfirmRowState>) => void;
  onRepoint: (key: string, ingredient: Ingredient, card: PantryCard | undefined) => void;
}

function unitOptionsFor(card: PantryCard | undefined, current: string): string[] {
  const units = new Set<string>([current]);
  card?.totalsByUnit.forEach((t) => units.add(t.unit));
  if (card) units.add(card.ingredient.defaultUnit);
  return Array.from(units);
}

export default function ConfirmStep({ rows, cards, onChangeRow, onRepoint }: Props) {
  const [pickingKey, setPickingKey] = useState<string | null>(null);
  const cardById = new Map(cards.map((c) => [c.ingredient.id, c]));

  return (
    <div className="flex flex-col">
      {rows.map((r) => (
        <div key={r.key}>
          <ConfirmRow
            row={r}
            unitOptions={unitOptionsFor(r.matchedIngredientId != null ? cardById.get(r.matchedIngredientId) : undefined, r.deductUnit)}
            onChange={(patch) => onChangeRow(r.key, patch)}
            onPick={() => setPickingKey(pickingKey === r.key ? null : r.key)}
          />
          {pickingKey === r.key && (
            <div className="pl-7 pb-2">
              <AddIngredientRow
                excludeIds={[]}
                onPick={(ing) => {
                  onRepoint(r.key, ing, cardById.get(ing.id));
                  setPickingKey(null);
                }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
