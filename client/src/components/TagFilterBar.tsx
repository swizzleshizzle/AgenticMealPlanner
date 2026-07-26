import { useLayoutEffect, useRef, useState } from "react";

// Collapsed, the tag filter shows exactly as many tags as fit on one line, then
// a "+N more" chip; expanded, it wraps to show all tags with a "Show less" chip.
// Widths are measured from a hidden off-screen copy of every pill so the visible
// row can be sliced without a flash of the full (tall) block on load.

const GAP = 6; // px, matches Tailwind gap-1.5 (0.375rem)
const TOGGLE_RESERVE = 96; // px kept free on the collapsed row for the toggle chip

function pillClass(active: boolean): string {
  return `text-[12px] px-3 py-[4px] rounded-full font-medium border transition ${
    active
      ? "bg-accent text-accent-on border-accent"
      : "bg-surface-1 text-ink-2 border-line hover:border-accent-line"
  }`;
}

interface TagFilterBarProps {
  tags: string[];
  active: string | null;
  onToggle: (tag: string | null) => void;
}

export default function TagFilterBar({ tags, active, onToggle }: TagFilterBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  // Start assuming everything fits; the layout effect corrects before paint.
  const [cutoff, setCutoff] = useState(tags.length);

  useLayoutEffect(() => {
    const measure = () => {
      const container = containerRef.current;
      const meas = measureRef.current;
      if (!container || !meas) return;
      const available = container.clientWidth;
      const widths = Array.from(meas.children).map((c) => (c as HTMLElement).offsetWidth);
      const total = widths.reduce((sum, w, i) => sum + w + (i > 0 ? GAP : 0), 0);
      if (total <= available) {
        setCutoff(widths.length); // all tags fit — no toggle needed
        return;
      }
      const budget = available - GAP - TOGGLE_RESERVE;
      let used = 0;
      let count = 0;
      for (const w of widths) {
        const need = used + w + (count > 0 ? GAP : 0);
        if (need <= budget) {
          used = need;
          count++;
        } else {
          break;
        }
      }
      setCutoff(Math.max(1, count));
    };

    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [tags]);

  if (tags.length === 0) return null;

  const overflowing = cutoff < tags.length;
  let visible = expanded ? tags : tags.slice(0, cutoff);
  // Keep the active tag visible even when it falls into the collapsed overflow.
  if (!expanded && active && cutoff > 0 && !visible.includes(active)) {
    visible = [...tags.slice(0, cutoff - 1), active];
  }

  return (
    <div className="-mt-2">
      {/* Hidden measurer: every pill at its real width, off-screen. */}
      <div
        ref={measureRef}
        aria-hidden
        className="flex gap-1.5"
        style={{
          position: "absolute",
          visibility: "hidden",
          pointerEvents: "none",
          left: -9999,
          top: 0,
          whiteSpace: "nowrap",
        }}
      >
        {tags.map((t) => (
          <span key={t} className={pillClass(false)}>
            {t}
          </span>
        ))}
      </div>

      <div
        ref={containerRef}
        className={`flex gap-1.5 ${expanded ? "flex-wrap" : "flex-nowrap overflow-hidden"}`}
      >
        {visible.map((t) => (
          <button
            key={t}
            onClick={() => onToggle(active === t ? null : t)}
            className={pillClass(active === t)}
          >
            {t}
          </button>
        ))}
        {overflowing && (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-[12px] px-3 py-[4px] rounded-full font-medium border border-line bg-surface-1 text-ink-3 hover:text-ink-1 hover:border-accent-line transition whitespace-nowrap"
          >
            {expanded ? "Show less" : `+${tags.length - cutoff} more`}
          </button>
        )}
      </div>
    </div>
  );
}
