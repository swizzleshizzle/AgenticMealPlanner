import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, RotateCcw } from "lucide-react";
import { getArchivedMeals, unarchiveMeal, type ArchivedMealsResponse, type Meal } from "../api/meals";
import Button from "../components/ui/Button";

export default function RecipeArchive() {
  const [data, setData] = useState<ArchivedMealsResponse>({ archivedFamilies: [], archivedVariants: [] });

  const reload = () => getArchivedMeals().then(setData).catch(() => setData({ archivedFamilies: [], archivedVariants: [] }));
  useEffect(() => { reload(); }, []);

  const unarchive = async (m: Meal) => {
    await unarchiveMeal(m.id);
    reload();
  };

  return (
    <div className="flex flex-col gap-6 max-w-[920px]">
      <div className="flex items-center justify-between">
        <Link to="/recipes" className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink-1">
          <ChevronLeft size={14} /> Back to recipes
        </Link>
      </div>
      <h1 className="text-[26px] font-semibold -tracking-[0.02em] text-ink-1">Archive</h1>

      <Section title="Archived recipes" empty="No fully-archived recipes." rows={data.archivedFamilies} onUnarchive={unarchive} />
      <Section title="Archived variants" empty="No archived variants." rows={data.archivedVariants} onUnarchive={unarchive} />
    </div>
  );
}

function Section({
  title, empty, rows, onUnarchive,
}: { title: string; empty: string; rows: Meal[]; onUnarchive: (m: Meal) => void }) {
  return (
    <div>
      <h2 className="text-[16px] font-semibold text-ink-1 mb-3">{title}</h2>
      {rows.length === 0 ? (
        <div className="text-[13px] text-ink-3">{empty}</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 bg-surface-1 border border-line rounded-[12px] px-4 py-3">
              <div>
                <div className="text-[14px] font-semibold text-ink-1">{m.name}</div>
                <div className="text-[12px] text-ink-3">
                  Archived {m.archivedAt ? new Date(m.archivedAt).toLocaleDateString() : "—"}
                </div>
              </div>
              <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => onUnarchive(m)}>
                Unarchive
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
