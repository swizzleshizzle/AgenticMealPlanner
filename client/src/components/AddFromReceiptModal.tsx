import { useEffect, useMemo, useRef, useState } from "react";
import { X, Upload, Receipt as ReceiptIcon, ClipboardPaste, ChevronDown, ChevronRight, Plus } from "lucide-react";
import { commitReceipt, parseReceipt, type CommitItemEdit, type ParseResult, type ParsedReceiptItem } from "../api/receipts";
import { getIngredients, type Ingredient } from "../api/ingredients";
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
        className="bg-surface-1 rounded-[16px] w-full max-w-[640px] md:max-w-[1000px] max-h-[88vh] flex flex-col overflow-hidden border border-line"
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

const LOCATIONS: Array<"fridge" | "freezer" | "pantry"> = ["fridge", "freezer", "pantry"];
const CATEGORIES = ["produce", "protein", "dairy", "pantry_staple", "grain", "spice", "condiment", "frozen", "other"] as const;

// Shared grid template for the new desktop (md+) review table.
// Columns: ☐ · Item · Qty · Unit · Location · Expires · Price.
// At md (768px viewport) the modal is 728px usable, the fixed columns
// + gaps consume ~532px, and the Item column gets ~196px — tight but viable.
// At 1000px (md+ desktop cap) the Item column gets ~430px.
const RECEIPT_ROW_GRID =
  "md:grid md:grid-cols-[28px_minmax(0,1fr)_72px_72px_104px_136px_72px] md:items-center md:gap-2";

interface RowState extends CommitItemEdit {
  // Mirror of the parsed item, plus a UI-only flag for the inline create mini-form.
  showCreateForm: boolean;
  matchedIngredientName?: string | null;
  matchConfidence?: "high" | "low" | null;
}

function buildInitialRows(items: ParsedReceiptItem[], ingredients: Ingredient[]): RowState[] {
  const ingById = new Map(ingredients.map((i) => [i.id, i.name]));
  return items.map((it, index) => ({
    index,
    ingredientId: it.ingredientId ?? null,
    parsedName: it.parsedName,
    quantity: it.quantity,
    unit: it.unit,
    price: it.price ?? null,
    kind: it.kind,
    categoryGuess: it.categoryGuess ?? null,
    locationGuess: it.locationGuess ?? "pantry",
    expirationDate: null,
    isCommitted: it.kind === "food",
    showCreateForm: false,
    matchedIngredientName: it.ingredientId != null ? ingById.get(it.ingredientId) ?? null : null,
    matchConfidence: it.matchConfidence ?? null,
  }));
}

