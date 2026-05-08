// client/src/components/pantry/PantryDrawer.tsx
import { useEffect } from "react";
import { X, Settings } from "lucide-react";
import type { PantryCard } from "../../api/pantry";
import Button from "../ui/Button";

interface Props {
  card: PantryCard | null;
  onClose: () => void;
  onChanged: () => void;
}

export default function PantryDrawer({ card, onClose, onChanged }: Props) {
  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, onClose]);

  if (!card) return null;

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[180] bg-black/30 amp-fade-in" />
      <aside className="fixed top-0 right-0 z-[190] h-full w-full sm:w-[480px] bg-surface-1 border-l border-line flex flex-col shadow-2xl amp-slide-in-right">
        <header className="flex items-start gap-3 px-5 py-4 border-b border-line-soft">
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-semibold text-ink-1 capitalize truncate">{card.ingredient.name}</div>
            <div className="text-[11px] text-ink-3 capitalize">
              {card.ingredient.category} · default unit: {card.ingredient.defaultUnit}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 grid place-items-center rounded-[8px] text-ink-2 hover:bg-surface-2">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
          <div>
            <Button variant="ghost" size="sm" icon={Settings} onClick={() => {/* IngredientEditForm — Task 20 */}}>
              Edit ingredient
            </Button>
          </div>

          <section>
            <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold mb-1.5">Summary</div>
            <div className="text-[13px] text-ink-2 flex flex-col gap-1">
              <div>Total on hand: {card.canonicalTotal ? `${card.partialTotal ? "~" : ""}${card.canonicalTotal.qty.toFixed(2)} ${card.canonicalTotal.unit}` : "—"}</div>
              <div>Soonest expiration: {card.nextExpirationDays != null ? `${card.nextExpirationDays}d` : "—"}</div>
              <div>Running low: {card.isLowStock ? "yes" : "no"}</div>
            </div>
          </section>

          <section>
            <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold mb-1.5">
              Batches ({card.batchCount})
            </div>
            <div className="flex flex-col gap-2">
              {/* BatchRow per batch — Task 18 */}
              {card.batches.map((b) => (
                <div key={b.id} className="bg-surface-2 border border-line-soft rounded-[10px] p-3 text-[13px] text-ink-2">
                  {b.quantity} {b.unit} · {b.location}
                  {b.expirationDate && ` · expires ${new Date(b.expirationDate).toLocaleDateString()}`}
                </div>
              ))}
            </div>
            <div className="mt-3">
              <Button variant="ghost" size="sm" onClick={() => {/* add batch — Task 21 */}}>
                + Add another batch
              </Button>
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
