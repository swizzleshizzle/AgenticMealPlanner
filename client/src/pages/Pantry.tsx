// client/src/pages/Pantry.tsx
import { useEffect, useState } from "react";
import { Plus, Receipt as ReceiptIcon } from "lucide-react";
import { getPantry, type PantryCard, type PantryQuery } from "../api/pantry";
import Button from "../components/ui/Button";
import AddFromReceiptModal from "../components/AddFromReceiptModal";
import SpendingStrip from "../components/SpendingStrip";
import RecentReceiptsStrip from "../components/RecentReceiptsStrip";
import PantryCardComp from "../components/pantry/PantryCard";
import FilterChips from "../components/pantry/FilterChips";

export default function Pantry() {
  const [cards, setCards] = useState<PantryCard[]>([]);
  const [query, setQuery] = useState<PantryQuery>({ sort: "name" });
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [receiptRefreshKey, setReceiptRefreshKey] = useState(0);

  const load = () => {
    getPantry(query).then(setCards).catch(() => setCards([]));
  };
  useEffect(load, [JSON.stringify(query), receiptRefreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalItems = cards.reduce((acc, c) => acc + c.batchCount, 0);

  return (
    <div className="flex flex-col gap-7">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[12px] uppercase tracking-[0.1em] text-ink-3 mb-1.5">
            {totalItems} item{totalItems === 1 ? "" : "s"} on hand · {cards.length} ingredient{cards.length === 1 ? "" : "s"}
          </div>
          <h1 className="text-[26px] sm:text-[30px] font-semibold -tracking-[0.02em] text-ink-1">Pantry</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon={ReceiptIcon} onClick={() => setShowReceiptModal(true)}>
            Add from receipt
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => { /* AddItemModal — Task 22 */ }}>
            Add item
          </Button>
        </div>
      </div>

      <SpendingStrip refreshKey={receiptRefreshKey} />
      <RecentReceiptsStrip
        refreshKey={receiptRefreshKey}
        onChanged={() => setReceiptRefreshKey((k) => k + 1)}
      />

      <FilterChips value={query} onChange={setQuery} />

      {cards.length === 0 ? (
        <div className="bg-surface-1 border border-line rounded-[14px] p-10 text-center text-[13px] text-ink-3">
          Nothing matches. Try clearing filters, or add an item.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {cards.map((c) => (
            <PantryCardComp key={c.ingredient.id} card={c} onOpen={() => { /* drawer — Task 17 */ }} />
          ))}
        </div>
      )}

      {showReceiptModal && (
        <AddFromReceiptModal
          onClose={() => setShowReceiptModal(false)}
          onCommitted={() => {
            setReceiptRefreshKey((k) => k + 1);
            load();
          }}
        />
      )}
    </div>
  );
}
