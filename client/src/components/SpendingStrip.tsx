import { useEffect, useState } from "react";
import { DollarSign } from "lucide-react";
import { getWeeklySpending, type WeeklySpending } from "../api/receipts";

export default function SpendingStrip({ refreshKey }: { refreshKey: number }) {
  const [spending, setSpending] = useState<WeeklySpending | null>(null);

  useEffect(() => {
    getWeeklySpending().then(setSpending).catch(() => setSpending(null));
  }, [refreshKey]);

  if (!spending || spending.tripCount === 0) return null;

  return (
    <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] bg-accent-soft border border-accent-line text-accent-ink text-[13px]">
      <DollarSign size={14} />
      <span>
        <span className="font-semibold">This week: ${spending.total.toFixed(2)}</span>
        {" "}across {spending.tripCount} trip{spending.tripCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}
