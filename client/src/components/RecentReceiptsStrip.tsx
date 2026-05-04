import { useEffect, useState } from "react";
import { ShoppingBag } from "lucide-react";
import { getRecentReceipts, type Receipt } from "../api/receipts";
import ReceiptDetailModal from "./ReceiptDetailModal";

export default function RecentReceiptsStrip({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    getRecentReceipts(5).then(setReceipts).catch(() => setReceipts([]));
  }, [refreshKey]);

  if (receipts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">Recent receipts</div>
      <div className="flex gap-2 overflow-x-auto amp-no-scrollbar -mx-4 px-4 sm:-mx-0 sm:px-0">
        {receipts.map((r) => (
          <button
            key={r.id}
            onClick={() => setOpenId(r.id)}
            className="snap-start shrink-0 w-[180px] bg-surface-1 border border-line rounded-[12px] p-3 flex flex-col gap-1 text-left hover:border-accent-line transition"
          >
            <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
              <ShoppingBag size={11} /> {r.store}
            </div>
            <div className="text-[15px] font-semibold text-ink-1 tabular-nums">${Number(r.total).toFixed(2)}</div>
            <div className="text-[11px] text-ink-3">
              {new Date(r.tripDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              {" · "}{r._count?.items ?? 0} item{(r._count?.items ?? 0) === 1 ? "" : "s"}
            </div>
          </button>
        ))}
      </div>

      {openId != null && (
        <ReceiptDetailModal
          receiptId={openId}
          onClose={() => setOpenId(null)}
          onDeleted={onChanged}
        />
      )}
    </div>
  );
}
