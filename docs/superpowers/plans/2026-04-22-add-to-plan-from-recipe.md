# Add-to-Plan from Recipe Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the stubbed "Add to plan" button on the recipe detail page to a new modal that adds the recipe to the most relevant existing plan via the existing `POST /api/plans/:id/meals` endpoint. Delete the stubbed "Scale servings" button. Add a minimal in-house toast primitive to confirm successful adds with a "View plan" action.

**Architecture:** Pure client-side feature — no server changes. Four pieces: (1) extract two reusable helpers (`pickRelevantPlan`, `getNextMonday`) from `Planner.tsx` into `api/plans.ts` so the modal and the planner share the same plan-selection logic; (2) a minimal `ToastProvider` + `Toast` pair mounted once at the app root; (3) an `AddToPlanModal` component that mirrors the visual style of the existing `PlannedMealEditModal` in `Planner.tsx`; (4) the `RecipeDetail` rewire.

**Tech Stack:** React 18 + Tailwind v4 + TypeScript, `react-router-dom` v7, `lucide-react` icons. No new deps. Server: unchanged (existing `POST /api/plans/:id/meals`).

---

## File Structure

### Create

- `client/src/components/AddToPlanModal.tsx` — the modal. Loads plans, computes smart defaults (first empty slot, Sunday-only `isPrep` rule), renders day/slot/servings/cook-style controls, submits via `addPlannedMeal`.
- `client/src/components/ui/ToastProvider.tsx` — context provider with a `show({ message, action? })` function and a single-toast state. Exposes `useToast()`.
- `client/src/components/ui/Toast.tsx` — visual component rendered once by the provider. Hover-pause timer, auto-dismiss after 4s.

### Modify

- `client/src/api/plans.ts` — add exports: `pickRelevantPlan(plans)`, `getNextMonday()`, `localMidnightFromISO(s)`. Internal helpers `planCoversToday`, `planNotPast`, `formatLocalDate` also live here (not exported).
- `client/src/pages/Planner.tsx` — delete the private copies of the extracted helpers and the selection chain inside `useEffect`; import the shared versions instead.
- `client/src/pages/RecipeDetail.tsx` — remove the `Scale servings` `<Button>`; attach `onClick` to the `Add to plan` button to open the modal; on success, call `useToast()` to show confirmation.
- `client/src/App.tsx` — wrap the `<Routes>` in `<ToastProvider>`.

### No changes

- `server/**/*` — no server changes.
- `client/src/pages/Dashboard.tsx` — has its own copies of `planCoversToday` / `planNotPast`; **leaving them alone** (out of scope; different naming, different consumer pattern).

---

## Pre-flight: create the worktree and branch

This feature branches from `master`. The multi-cook-style PR is open against master; if it lands before this one merges, the rebase is trivial (no overlapping files). If it's still open, that's fine — this branch is independent.

- [ ] **Step 1: Create the worktree**

From `C:\Users\mlgbr\Desktop\Projects\AgenticMealPlanner`:
```bash
git fetch origin
git worktree add .worktrees/add-to-plan -b feature/add-to-plan origin/master
cd .worktrees/add-to-plan
```

- [ ] **Step 2: Install deps in the worktree**

```bash
npm install
```

