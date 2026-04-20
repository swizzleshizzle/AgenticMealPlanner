import type { ReactNode, CSSProperties } from "react";

type Tone = "neutral" | "accent" | "prep" | "fresh" | "warn" | "ghost";
type Size = "sm" | "md" | "lg";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2 border-line",
  accent:  "bg-accent-soft text-accent-ink border-accent-line",
  prep:    "bg-prep-soft text-prep-ink border-prep-line",
  fresh:   "bg-fresh-soft text-fresh-ink border-fresh-line",
  warn:    "bg-warn-soft text-warn-ink border-warn-line",
  ghost:   "bg-transparent text-ink-2 border-line",
};

const SIZE: Record<Size, string> = {
  sm: "text-[11px] px-2 py-[2px]",
  md: "text-[12px] px-2.5 py-[3px]",
  lg: "text-[13px] px-3 py-[5px]",
};

export default function Pill({
  children,
  tone = "neutral",
  size = "md",
  className = "",
  style,
}: {
  children: ReactNode;
  tone?: Tone;
  size?: Size;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      style={style}
      className={`inline-flex items-center gap-1 border rounded-full font-medium leading-tight whitespace-nowrap ${TONE[tone]} ${SIZE[size]} ${className}`}
    >
      {children}
    </span>
  );
}
