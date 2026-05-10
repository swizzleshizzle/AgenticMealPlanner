import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Save, GitBranch, GitCommit } from "lucide-react";
import {
  getMeal, getIngredients, createMeal, updateMeal, supersedeMeal, createVariant,
  type Meal, type Ingredient,
} from "../api/meals";
import { apiFetch } from "../api/client";
import MealForm, { type MealFormData } from "../components/MealForm";
import Button from "../components/ui/Button";

type Mode = "new" | "edit" | "variant";

interface Props { mode: Mode; }

function instructionsArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try { const j = JSON.parse(raw); if (Array.isArray(j)) return j.map(String); } catch {}
    return raw.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function mealToForm(m: Meal): Partial<MealFormData> {
  return {
    name: m.name,
    description: m.description,
    canBatch: m.canBatch,
    canFresh: m.canFresh,
    servings: m.servings,
    prepTime: m.prepTime,
    cookTime: m.cookTime,
    tags: m.tags,
    instructions: instructionsArray(m.instructions),
    calories: m.calories,
    proteinG: m.proteinG,
    carbsG:   m.carbsG,
    fatG:     m.fatG,
    fiberG:   m.fiberG,
    sodiumMg: m.sodiumMg,
    ingredients: m.ingredients.map((mi) => ({
      ingredientId: mi.ingredient.id,
      name:         mi.ingredient.name,
      quantity:     mi.quantity,
      unit:         mi.unit,
      preparation:  mi.preparation ?? undefined,
      category:     mi.ingredient.category,
    })),
  };
}

// Resolve each editor row to a server-side ingredientId. Rows can arrive
// in three shapes:
//   1. linked, unchanged — has `ingredientId` and `name` still matches that
//      ingredient's actual name; use the id as-is.
//   2. linked, renamed — has `ingredientId` but the user typed a different
//      name; unlink and re-resolve from the typed name.
//   3. fresh — no `ingredientId`; find by name, mint a new ingredient if
//      nothing matches.
async function ensureIngredientIds(rows: MealFormData["ingredients"]) {
  let pool: Ingredient[] | null = null;
  const getPool = async () => pool ?? (pool = await getIngredients());
  const norm = (s: string) => s.trim().toLowerCase();

  const out: { ingredientId: number; quantity: number; unit: string; preparation?: string }[] = [];
  for (const r of rows) {
    let id = r.ingredientId;

    if (id !== undefined) {
      const linked = (await getPool()).find((i) => i.id === id);
      if (linked && norm(linked.name) !== norm(r.name)) {
        id = undefined;
      }
    }

    if (id === undefined) {
      const found = (await getPool()).find((i) => norm(i.name) === norm(r.name));
      if (found) {
        id = found.id;
      } else {
        try {
          const created = await apiFetch<{ id: number }>("/ingredients", {
            method: "POST",
            body: JSON.stringify({ name: r.name.trim(), category: r.category ?? "other", defaultUnit: r.unit }),
          });
          id = created.id;
        } catch (e: any) {
          // Race: somebody else minted the same name between our pool fetch
          // and the POST. Re-fetch the pool and look up by name.
          pool = null;
          const fresh = await getPool();
          const found2 = fresh.find((i) => norm(i.name) === norm(r.name));
          if (!found2) throw e;
          id = found2.id;
        }
      }
    }

    if (id === undefined) throw new Error(`could not resolve ingredient for "${r.name}"`);
    out.push({ ingredientId: id, quantity: r.quantity, unit: r.unit, preparation: r.preparation });
  }
  return out;
}

export default function RecipeEditor({ mode }: Props) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [source, setSource] = useState<Meal | null>(null);
  const [data, setData] = useState<MealFormData | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "version" | "variant">(null);

  useEffect(() => {
    if (mode === "new") return;
    if (!id) return;
    getMeal(Number(id)).then(setSource).catch(() => setSource(null));
  }, [mode, id]);

  const initialData = useMemo<Partial<MealFormData> | undefined>(() => {
    if (mode === "new") return undefined;
    if (!source) return undefined;
    return mealToForm(source);
  }, [mode, source]);

  const onChange = (next: MealFormData, isDirty: boolean) => {
    setData(next);
    setDirty(isDirty);
  };

  const titleByMode: Record<Mode, string> = {
    new:     "New recipe",
    edit:    source ? `Edit · ${source.name}` : "Edit recipe",
    variant: source ? `New variant of · ${source.name}` : "New variant",
  };

  const submit = async (which: NonNullable<typeof busy>) => {
    if (!data) return;
    setBusy(which);
    try {
      const ingredients = await ensureIngredientIds(data.ingredients);
      const payload = { ...data, ingredients };
      let result: Meal;
      if (which === "save" && mode === "new") {
        result = await createMeal(payload);
      } else if (which === "save" && mode === "edit") {
        result = await updateMeal(Number(id), payload);
      } else if (which === "version") {
        result = await supersedeMeal(Number(id), payload);
      } else if (which === "variant") {
        result = await createVariant(Number(id), payload);
      } else {
        return;
      }
      navigate(`/recipes/${result.id}`);
    } catch (e: any) {
      alert(e.message ?? "Save failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5 max-w-[760px]">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink-1">
          <ChevronLeft size={14} /> Back
        </button>
      </div>
      <h1 className="text-[26px] font-semibold -tracking-[0.02em] text-ink-1">{titleByMode[mode]}</h1>

      {mode !== "new" && !source ? (
        <div className="text-ink-3 text-[14px]">Loading recipe…</div>
      ) : (
        <div className="bg-surface-1 border border-line rounded-[14px] p-5">
          <MealForm
            formId="recipe-editor-form"
            initialData={initialData}
            onChange={onChange}
          />
          <div className="flex gap-2 mt-5 flex-wrap">
            {mode === "new" && (
              <Button variant="primary" icon={Save} onClick={() => submit("save")} disabled={!dirty || busy !== null}>
                {busy === "save" ? "Saving…" : "Save"}
              </Button>
            )}
            {mode === "edit" && (
              <>
                <Button variant="primary" icon={Save} onClick={() => submit("save")} disabled={!dirty || busy !== null}>
                  {busy === "save" ? "Saving…" : "Save"}
                </Button>
                <Button variant="ghost" icon={GitCommit} onClick={() => submit("version")} disabled={!dirty || busy !== null}>
                  {busy === "version" ? "Saving…" : "Save as new version"}
                </Button>
                <Button variant="ghost" icon={GitBranch} onClick={() => submit("variant")} disabled={!dirty || busy !== null}>
                  {busy === "variant" ? "Saving…" : "Save as variant"}
                </Button>
              </>
            )}
            {mode === "variant" && (
              <Button variant="primary" icon={GitBranch} onClick={() => submit("variant")} disabled={!dirty || busy !== null}>
                {busy === "variant" ? "Saving…" : "Save as variant"}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
