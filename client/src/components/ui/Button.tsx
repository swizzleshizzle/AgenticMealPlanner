import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type Variant = "primary" | "soft" | "ghost" | "quiet" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-on border-accent hover:opacity-90 active:scale-[0.98]",
  soft:    "bg-accent-soft text-accent-ink border-accent-line hover:bg-accent-soft/80",
  ghost:   "bg-transparent text-ink-1 border-line hover:bg-surface-2",
  quiet:   "bg-transparent text-ink-2 border-transparent hover:bg-surface-2",
  danger:  "bg-transparent text-danger border-line hover:bg-warn-soft",
};

const SIZE: Record<Size, string> = {
  sm: "h-[30px] text-[12px] px-2.5",
  md: "h-9 text-[13px] px-3.5",
  lg: "h-[42px] text-[14px] px-4.5",
};

const ICON_PX: Record<Size, number> = { sm: 14, md: 16, lg: 18 };

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  children?: ReactNode;
}

export default function Button({
  variant = "primary",
  size = "md",
  icon: Icon,
  children,
  className = "",
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 border rounded-[10px] font-medium cursor-pointer transition disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    >
      {Icon && <Icon size={ICON_PX[size]} strokeWidth={1.85} />}
      {children}
    </button>
  );
}
