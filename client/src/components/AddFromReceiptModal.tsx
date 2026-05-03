import { useEffect, useRef, useState } from "react";
import { X, Upload, Receipt as ReceiptIcon, ClipboardPaste } from "lucide-react";
import { parseReceipt, type ParseResult } from "../api/receipts";
import Button from "./ui/Button";

type Stage = "upload" | "parsing" | "review" | "error";

interface Props {
  onClose: () => void;
  onCommitted: () => void;
}

export default function AddFromReceiptModal({ onClose, onCommitted }: Props) {
  const [stage, setStage] = useState<Stage>("upload");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Esc-to-close + body-scroll lock, consistent with other modals.
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

  const handleFile = async (file: File) => {
    setStage("parsing");
    setError(null);
    try {
      const result = await parseReceipt({ file });
      setParsed(result);
      setStage("review");
    } catch (e: any) {
      setError(e?.message ?? "Parse failed.");
      setStage("error");
    }
  };

  const handlePaste = async () => {
    if (!pasteText.trim()) return;
    setStage("parsing");
    setError(null);
    try {
      const result = await parseReceipt({ text: pasteText });
      setParsed(result);
      setStage("review");
    } catch (e: any) {
      setError(e?.message ?? "Parse failed.");
      setStage("error");
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
            <div className="text-[13.5px] font-semibold text-ink-1">Add from receipt</div>
            <div className="text-[11px] text-ink-3">
              {stage === "upload" && "Drop a photo, PDF, or paste text from a digital order"}
              {stage === "parsing" && "Reading your receipt…"}
              {stage === "review" && "Review and commit"}
              {stage === "error" && "Something went wrong"}
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

        {stage === "upload" && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-4">
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.heic"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <button
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handleFile(f);
              }}
              className={`flex flex-col items-center gap-3 py-10 px-6 border-2 border-dashed rounded-[14px] bg-surface-2 text-center transition cursor-pointer ${
                dragOver ? "border-accent bg-accent-soft" : "border-line hover:border-accent-line"
              }`}
            >
              <div className="w-12 h-12 rounded-[12px] bg-accent-soft text-accent-ink grid place-items-center">
                <Upload size={20} />
              </div>
              <div>
                <div className="text-[14px] font-semibold text-ink-1">Drop a photo or PDF</div>
                <div className="text-[12px] text-ink-3 mt-1">JPG, PNG, HEIC, PDF up to 20MB</div>
              </div>
            </button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-line-soft" />
              <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">or paste text</span>
              <div className="flex-1 h-px bg-line-soft" />
            </div>

            <div className="flex flex-col gap-2">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste your Walmart / Instacart / Amazon Fresh order summary…"
                rows={6}
                className="w-full rounded-[10px] border border-line bg-surface-2 p-3 text-[13px] text-ink-1 placeholder:text-ink-3 focus:outline-none focus:border-accent resize-y"
              />
              <div className="flex justify-end">
                <Button variant="primary" size="sm" icon={ClipboardPaste} disabled={!pasteText.trim()} onClick={handlePaste}>
                  Parse pasted text
                </Button>
              </div>
            </div>
          </div>
        )}

        {stage === "parsing" && (
          <div className="flex-1 grid place-items-center p-10 text-center">
            <div>
              <div
                className="w-11 h-11 mx-auto mb-4 rounded-full amp-spin"
                style={{
                  borderWidth: 3,
                  borderStyle: "solid",
                  borderColor: "var(--accent-soft)",
                  borderTopColor: "var(--accent)",
                }}
              />
              <div className="text-[15px] font-semibold text-ink-1 mb-1">Reading your receipt…</div>
              <div className="text-[13px] text-ink-3">Identifying items, quantities, and prices. ~30 seconds.</div>
            </div>
          </div>
        )}

        {stage === "error" && (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="rounded-[10px] border border-warn-line bg-warn-soft text-warn-ink px-3 py-2 text-[13px] mb-4">
              {error ?? "Parse failed."}
            </div>
            <div className="text-[13px] text-ink-2">
              Try a clearer photo, or paste the text from a digital order if you have one.
            </div>
            <div className="mt-4">
              <Button variant="ghost" size="sm" onClick={() => { setStage("upload"); setError(null); }}>
                Try again
              </Button>
            </div>
          </div>
        )}

        {stage === "review" && parsed && (
          <ReviewStage
            parseResult={parsed}
            onCommitted={() => { onCommitted(); onClose(); }}
            onCancel={onClose}
          />
        )}
      </div>
    </div>
  );
}

// Placeholder so the file typechecks; Task 11 fills this in.
function ReviewStage(_props: { parseResult: ParseResult; onCommitted: () => void; onCancel: () => void }) {
  return (
    <div className="flex-1 grid place-items-center p-10 text-center text-ink-3 text-[13px]">
      Review UI lands in the next task.
    </div>
  );
}
