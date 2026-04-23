import { useEffect, useState } from "react";

export interface ToastData {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
}

interface Props {
  toast: ToastData | null;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 4000;

export default function Toast({ toast, onDismiss }: Props) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!toast || paused) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast?.id, paused, onDismiss]);

  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="fixed bottom-4 right-4 z-[300] max-w-[360px] bg-surface-1 border border-line rounded-[12px] px-4 py-3 flex items-center gap-3 shadow-[var(--shadow-hero)] amp-fade-in motion-reduce:transition-none"
    >
      <div className="flex-1 text-[13.5px] text-ink-1 leading-tight">{toast.message}</div>
      {toast.action && (
        <button
          onClick={() => {
            toast.action!.onClick();
            onDismiss();
          }}
          className="text-[12.5px] text-accent-ink hover:underline whitespace-nowrap"
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
