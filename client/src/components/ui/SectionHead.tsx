import type { ReactNode } from "react";

export default function SectionHead({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between mb-4 gap-3">
      <div>
        {eyebrow && (
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 mb-1">
            {eyebrow}
          </div>
        )}
        <h2 className="text-[20px] font-semibold text-ink-1 -tracking-[0.015em] leading-tight">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}