Expected: completes in ~30s. No warnings of note (the existing package-lock noise from the multi-cook worktree may or may not appear; it's benign).

- [ ] **Step 3: Verify baseline**

```bash
cd client && npx tsc --noEmit
cd ../server && npx vitest run
```

Expected: both clean. Server tests should be 28/28 passing.

- [ ] **Step 4 (controller): note the branch doesn't need the server tests**

The feature is client-only. We still run server tests as a sanity check that the baseline is clean, but no later task reruns them.

---

## Task 1: Extract shared helpers into `api/plans.ts`

**Files:**
- Modify: `client/src/api/plans.ts`
- Modify: `client/src/pages/Planner.tsx`

**Why:** The modal needs the same "most relevant plan" selection logic the planner uses, plus `getNextMonday()` for the no-plan-state date label. Today both live inline inside `Planner.tsx`. Extracting avoids drift.

- [ ] **Step 1: Append the helpers to `client/src/api/plans.ts`**

Open `client/src/api/plans.ts`. It currently exports API wrappers (`getPlans`, `createPlan`, `addPlannedMeal`, etc.) and the `WeeklyPlan` / `PlannedMeal` types. Append, at the very bottom of the file (after the last existing export):

```ts
// ---------------------------------------------------------------------------
// Plan / date helpers shared by the Planner and the AddToPlanModal.
// Kept here (not in a separate util module) so every consumer that already
// imports plan types gets the helpers for free.
// ---------------------------------------------------------------------------

export function localMidnightFromISO(s: string): Date {
  // Accepts both "YYYY-MM-DD" and full ISO ("YYYY-MM-DDTHH:mm:ss.sssZ"); always
  // returns local midnight on the calendar date — preserves the date the user
  // chose regardless of their timezone offset.
  return new Date(s.slice(0, 10) + "T00:00:00");
}

function formatLocalDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function getNextMonday(): string {
  // Upcoming Monday on-or-after today, formatted YYYY-MM-DD in local time.
  // Called on a Monday → returns today.
  const now = new Date();
  const day = now.getDay();
  const diff = (8 - day) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return formatLocalDate(monday);
}

function planCoversToday(plan: WeeklyPlan): boolean {
  const start = localMidnightFromISO(plan.weekStartDate);
  if (Number.isNaN(start.getTime())) return false;
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const now = Date.now();
  return now >= start.getTime() && now < end.getTime();
}

function planNotPast(plan: WeeklyPlan): boolean {
  const start = localMidnightFromISO(plan.weekStartDate);
  if (Number.isNaN(start.getTime())) return false;
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return end.getTime() > Date.now();
}

/**
 * Picks the most-relevant plan to surface to the user:
 *   1. a draft that covers today (user is about to finalize this week)
 *   2. any plan covering today (active/completed; still this week's data)
 *   3. the soonest non-past plan (upcoming)
 *   4. null (nothing useful)
 */
export function pickRelevantPlan(plans: WeeklyPlan[]): WeeklyPlan | null {
  const candidates = plans
    .filter(planNotPast)
    .sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate));
  const covering = candidates.filter(planCoversToday);
  return covering.find((pl) => pl.status === "draft")
      ?? covering[0]
      ?? candidates[0]
      ?? null;
}
```

- [ ] **Step 2: Update `Planner.tsx` to import the shared helpers**

Open `client/src/pages/Planner.tsx`. Find the top-of-file helper block (currently lines 41–92 — `localMidnightFromISO`, `formatLocalDate`, `getNextMonday`, `todayKey`, `dayDate`, `planCoversToday`, `planNotPast`). Make three edits:

**Edit A — expand the import from `../api/plans`:**

Currently the import looks roughly like this (keep your local formatting):
```ts
import {
  addPlannedMeal,
  createPlan,
  generatePlan,
  getPlans,
  removePlannedMeal,
  updatePlan,
  updatePlannedMeal,
  type WeeklyPlan,
  type PlannedMeal,
} from "../api/plans";
```

Add the three shared helper imports:
```ts
import {
  addPlannedMeal,
  createPlan,
  generatePlan,
  getPlans,
  getNextMonday,
  localMidnightFromISO,
  pickRelevantPlan,
  removePlannedMeal,
  updatePlan,
  updatePlannedMeal,
  type WeeklyPlan,
  type PlannedMeal,
} from "../api/plans";
```

**Edit B — delete the four helpers now shared.** Remove these functions entirely from the top of the file:
- `localMidnightFromISO`
- `formatLocalDate`
- `getNextMonday`
- `planCoversToday`
- `planNotPast`

Keep `todayKey` and `dayDate` (they stay local to the planner). Do not remove them.

**Edit C — replace the inline "most relevant plan" chain with `pickRelevantPlan`.**

Find the `useEffect` inside `Planner()` (around lines 109–124 today). It currently looks like:

```tsx
  useEffect(() => {
    getPlans().then((p) => {
      // Show the most relevant non-past plan: prefer one that covers today,
      // otherwise the soonest upcoming. Past plans hide so the user gets the
      // New plan CTA instead of a stale board.
      const candidates = p.filter(planNotPast)
        .sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate));
      const covering = candidates.filter(planCoversToday);
      const active = covering.find((pl) => pl.status === "draft")
                  ?? covering[0]
                  ?? candidates[0]
                  ?? null;
      setPlan(active);
    });
    getMeals().then(setMeals).catch(() => setMeals([]));
  }, []);
```

Replace with:

```tsx
  useEffect(() => {
    getPlans().then((p) => setPlan(pickRelevantPlan(p)));
    getMeals().then(setMeals).catch(() => setMeals([]));
  }, []);
```

- [ ] **Step 3: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: clean (no output). If tsc complains about `planCoversToday` / `planNotPast` being referenced elsewhere in `Planner.tsx` that we missed, re-read the file, find the stragglers, and fix — but with the edits above there should be none.

- [ ] **Step 4: Smoke-check the planner still loads**

Start the dev servers (from the repo root of the worktree):

```bash
npm run dev
```

Open `http://localhost:5173/planner` in a browser (or wherever Vite printed). Confirm: the planner renders the active plan just like before the refactor. This is a sanity check — the logic is identical, only its home changed.

- [ ] **Step 5: Commit**

```bash
git add client/src/api/plans.ts client/src/pages/Planner.tsx
git commit -m "refactor(client): extract pickRelevantPlan/getNextMonday into api/plans"
```

---

## Task 2: Toast primitive (ToastProvider + Toast + App wrap)

**Files:**
- Create: `client/src/components/ui/Toast.tsx`
- Create: `client/src/components/ui/ToastProvider.tsx`
- Modify: `client/src/App.tsx`

**Why:** The add-to-plan success feedback uses a toast with a "View plan" action. The app has no toast library and no prior toast usage — build a minimal one that fits the existing design tokens.

- [ ] **Step 1: Create `client/src/components/ui/Toast.tsx`**

```tsx
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
```

- [ ] **Step 2: Create `client/src/components/ui/ToastProvider.tsx`**

```tsx
import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import Toast, { type ToastData } from "./Toast";

type ShowToast = (t: Omit<ToastData, "id">) => void;

const ToastContext = createContext<ShowToast>(() => {
  // Default no-op so consumers outside the provider don't crash, just silently fail.
});

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastData | null>(null);
  const idRef = useRef(0);

  const show = useCallback<ShowToast>((t) => {
    idRef.current += 1;
    setToast({ ...t, id: idRef.current });
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <Toast toast={toast} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}
```

- [ ] **Step 3: Wrap the route tree in `client/src/App.tsx`**

Current file contents:
```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Recipes from "./pages/Recipes";
import RecipeDetail from "./pages/RecipeDetail";
import RecipeImport from "./pages/RecipeImport";
import Planner from "./pages/Planner";
import Pantry from "./pages/Pantry";
import ShoppingList from "./pages/ShoppingList";
import Chat from "./pages/Chat";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/recipes" element={<Recipes />} />
          <Route path="/recipes/:id" element={<RecipeDetail />} />
          <Route path="/recipes/import" element={<RecipeImport />} />
          <Route path="/planner" element={<Planner />} />
          <Route path="/pantry" element={<Pantry />} />
          <Route path="/shopping" element={<ShoppingList />} />
          <Route path="/chat" element={<Chat />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

Add the import and wrap `<Routes>` with `<ToastProvider>` (keep it *inside* `<BrowserRouter>` so any toast handler can use `useNavigate`):

```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Recipes from "./pages/Recipes";
import RecipeDetail from "./pages/RecipeDetail";
import RecipeImport from "./pages/RecipeImport";
import Planner from "./pages/Planner";
import Pantry from "./pages/Pantry";
import ShoppingList from "./pages/ShoppingList";
import Chat from "./pages/Chat";
import { ToastProvider } from "./components/ui/ToastProvider";

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/recipes" element={<Recipes />} />
            <Route path="/recipes/:id" element={<RecipeDetail />} />
            <Route path="/recipes/import" element={<RecipeImport />} />
            <Route path="/planner" element={<Planner />} />
            <Route path="/pantry" element={<Pantry />} />
            <Route path="/shopping" element={<ShoppingList />} />
            <Route path="/chat" element={<Chat />} />
          </Route>
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
```

- [ ] **Step 4: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Verify the dev server still boots and the app still renders**

```bash
npm run dev
```

Open the app in a browser. Confirm every page still loads (sidebar nav works). No visible change — the toast is just a dormant provider at this point.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/ui/Toast.tsx client/src/components/ui/ToastProvider.tsx client/src/App.tsx
git commit -m "feat(client): add minimal in-house toast primitive"
```

---

## Task 3: `AddToPlanModal` component

**Files:**
- Create: `client/src/components/AddToPlanModal.tsx`

**Why:** This is the whole feature. Loads plans, computes defaults, renders controls, submits. Standalone — not wired to any page yet (Task 4 does that).

- [ ] **Step 1: Create `client/src/components/AddToPlanModal.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, Plus, Minus, CalendarDays, Flame, Leaf, ArrowRight } from "lucide-react";
import {
  addPlannedMeal,
  getPlans,
  getNextMonday,
  localMidnightFromISO,
  pickRelevantPlan,
  type WeeklyPlan,
  type PlannedMeal,
} from "../api/plans";
import type { Meal } from "../api/meals";
import Button from "./ui/Button";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
type DayKey = typeof DAYS[number];
type Slot = "lunch" | "dinner";

const DAY_LABELS: Record<DayKey, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed",
  thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun",
};

interface Props {
  meal: Meal;
  onClose: () => void;
  onAdded: (pm: PlannedMeal) => void;
}

export default function AddToPlanModal({ meal, onClose, onAdded }: Props) {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<WeeklyPlan[] | null>(null);
  const [day, setDay] = useState<DayKey>("monday");
  const [slot, setSlot] = useState<Slot>("lunch");
  const [servings, setServings] = useState<number>(meal.servings || 2);
  const [isPrep, setIsPrep] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaultsApplied = useRef(false);

  // Esc-to-close + body-scroll lock, consistent with the other modals in this app.
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

  useEffect(() => {
    getPlans().then(setPlans).catch(() => setPlans([]));
  }, []);

  const targetPlan = useMemo(
    () => (plans ? pickRelevantPlan(plans) : null),
    [plans],
  );

  // Map of day -> slot occupancy for the target plan's week.
  const occupiedByDay = useMemo(() => {
    const map: Record<DayKey, { lunch: PlannedMeal | null; dinner: PlannedMeal | null }> =
      Object.fromEntries(DAYS.map((d) => [d, { lunch: null, dinner: null }])) as any;
    if (targetPlan) {
      for (const pm of targetPlan.plannedMeals) {
        const d = pm.day as DayKey;
        if (!(d in map)) continue;
        if (pm.mealSlot === "lunch" && !map[d].lunch) map[d].lunch = pm;
        if (pm.mealSlot === "dinner" && !map[d].dinner) map[d].dinner = pm;
      }
    }
    return map;
  }, [targetPlan]);

  // When the target plan first resolves, pick defaults: first empty {day, slot}
  // scanning Mon → Sun, Lunch → Dinner per day. Apply the Sunday-only isPrep
  // rule to the chosen defaults. Runs once.
  useEffect(() => {
    if (!targetPlan || defaultsApplied.current) return;
    defaultsApplied.current = true;
    for (const d of DAYS) {
      for (const s of ["lunch", "dinner"] as Slot[]) {
        if (!occupiedByDay[d][s]) {
          setDay(d);
          setSlot(s);
          setIsPrep(d === "sunday" && !!meal.canBatch);
          return;
        }
      }
    }
    // Every slot taken — leave Mon/lunch defaults. isPrep stays false.
  }, [targetPlan, occupiedByDay, meal.canBatch]);

  const targetWeekLabel = useMemo(() => {
    if (!targetPlan) return "";
    return localMidnightFromISO(targetPlan.weekStartDate).toLocaleDateString(
      undefined,
      { weekday: "long", month: "long", day: "numeric" },
    );
  }, [targetPlan]);

  const occupantHere = occupiedByDay[day][slot];

  const submit = async () => {
    if (!targetPlan) return;
    setSubmitting(true);
    setError(null);
    try {
      const pm = await addPlannedMeal(targetPlan.id, {
        mealId: meal.id,
        day,
        mealSlot: slot,
        servings,
        isPrep,
      });
      onAdded(pm as PlannedMeal);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed to add. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const loading = plans === null;
  const noPlan = plans !== null && !targetPlan;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8 amp-fade-in"
      style={{ background: "rgba(30, 22, 10, 0.55)", backdropFilter: "blur(4px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-1 rounded-[16px] w-full max-w-[520px] max-h-[88vh] flex flex-col overflow-hidden border border-line"
        style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
      >
        <div className="flex items-start gap-3 px-4 sm:px-5 py-3.5 border-b border-line-soft">
          <div className="w-8 h-8 rounded-[8px] bg-accent-soft text-accent-ink grid place-items-center">
            <CalendarDays size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-ink-1">Add to plan</div>
            <div className="text-[11px] text-ink-3 truncate">{meal.name}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 grid place-items-center rounded-[8px] text-ink-2 hover:bg-surface-2"
          >
            <X size={16} />
          </button>
        </div>

        {loading && (
          <div className="p-8 text-center text-[13px] text-ink-3">Loading plans…</div>
        )}

        {noPlan && (
          <NoPlanBody
            onGoToPlanner={() => { navigate("/planner"); onClose(); }}
            onCancel={onClose}
          />
        )}

        {!loading && targetPlan && (
          <>
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-5">
              <div className="text-[12px] text-ink-3">
                Adding to week of <span className="text-ink-1 font-medium">{targetWeekLabel}</span>
              </div>

              <Field label="Day">
                <div className="flex gap-1 flex-wrap">
                  {DAYS.map((d) => {
                    const active = day === d;
                    const bucket = occupiedByDay[d];
                    const full = !!(bucket.lunch && bucket.dinner);
                    return (
                      <button
                        key={d}
                        disabled={submitting}
                        onClick={() => setDay(d)}
                        className={`relative px-3 py-1.5 rounded-[8px] text-[12.5px] border transition ${
                          active
                            ? "bg-accent text-accent-on border-accent"
                            : "bg-surface-2 text-ink-1 border-line hover:border-accent-line"
                        } disabled:opacity-60`}
                      >
                        {DAY_LABELS[d]}
                        {full && (
                          <span
                            aria-hidden="true"
                            className={`absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${
                              active ? "bg-accent-on" : "bg-ink-3"
                            }`}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="Slot">
                <div className="flex gap-1.5">
                  {(["lunch", "dinner"] as const).map((s) => {
                    const active = slot === s;
                    return (
                      <button
                        key={s}
                        disabled={submitting}
                        onClick={() => setSlot(s)}
                        className={`px-3 py-1.5 rounded-[8px] text-[12.5px] capitalize border transition ${
                          active
                            ? "bg-accent text-accent-on border-accent"
                            : "bg-surface-2 text-ink-1 border-line hover:border-accent-line"
                        } disabled:opacity-60`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
                {occupantHere ? (
                  <div className="mt-1.5 text-[11.5px] text-warn-ink">
                    Already has <span className="font-medium">{occupantHere.meal.name}</span> in this slot. Confirming will add a second meal.
                  </div>
                ) : (
                  <div className="mt-1.5 text-[11.5px] text-ink-3">Slot is open.</div>
                )}
              </Field>

              <Field label="Servings">
                <div className="flex items-center gap-2">
                  <button
                    disabled={submitting || servings <= 1}
                    onClick={() => setServings((v) => Math.max(1, v - 1))}
                    aria-label="Decrease servings"
                    className="w-9 h-9 grid place-items-center rounded-[8px] bg-surface-2 border border-line text-ink-1 hover:border-accent-line disabled:opacity-40"
                  >
                    <Minus size={14} />
                  </button>
                  <div className="text-[16px] font-semibold text-ink-1 tabular-nums w-10 text-center">{servings}</div>
                  <button
                    disabled={submitting || servings >= 12}
                    onClick={() => setServings((v) => Math.min(12, v + 1))}
                    aria-label="Increase servings"
                    className="w-9 h-9 grid place-items-center rounded-[8px] bg-surface-2 border border-line text-ink-1 hover:border-accent-line disabled:opacity-40"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </Field>

              <Field label="Cook style">
                <div className="flex gap-1.5">
                  {([
                    { value: false, label: "Cook fresh", Icon: Leaf },
                    { value: true,  label: "Batch prep", Icon: Flame },
                  ] as const).map(({ value, label, Icon }) => {
                    const active = isPrep === value;
                    return (
                      <button
                        key={String(value)}
                        disabled={submitting}
                        onClick={() => setIsPrep(value)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12.5px] border transition ${
                          active
                            ? "bg-accent text-accent-on border-accent"
                            : "bg-surface-2 text-ink-1 border-line hover:border-accent-line"
                        } disabled:opacity-60`}
                      >
                        <Icon size={12} /> {label}
                      </button>
                    );
                  })}
                </div>
              </Field>

              {error && (
                <div className="rounded-[10px] border border-warn-line bg-warn-soft text-warn-ink px-3 py-2 text-[13px]">
                  {error}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-4 sm:px-5 py-3 border-t border-line-soft bg-surface-2">
              <Button variant="ghost" size="sm" disabled={submitting} onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" disabled={submitting} onClick={submit}>
                {submitting ? "Adding…" : "Add to plan"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function NoPlanBody({
  onGoToPlanner,
  onCancel,
}: {
  onGoToPlanner: () => void;
  onCancel: () => void;
}) {
  const nextMondayLabel = useMemo(() => {
    const iso = getNextMonday();
    return localMidnightFromISO(iso).toLocaleDateString(undefined, {
      weekday: "long", month: "long", day: "numeric",
    });
  }, []);

  return (
    <>
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-3">
        <div className="w-11 h-11 rounded-[12px] bg-accent-soft text-accent-ink grid place-items-center">
          <CalendarDays size={22} />
        </div>
        <div className="text-[15px] font-semibold text-ink-1">No active plan yet</div>
        <div className="text-[13px] text-ink-2 leading-relaxed max-w-[320px]">
          The next plan would start {nextMondayLabel}. Head to the planner to set it up.
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 px-4 sm:px-5 py-3 border-t border-line-soft bg-surface-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" icon={ArrowRight} onClick={onGoToPlanner}>
          Go to planner
        </Button>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">{label}</div>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: clean. If tsc complains about `meal.canBatch` / `meal.canFresh` being missing, verify the multi-cook-style PR has landed or that your branch base includes those fields on the `Meal` interface — if working on master AFTER the multi-cook merge, it's fine. If `canBatch` / `canFresh` don't exist on `Meal` yet, STOP and coordinate with the person managing that branch.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/AddToPlanModal.tsx
git commit -m "feat(client): AddToPlanModal component"
```

---

## Task 4: Wire `RecipeDetail` (delete Scale servings, wire Add to plan)

**Files:**
- Modify: `client/src/pages/RecipeDetail.tsx`

- [ ] **Step 1: Open `client/src/pages/RecipeDetail.tsx` and read it end-to-end**

This is the target file. You'll make three changes (imports, local state + handler, JSX action row).

- [ ] **Step 2: Update imports**

Current imports (lines 1–21 of the file):

```tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  Clock,
  Flame,
  Leaf,
  Users,
  CalendarPlus,
  Replace,
  FileText,
  Trash2,
  Camera,
  FileUp,
  RefreshCw,
} from "lucide-react";
import { deleteMeal, getMeal, uploadMealPhoto, uploadMealPdf, extractMealThumbnail, type Meal } from "../api/meals";
import Pill from "../components/ui/Pill";
import PhotoTile from "../components/ui/PhotoTile";
import Button from "../components/ui/Button";
import { toneForMeal } from "../theme/photoTone";
```

Two changes to imports:

1. **Remove `Replace`** from the `lucide-react` import block (it was used only by the Scale servings button we're removing).
2. **Add imports** for the modal, the toast hook, and a constant for pretty day labels:

```tsx
import AddToPlanModal from "../components/AddToPlanModal";
import { useToast } from "../components/ui/ToastProvider";
import type { PlannedMeal } from "../api/plans";
```

Final imports should read:

```tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  Clock,
  Flame,
  Leaf,
  Users,
  CalendarPlus,
  FileText,
  Trash2,
  Camera,
  FileUp,
  RefreshCw,
} from "lucide-react";
import { deleteMeal, getMeal, uploadMealPhoto, uploadMealPdf, extractMealThumbnail, type Meal } from "../api/meals";
import AddToPlanModal from "../components/AddToPlanModal";
import { useToast } from "../components/ui/ToastProvider";
import type { PlannedMeal } from "../api/plans";
import Pill from "../components/ui/Pill";
import PhotoTile from "../components/ui/PhotoTile";
import Button from "../components/ui/Button";
import { toneForMeal } from "../theme/photoTone";
```

- [ ] **Step 3: Add day-label constant (top of file, outside the component)**

After the imports and before `function parseInstructions(...)`, add:

```tsx
const DAY_LONG: Record<string, string> = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday",
  thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};
```

- [ ] **Step 4: Add modal state + toast hook inside the component**

Inside `RecipeDetail()`, near the other `useState` calls (currently around line 39), add:

```tsx
  const [addOpen, setAddOpen] = useState(false);
  const toast = useToast();
```

The `useToast` call must be inside the component body (hooks rule).

- [ ] **Step 5: Replace the "Add to plan" / "Scale servings" button row**

Find this block in the JSX (around lines 114–126 of the current file):

```tsx
          <div className="flex gap-2 mt-2 flex-wrap">
            <Button variant="primary" icon={CalendarPlus}>Add to plan</Button>
            <Button variant="ghost" icon={Replace}>Scale servings</Button>
            {hasPdf && (
              <Button
                variant="ghost"
                icon={FileText}
                onClick={() => window.open(`/media/meals/${meal.id}/source.pdf`, "_blank", "noopener,noreferrer")}
              >
                Original PDF
              </Button>
            )}
          </div>
```

Replace with (Scale servings deleted, Add to plan wired):

```tsx
          <div className="flex gap-2 mt-2 flex-wrap">
            <Button variant="primary" icon={CalendarPlus} onClick={() => setAddOpen(true)}>
              Add to plan
            </Button>
            {hasPdf && (
              <Button
                variant="ghost"
                icon={FileText}
                onClick={() => window.open(`/media/meals/${meal.id}/source.pdf`, "_blank", "noopener,noreferrer")}
              >
                Original PDF
              </Button>
            )}
          </div>
```

- [ ] **Step 6: Render the modal**

At the bottom of the component's top-level JSX, just before the closing `</div>` of the outermost `<div className="flex flex-col gap-6 max-w-[920px]">` (around line 174 — there is no existing modal block here, so this is a new addition), add:

```tsx
      {addOpen && (
        <AddToPlanModal
          meal={meal}
          onClose={() => setAddOpen(false)}
          onAdded={(pm: PlannedMeal) => {
            toast({
              message: `Added to ${DAY_LONG[pm.day] ?? pm.day} ${pm.mealSlot}`,
              action: { label: "View plan", onClick: () => navigate("/planner") },
            });
          }}
        />
      )}
```

Concretely, the last lines of the main return's top-level JSX should transition from this (current):

```tsx
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-8 mt-2">
        <div>
          {/* ingredients */}
          ...
        </div>
        <div>
          {/* instructions */}
          ...
        </div>
      </div>
    </div>
  );
}
```

to this (the modal conditional added before the outer closing `</div>`):

```tsx
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-8 mt-2">
        <div>
          {/* ingredients */}
          ...
        </div>
        <div>
          {/* instructions */}
          ...
        </div>
      </div>

      {addOpen && (
        <AddToPlanModal
          meal={meal}
          onClose={() => setAddOpen(false)}
          onAdded={(pm: PlannedMeal) => {
            toast({
              message: `Added to ${DAY_LONG[pm.day] ?? pm.day} ${pm.mealSlot}`,
              action: { label: "View plan", onClick: () => navigate("/planner") },
            });
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 7: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: clean. If tsc complains that `Replace` is an unused import — that means step 2 was missed. Re-read.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/RecipeDetail.tsx
git commit -m "feat(client): wire Add to plan; drop Scale servings stub"
```

---

## Task 5: Manual smoke test

No code changes — just exercise the flows. Do this on the dev server's live app (or locally against the same API port).

**Setup:**

```bash
npm run dev
```

Open `http://localhost:5173` (or wherever Vite printed).

- [ ] **Smoke 1 — happy path**

1. Navigate to `/recipes` and open any recipe.
2. Verify the action row shows **Add to plan** and **Original PDF** (if the recipe has a PDF), with **no "Scale servings" button**.
3. Click **Add to plan**.
4. The modal opens. Inspect:
   - Header: "Add to plan" + recipe name.
   - "Adding to week of [Monday, <date>]".
   - Day capsules highlight one day (pre-selected).
   - Slot toggle shows Lunch/Dinner with one active.
   - Servings stepper shows the recipe's base serving count.
   - Cook style shows the expected default (Fresh, unless Sunday is pre-selected AND meal.canBatch is true → Batch).
5. Change the day/slot/servings to something specific and click **Add to plan**.
6. Modal closes. A toast appears bottom-right: "Added to [Day] [slot]" with a "View plan" link.
7. Click **View plan**. It navigates to `/planner`. The added meal appears in the planner at the chosen day/slot.

- [ ] **Smoke 2 — occupied slot warning**

1. From a recipe page, open the modal again.
2. Pick a day+slot that already has a meal (use the planner to pre-check, or try the default day's other slot — one of them is likely occupied).
3. Below the slot toggle, confirm the amber text: "Already has <meal name> in this slot. Confirming will add a second meal."
4. Cancel (don't confirm).

- [ ] **Smoke 3 — no-plan state**

1. Hide existing plans by shifting their `week_start_date` 60 days into the past so `planNotPast` rejects them. Use an SSH heredoc so psql reads the SQL from stdin (avoids nested-quote hell):
   ```bash
   ssh -p 22 swizz@100.114.226.44 'cd /home/swizz/projects/AgenticMealPlanner/server && DATABASE_URL=$(grep "^DATABASE_URL" .env | cut -d= -f2- | tr -d "\"" | tr -d "'\''" | sed "s/?.*$//") && psql "$DATABASE_URL"' <<'EOF'
   UPDATE weekly_plans SET week_start_date = week_start_date - INTERVAL '60 days';
   EOF
   ```
2. Reload the app, open a recipe, click **Add to plan**.
3. Modal shows "No active plan yet" + the next Monday date + "Go to planner" button.
4. Click **Go to planner**. Navigates to `/planner`. No plan change server-side.
5. Revert the nudge:
   ```bash
   ssh -p 22 swizz@100.114.226.44 'cd /home/swizz/projects/AgenticMealPlanner/server && DATABASE_URL=$(grep "^DATABASE_URL" .env | cut -d= -f2- | tr -d "\"" | tr -d "'\''" | sed "s/?.*$//") && psql "$DATABASE_URL"' <<'EOF'
   UPDATE weekly_plans SET week_start_date = week_start_date + INTERVAL '60 days';
   EOF
   ```
6. Reload the app; confirm existing plans are back.

- [ ] **Smoke 4 — server error**

1. Stop the server tsx watcher (`tmux attach -t mp` on the WSL host, Ctrl-C, or kill the process on port 3100).
2. Open a recipe, open the modal, click **Add to plan**.
3. After the request times out/errors, the modal stays open with an amber error banner at the bottom.
4. Restart the server and confirm retry works.

- [ ] **Final commit (if smoke tests caught issues)**

If any smoke test surfaced a bug, fix it, re-run the specific test, and commit with a descriptive message. If all four smoke tests pass on the first try, no additional commit needed.

- [ ] **Final typecheck + server baseline**

```bash
cd client && npx tsc --noEmit
cd ../server && npx vitest run
```

Expected: client tsc clean; server tests still 28/28 passing.

---

## Task 6: Push and open PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feature/add-to-plan
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat: Add-to-plan modal from recipe detail" --body "$(cat <<'EOF'
## Summary

- Wire the stubbed "Add to plan" button on `/recipes/:id` to a new `AddToPlanModal` that picks the most-relevant plan (shared `pickRelevantPlan` helper, extracted from `Planner.tsx`), computes a smart default slot, and submits via the existing `POST /api/plans/:id/meals` endpoint.
- Delete the "Scale servings" stub — the planner's per-occurrence `PlannedMealEditModal` servings stepper already covers the real use case.
- Add a minimal in-house `ToastProvider` / `Toast` pair, mounted at the app root, to surface "Added to Thursday dinner" with a "View plan" action.

## Test plan

- [x] Happy path: open modal, override defaults, confirm → toast appears → planner shows the added meal.
- [x] Occupied slot: warning appears but confirm still works (server creates a second row).
- [x] No plan: modal shows the "Go to planner" state; navigation works.
- [x] Server error: inline error banner, modal stays open, retry works after server restart.
- [x] Client typecheck (`npx tsc --noEmit`) clean.
- [x] Server tests (`npx vitest run`) still 28/28 passing (feature is client-only).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Report the PR URL when done.
