import { useEffect, useState } from "react";
import { X, Receipt as ReceiptIcon, Trash2, ShoppingBag } from "lucide-react";
import { deleteReceipt, getReceipt, type Receipt } from "../api/receipts";
import Button from "./ui/Button";

interface Props {
  receiptId: number;
  onClose: () => void;
  onDeleted: () => void;
}

const KIND_LABEL: Record<string, string> = {
  food: "Food",
  non_food: "Non-food",
  unknown: "Unknown",
};

export default function ReceiptDetailModal({ receiptId, onClose, onDeleted }: Props) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  useEffect(() => {
    getReceipt(receiptId)
      .then(setReceipt)
      .catch((e) => setError(e?.message ?? "Failed to load receipt"));
  }, [receiptId]);

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteReceipt(receiptId);
      onDeleted();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Delete failed");
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8 amp-fade-in"
      style={{ background: "rgba(30, 22, 10, 0.55)", backdropFilter: "blur(4px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-1 rounded-[16px] w-full max-w-[640px] max-h-[88vh] flex flex-col overflow-hidden border border-line"
        style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
      >
        <div className="flex items-start gap-3 px-4 sm:px-5 py-3.5 border-b border-line-soft">
          <div className="w-8 h-8 rounded-[8px] bg-accent-soft text-accent-ink grid place-items-center">
            <ReceiptIcon size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-ink-1 flex items-center gap-1.5">
              <ShoppingBag size={12} /> {receipt?.store ?? "Loading…"}
            </div>
            <div className="text-[11px] text-ink-3">
              {receipt
                ? `${new Date(receipt.tripDate).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · $${Number(receipt.total).toFixed(2)}`
                : ""}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 grid place-items-center rounded-[8px] text-ink-2 hover:bg-surface-2"
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="m-4 rounded-[10px] border border-warn-line bg-warn-soft text-warn-ink px-3 py-2 text-[13px]">
            {error}
          </div>
        )}

        {receipt && (
          <>
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              {receipt.items && receipt.items.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {receipt.items.map((it) => (
                    <li
                      key={it.id}
                      className={`grid grid-cols-[1fr_auto_auto] gap-2 px-2 py-1.5 rounded-[6px] text-[12.5px] ${
                        !it.isCommitted ? "opacity-50" : ""
                      } ${it.kind !== "food" ? "text-ink-3" : "text-ink-1"}`}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{it.parsedName}</div>
                        <div className="text-[10.5px] text-ink-3 truncate">
                          {KIND_LABEL[it.kind]}{it.ingredient ? ` · matched ${it.ingredient.name}` : ""}
                        </div>
                      </div>
                      <div className="tabular-nums text-ink-2">
                        {Number(it.quantity).toFixed(2)} {it.unit}
                      </div>
                      <div className="tabular-nums w-16 text-right">
                        {it.price != null ? `$${Number(it.price).toFixed(2)}` : "—"}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-[13px] text-ink-3 text-center p-6">No items.</div>
              )}

              <div className="mt-4 grid grid-cols-3 gap-2 pt-3 border-t border-line-soft">
                <Stat label="Subtotal" value={receipt.subtotal != null ? `$${Number(receipt.subtotal).toFixed(2)}` : "—"} />
                <Stat label="Tax"      value={receipt.tax != null ? `$${Number(receipt.tax).toFixed(2)}` : "—"} />
                <Stat label="Total"    value={`$${Number(receipt.total).toFixed(2)}`} highlight />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 border-t border-line-soft bg-surface-2">
              {confirmingDelete ? (
                <>
                  <span className="text-[12px] text-ink-2">Delete this receipt? Pantry items already added stay.</span>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmingDelete(false)}>Cancel</Button>
                    <Button variant="danger" size="sm" icon={Trash2} disabled={busy} onClick={handleDelete}>
                      {busy ? "Deleting…" : "Delete"}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setConfirmingDelete(true)}>
                    Delete
                  </Button>
                  <Button variant="primary" size="sm" onClick={onClose}>Close</Button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex flex-col gap-0.5 px-3 py-2 rounded-[8px] ${highlight ? "bg-accent-soft border border-accent-line text-accent-ink" : "bg-surface-2 border border-line"}`}>
      <span className="text-[10.5px] uppercase tracking-[0.07em] text-ink-3 font-semibold">{label}</span>
      <span className="text-[14px] font-semibold tabular-nums">{value}</span>
    </div>
  );
}
