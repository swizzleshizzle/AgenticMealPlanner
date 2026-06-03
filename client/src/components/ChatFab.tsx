import { MessageCircle } from "lucide-react";

interface Props { onClick: () => void; }

export default function ChatFab({ onClick }: Props) {
  return (
    <button
      onClick={onClick}
      aria-label="Open assistant chat"
      className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-accent text-accent-on grid place-items-center shadow-[var(--shadow-card)] hover:scale-105 transition-transform"
    >
      <MessageCircle size={22} />
    </button>
  );
}
