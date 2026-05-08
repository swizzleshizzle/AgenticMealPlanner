import { useState } from "react";
import type { Ingredient } from "../../api/ingredients";
import { updateIngredient } from "../../api/ingredients";
import Button from "../ui/Button";

interface Props {
  ingredient: Ingredient;
  missing: "densityGPerMl" | "gramsPerCount";
  fromUnit: string;
  toUnit: string;
  onResolved: () => void;
  onSkip: () => void;
}

export default function DensityMissingPrompt({ ingredient, missing, fromUnit, toUnit, onResolved, onSkip }: Props) {
  const [value, setValue] = useState("");

  const save = async () => {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) return;
    await updateIngredient(ingredient.id, { [missing]: v } as any);
    onResolved();
  };

  return (
    <div className="bg-surface-2 border border-warn-line rounded-[10px] p-3 flex flex-col gap-2 text-[13px] text-ink-1">
      <div>Need to convert {fromUnit} ↔ {toUnit} for <span className="capitalize">{ingredient.name}</span>.</div>
      <div className="text-[11.5px] text-ink-3">
        Set {missing === "densityGPerMl" ? "density (g per mL)" : "grams per count"} to enable cross-unit math.
      </div>
      <div className="flex items-center gap-2">
        <input type="number" step="0.001" value={value} onChange={(e) => setValue(e.target.value)} placeholder={missing === "densityGPerMl" ? "e.g. 0.529" : "e.g. 50"} className="h-8 w-32 rounded-[8px] border border-line bg-surface-1 px-2 text-[13px]" />
        <Button variant="primary" size="sm" onClick={save}>Save</Button>
        <Button variant="ghost" size="sm" onClick={onSkip}>Skip for now</Button>
      </div>
    </div>
  );
}
