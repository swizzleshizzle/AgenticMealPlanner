import { useEffect } from "react";
import { X } from "lucide-react";
import ChatPanel from "./ChatPanel";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ChatDrawer({ open, onClose }: Props) {
  // Lock body scroll while open. Close on Escape.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 pointer-events-none ${open ? "" : "invisible"}`}
      aria-hidden={!open}
    >
      <div
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-200 pointer-events-auto ${
          open ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />
      <aside
        className={`absolute right-0 top-0 h-full w-full sm:max-w-[400px] bg-surface-1 border-l border-line shadow-2xl transition-transform duration-200 pointer-events-auto flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Kitchen Assistant"
      >
        <button
          aria-label="Close chat"
          onClick={onClose}
          className="absolute top-3 right-3 w-9 h-9 grid place-items-center rounded-[10px] text-ink-2 hover:bg-surface-2 z-10"
        >
          <X size={18} />
        </button>
        <div className="flex-1 p-4 pt-12 overflow-hidden">
          <ChatPanel />
        </div>
      </aside>
    </div>
  );
}