function ReviewStage({
  parseResult,
  onCommitted,
  onCancel,
}: {
  parseResult: ParseResult;
  onCommitted: () => void;
  onCancel: () => void;
}) {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [store, setStore] = useState(parseResult.payload.store);
  const [tripDate, setTripDate] = useState(parseResult.payload.tripDate);
  const [rows, setRows] = useState<RowState[]>([]);
  const [showNonFood, setShowNonFood] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getIngredients().then((ings) => {
      setIngredients(ings);
      setRows(buildInitialRows(parseResult.payload.items, ings));
    });
  }, [parseResult]);

  const foodRows = useMemo(() => rows.filter((r) => r.kind === "food"), [rows]);
  const nonFoodRows = useMemo(() => rows.filter((r) => r.kind !== "food"), [rows]);
  const committedFoodCount = foodRows.filter((r) => r.isCommitted).length;
  const liveTotal = useMemo(
    () =>
      rows
        .filter((r) => r.isCommitted)
        .reduce((sum, r) => sum + (r.price ?? 0), 0),
    [rows],
  );

  const updateRow = (index: number, patch: Partial<RowState>) => {
    setRows((prev) => prev.map((r) => (r.index === index ? { ...r, ...patch } : r)));
  };

  const submit = async () => {
    setCommitting(true);
    setError(null);
    try {
      const items: CommitItemEdit[] = rows.map(({ showCreateForm, matchedIngredientName, matchConfidence, ...rest }) => rest);
      await commitReceipt({
        parseId: parseResult.parseId,
        store,
        tripDate,
        subtotal: parseResult.payload.subtotal ?? null,
        tax: parseResult.payload.tax ?? null,
        total: parseResult.payload.total,
        items,
      });
      onCommitted();
    } catch (e: any) {
      setError(e?.message ?? "Commit failed.");
    } finally {
      setCommitting(false);
    }
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Store">
            <input
              value={store}
              onChange={(e) => setStore(e.target.value)}
              className="h-9 rounded-[10px] border border-line bg-surface-2 px-3 text-[13px] text-ink-1 focus:outline-none focus:border-accent"
            />
          </Field>
          <Field label="Trip date">
            <input
              type="date"
              value={tripDate}
              onChange={(e) => setTripDate(e.target.value)}
              className="h-9 rounded-[10px] border border-line bg-surface-2 px-3 text-[13px] text-ink-1 focus:outline-none focus:border-accent"
            />
          </Field>
          <Field label="Total">
            <div className="h-9 rounded-[10px] border border-line-soft bg-surface-2 px-3 text-[14px] text-ink-1 font-semibold tabular-nums grid place-items-center">
              ${parseResult.payload.total.toFixed(2)}
              <span className="text-[10.5px] text-ink-3 font-normal">
                rolling: ${liveTotal.toFixed(2)}
              </span>
            </div>
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">
            Food items ({committedFoodCount}/{foodRows.length} selected)
          </div>
          <div
            className={`hidden sticky top-0 z-10 bg-surface-1 border-b border-line-soft px-3 py-1.5 text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold ${RECEIPT_ROW_GRID}`}
          >
            <span aria-hidden />
            <span>Item</span>
            <span>Qty</span>
            <span>Unit</span>
            <span>Location</span>
            <span>Expires</span>
            <span className="text-right">Price</span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {foodRows.map((row) => (
              <RowEditor
                key={row.index}
                row={row}
                ingredients={ingredients}
                disabled={committing}
                onPatch={(patch) => updateRow(row.index, patch)}
              />
            ))}
            {foodRows.length === 0 && (
              <div className="text-[12px] text-ink-3 px-2 py-3">No food items detected.</div>
            )}
          </ul>
        </div>

        {nonFoodRows.length > 0 && (
          <div className="flex flex-col gap-2">
            <button
              onClick={() => setShowNonFood((v) => !v)}
              className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink-1 self-start"
            >
              {showNonFood ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {nonFoodRows.length} non-food item{nonFoodRows.length === 1 ? "" : "s"} hidden
            </button>
            {showNonFood && (
              <ul className="flex flex-col gap-1 pl-1">
                {nonFoodRows.map((row) => (
                  <li key={row.index} className="text-[12px] text-ink-3 flex items-center gap-2">
                    <span className="flex-1 truncate">{row.parsedName}</span>
                    {row.price != null && <span className="tabular-nums">${row.price.toFixed(2)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-[10px] border border-warn-line bg-warn-soft text-warn-ink px-3 py-2 text-[13px]">
            {error}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-4 sm:px-5 py-3 border-t border-line-soft bg-surface-2">
        <Button variant="ghost" size="sm" disabled={committing} onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" disabled={committing || committedFoodCount === 0} onClick={submit}>
          {committing ? "Committing…" : `Commit ${committedFoodCount} item${committedFoodCount === 1 ? "" : "s"} to Pantry`}
        </Button>
      </div>
    </>
  );
}

function RowEditor({
  row, ingredients, disabled, onPatch,
}: {
  row: RowState;
  ingredients: Ingredient[];
  disabled: boolean;
  onPatch: (patch: Partial<RowState>) => void;
}) {
  return (
    <li
      className={`rounded-[10px] border border-line-soft bg-surface-2 px-3 py-2 grid grid-cols-[auto_1fr_auto_auto] gap-2 items-center ${RECEIPT_ROW_GRID} ${!row.isCommitted ? "opacity-50" : ""}`}
    >
      <input
        type="checkbox"
        checked={row.isCommitted}
        disabled={disabled}
        onChange={(e) => onPatch({ isCommitted: e.target.checked })}
        className="w-4 h-4 accent-accent"
      />

      {/* Ingredient match cell */}
      <div className="min-w-0">
        {row.ingredientId != null ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-[6px] text-[11.5px] font-medium shrink-0 ${
                row.matchConfidence === "low"
                  ? "bg-warn-soft text-warn-ink border border-warn-line"
                  : "bg-accent-soft text-accent-ink border border-accent-line"
              }`}
            >
              {row.matchedIngredientName ?? `#${row.ingredientId}`}
            </span>
            <span className="text-[11px] text-ink-3 truncate" title={row.parsedName}>
              {row.parsedName}
            </span>
          </div>
        ) : (
          <button
            onClick={() => onPatch({ showCreateForm: !row.showCreateForm })}
            disabled={disabled}
            title={`Create "${row.parsedName}"`}
            className="flex items-center gap-1 max-w-full min-w-0 text-[12px] text-accent-ink hover:underline"
          >
            <Plus size={12} className="shrink-0" />
            <span className="truncate">Create &ldquo;{row.parsedName}&rdquo;</span>
          </button>
        )}
      </div>

      <input
        type="number"
        step="0.01"
        value={row.quantity}
        disabled={disabled || !row.isCommitted}
        onChange={(e) => onPatch({ quantity: Number(e.target.value) })}
        className="h-8 w-20 md:w-full rounded-[8px] border border-line bg-surface-1 px-2 text-[12.5px] text-ink-1 tabular-nums focus:outline-none focus:border-accent disabled:opacity-50"
      />
      <input
        type="text"
        value={row.unit === "count" ? "ea" : row.unit}
        disabled={disabled || !row.isCommitted}
        onChange={(e) => onPatch({ unit: e.target.value })}
        className="h-8 w-20 md:w-full rounded-[8px] border border-line bg-surface-1 px-2 text-[12.5px] text-ink-1 focus:outline-none focus:border-accent disabled:opacity-50"
      />
      <select
        value={row.locationGuess ?? "pantry"}
        disabled={disabled || !row.isCommitted}
        onChange={(e) => onPatch({ locationGuess: e.target.value as any })}
        className="h-8 md:w-full rounded-[8px] border border-line bg-surface-1 px-2 text-[12.5px] text-ink-1 capitalize focus:outline-none focus:border-accent disabled:opacity-50"
      >
        {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
      </select>
      <input
        type="date"
        value={row.expirationDate ?? ""}
        disabled={disabled || !row.isCommitted}
        onChange={(e) => onPatch({ expirationDate: e.target.value || null })}
        className="h-8 md:w-full rounded-[8px] border border-line bg-surface-1 px-2 text-[12px] text-ink-1 focus:outline-none focus:border-accent disabled:opacity-50"
      />
      <span className="text-[12.5px] text-ink-2 tabular-nums w-16 md:w-full text-right">
        {row.price != null ? `$${row.price.toFixed(2)}` : "—"}
      </span>

      {row.showCreateForm && row.ingredientId == null && (
        <div className="col-span-full mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Field label="Name">
            <input
              value={row.parsedName}
              onChange={(e) => onPatch({ parsedName: e.target.value })}
              className="h-8 rounded-[8px] border border-line bg-surface-1 px-2 text-[12.5px] text-ink-1 focus:outline-none focus:border-accent"
            />
          </Field>
          <Field label="Category">
            <select
              value={row.categoryGuess ?? "other"}
              onChange={(e) => onPatch({ categoryGuess: e.target.value as any })}
              className="h-8 rounded-[8px] border border-line bg-surface-1 px-2 text-[12.5px] text-ink-1 focus:outline-none focus:border-accent"
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
            </select>
          </Field>
          <div className="text-[11px] text-ink-3 self-end pb-1">
            On commit, a new ingredient will be created with these values + unit &ldquo;{row.unit}&rdquo;.
          </div>
        </div>
      )}
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">{label}</label>
      {children}
    </div>
  );
}
