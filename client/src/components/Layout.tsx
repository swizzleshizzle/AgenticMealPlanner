import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  Home,
  BookMarked,
  CalendarDays,
  Refrigerator,
  ShoppingCart,
  MessageCircle,
  Upload,
  Leaf,
  Menu,
  X,
} from "lucide-react";

const NAV = [
  { to: "/",         label: "Today",     end: true,  icon: Home },
  { to: "/recipes",  label: "Recipes",   icon: BookMarked },
  { to: "/planner",  label: "Planner",   icon: CalendarDays },
  { to: "/pantry",   label: "Pantry",    icon: Refrigerator },
  { to: "/shopping", label: "Shopping",  icon: ShoppingCart },
  { to: "/chat",     label: "Assistant", icon: MessageCircle },
  { to: "/recipes/import", label: "Import", icon: Upload },
];

function NavItems({ onPick }: { onPick?: () => void }) {
  return (
    <>
      {NAV.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onPick}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-[13.5px] font-medium transition ${
                isActive
                  ? "text-accent-ink bg-accent-soft"
                  : "text-ink-2 hover:bg-surface-2"
              }`
            }
          >
            <Icon size={16} strokeWidth={1.85} />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-[34px] h-[34px] rounded-[10px] bg-accent grid place-items-center text-accent-on">
        <Leaf size={17} strokeWidth={1.85} />
      </div>
      <div>
        <div className="text-[15px] font-bold text-ink-1 -tracking-[0.015em]">Meal Planner</div>
        <div className="text-[11px] text-ink-3">Alex &amp; Sam</div>
      </div>
    </div>
  );
}

function ProfileFooter() {
  return (
    <div className="px-4 py-3.5 border-t border-line-soft flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-full grid place-items-center text-accent-on text-[12px] font-semibold"
           style={{ background: "linear-gradient(135deg, var(--accent) 0%, var(--accent-ink) 100%)" }}>
        A
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-semibold text-ink-1 truncate">Alex Morgan</div>
        <div className="text-[10.5px] text-ink-3 truncate">Self-hosted · Tailscale</div>
      </div>
    </div>
  );
}

export default function Layout() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <div className="flex min-h-screen bg-bg">
      {/* desktop sidebar */}
      <nav className="hidden lg:flex w-[232px] flex-col flex-shrink-0 h-screen sticky top-0 bg-surface-1 border-r border-line">
        <div className="px-5 pt-6 pb-5 border-b border-line-soft">
          <Brand />
        </div>
        <div className="flex-1 p-2.5 flex flex-col gap-px overflow-y-auto">
          <NavItems />
        </div>
        <ProfileFooter />
      </nav>

      {/* mobile top bar */}
      <header className="lg:hidden fixed top-0 inset-x-0 z-40 bg-surface-1 border-b border-line flex items-center justify-between px-4 h-14">
        <Brand />
        <button
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="w-10 h-10 grid place-items-center rounded-[10px] text-ink-2 hover:bg-surface-2"
        >
          <Menu size={20} />
        </button>
      </header>

      {/* mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm amp-fade-in"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute right-0 top-0 h-full w-[78%] max-w-[320px] bg-surface-1 border-l border-line flex flex-col amp-fade-in">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-line-soft">
              <Brand />
              <button
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="w-9 h-9 grid place-items-center rounded-[10px] text-ink-2 hover:bg-surface-2"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 p-3 flex flex-col gap-1 overflow-y-auto">
              <NavItems onPick={() => setOpen(false)} />
            </div>
            <ProfileFooter />
          </aside>
        </div>
      )}

      <main className="flex-1 min-w-0 max-w-full pt-[72px] lg:pt-0">
        <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-10 py-6 lg:py-7 pb-16">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
