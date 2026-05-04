# Multi-Week Shopping List Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add prev/next/today week navigation to the Shopping List page, mirroring the planner's URL-driven pattern, with a six-state body matrix (past × {list-exists, plan-but-no-list, no-plan}, current/future × same). Fix the broken header-date bug while we're touching the file.

**Architecture:** Pure client-side. The page stops calling `plans.find((p) => p.status === "active") ?? plans[0]` to collapse to one plan; instead it loads all plans, derives `viewedWeek` from the URL via React Router's `useSearchParams`, and picks the matching plan via `pickPlanForWeek` (helper from `api/plans.ts`). When `viewedPlan.id` changes, the items refetch. Past weeks are strictly read-only (no toggle, no Regenerate, no Generate-after-the-fact).

**Tech Stack:** React 18, TypeScript, `react-router-dom` v7 (`useSearchParams`), Tailwind v4. No new dependencies. Server is unchanged — `GET /api/plans`, `GET /api/shopping/:planId`, `POST /api/shopping/generate/:planId`, `PUT /api/shopping/item/:id` all stay as-is.

**Depends on:** the multi-week-planner work (`feature/multi-week-planner` branch). It exports `parseWeekParam` and `pickPlanForWeek` from `client/src/api/plans.ts` — both are required here. `localMidnightFromISO` is already on `master`.

---

## File Structure

### Modify

- `client/src/pages/ShoppingList.tsx` — main change. Swap single-plan state for `plans: WeeklyPlan[]` + URL-derived `viewedWeek`. Add prev/next/Today controls. Replace the body's single conditional with a six-state matrix. Disable checkbox toggling on past weeks. Fix the broken `monthLabel` computation.

### No changes

- `server/**/*` — no schema changes, no new endpoints.
- `client/src/api/shopping.ts` — types and fetchers stay as-is.
- `client/src/api/plans.ts` — relies on existing exports (`parseWeekParam`, `pickPlanForWeek`, `localMidnightFromISO`). The two new ones are added by the multi-week-planner work.
- `client/src/pages/Planner.tsx`, anything else — untouched.

---

## Pre-flight: pick a base branch and create the worktree

This feature **depends on `parseWeekParam` and `pickPlanForWeek` from the multi-week-planner work**. Two paths depending on whether that PR has merged:

### Option A — multi-week-planner has merged to master

```bash
cd C:\Users\mlgbr\Desktop\Projects\AgenticMealPlanner
git fetch origin
git worktree add .worktrees/multi-week-shopping -b feature/multi-week-shopping origin/master
cd .worktrees/multi-week-shopping
```

### Option B — multi-week-planner is still an open PR

Base on the planner's branch directly so the helpers are present:

```bash
cd C:\Users\mlgbr\Desktop\Projects\AgenticMealPlanner
git fetch origin
git worktree add .worktrees/multi-week-shopping -b feature/multi-week-shopping origin/feature/multi-week-planner
cd .worktrees/multi-week-shopping
```

If you base on Option B, the eventual PR's base should also be `feature/multi-week-planner` (use `gh pr create --base feature/multi-week-planner ...` in Task 6). When `feature/multi-week-planner` merges to master, the shopping PR will automatically retarget to master in GitHub's UI, or you can `gh pr edit <num> --base master` to flip it explicitly.

To choose: `gh pr view <planner-PR-number> --json state` — `MERGED` → Option A; anything else → Option B.

- [ ] **Step 1: Decide base, run the matching worktree command above**

- [ ] **Step 2: Verify the helpers are present**

```bash
grep -E "^export function (parseWeekParam|pickPlanForWeek)" client/src/api/plans.ts
```

Expected: two matching lines. If missing, you branched from the wrong base — destroy the worktree (`git worktree remove .worktrees/multi-week-shopping --force`) and try the other option.

- [ ] **Step 3: Install deps**

```bash
npm install
```

Expected: ~30s. Some moderate-severity audit warnings — benign.

- [ ] **Step 4: Generate Prisma client locally so the typecheck baseline doesn't fail**

```bash
cd server && npx prisma generate
```

Expected: `✔ Generated Prisma Client`. No DB access required.

- [ ] **Step 5: Verify baseline**

```bash
cd ../client && npx tsc --noEmit
cd ../server && npx vitest run
```

Expected: client tsc clean. Server tests at the current passing count for whatever base you picked (no server work in this plan; accept whatever passes).

---

## Task 1: Refactor ShoppingList data flow + fix broken date

**Files:**
- Modify: `client/src/pages/ShoppingList.tsx`

**Why:** Replace the `plan: WeeklyPlan | null` single-plan state with `plans: WeeklyPlan[]` + URL-derived `viewedWeek`. Refetch items when the viewed plan id changes. Fix the broken `monthLabel` computation (currently double-appends `T00:00:00` to an already-ISO string, producing "Invalid Date"). No new UI controls in this task — the existing layout still works once the data flow is correct.

- [ ] **Step 1: Update imports**

Open `client/src/pages/ShoppingList.tsx`. The current top-of-file imports look like:

```tsx
import { useEffect, useMemo, useState } from "react";
import { RefreshCw, CheckCircle2, Check } from "lucide-react";
import { getPlans, type WeeklyPlan } from "../api/plans";
import {
  generateShoppingList,
  getShoppingList,
  toggleItem,
  type ShoppingItem,
} from "../api/shopping";
import Button from "../components/ui/Button";
```

Replace with:

```tsx
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw, CheckCircle2, Check } from "lucide-react";
import {
  getPlans,
  localMidnightFromISO,
  parseWeekParam,
  pickPlanForWeek,
  type WeeklyPlan,
} from "../api/plans";
import {
  generateShoppingList,
  getShoppingList,
  toggleItem,
  type ShoppingItem,
} from "../api/shopping";
import Button from "../components/ui/Button";
```

- [ ] **Step 2: Replace the component's state and effects**

Find the top of `ShoppingList()` (currently lines 24–35):

```tsx
export default function ShoppingList() {
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    getPlans().then((plans) => {
      const active = plans.find((p) => p.status === "active") ?? plans[0] ?? null;
      setPlan(active);
      if (active) getShoppingList(active.id).then(setItems).catch(() => setItems([]));
    });
  }, []);
```

Replace with:

```tsx
export default function ShoppingList() {
  const [plans, setPlans] = useState<WeeklyPlan[]>([]);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [generating, setGenerating] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // The viewed week is the URL's source of truth. parseWeekParam normalizes
  // mid-week dates, garbage strings, or a missing param to a Monday in
  // local time.
  const rawWeekParam = searchParams.get("week");
  const viewedWeek = parseWeekParam(rawWeekParam);

  // If the URL was missing or non-canonical, replace it (don't push) so the
  // initial-load redirect doesn't pollute browser history.
  useEffect(() => {
    if (rawWeekParam !== viewedWeek) {
      setSearchParams({ week: viewedWeek }, { replace: true });
    }
  }, [rawWeekParam, viewedWeek, setSearchParams]);

  useEffect(() => {
    getPlans().then(setPlans).catch(() => setPlans([]));
  }, []);

  const viewedPlan = useMemo(
    () => pickPlanForWeek(plans, viewedWeek),
    [plans, viewedWeek],
  );

  // Refetch items when viewedPlan.id changes (or when it goes from null to
  // non-null on initial plans load).
  useEffect(() => {
    if (!viewedPlan) {
      setItems([]);
      return;
    }
    getShoppingList(viewedPlan.id).then(setItems).catch(() => setItems([]));
  }, [viewedPlan?.id]);
```

- [ ] **Step 3: Update the `handleGenerate` and `handleToggle` handlers**

Find the existing handlers (currently lines 37–48):

```tsx
  const handleGenerate = async () => {
    if (!plan) return;
    setGenerating(true);
    try {
      setItems(await generateShoppingList(plan.id));
    } finally { setGenerating(false); }
  };

  const handleToggle = async (id: number, checked: boolean) => {
    await toggleItem(id, checked);
    setItems(items.map((i) => i.id === id ? { ...i, checked } : i));
  };
```

Replace with:

```tsx
  const handleGenerate = async () => {
    if (!viewedPlan) return;
    setGenerating(true);
    try {
      setItems(await generateShoppingList(viewedPlan.id));
    } finally { setGenerating(false); }
  };

  const handleToggle = async (id: number, checked: boolean) => {
    await toggleItem(id, checked);
    setItems(items.map((i) => i.id === id ? { ...i, checked } : i));
  };
```

(The toggle handler doesn't gain the past-week guard yet — that lands in Task 3 along with the rest of the read-only behavior. Today the page only shows one plan; a one-task gap where the user could in theory toggle a past list is fine since there's still no UI to navigate to a past week.)

- [ ] **Step 4: Fix the broken-date `monthLabel` computation**

Find this block (currently lines 54–56):

```tsx
  const monthLabel = plan?.weekStartDate
    ? new Date(plan.weekStartDate + "T00:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric" })
    : null;
```

Replace with:

```tsx
  const monthLabel = localMidnightFromISO(viewedWeek)
    .toLocaleDateString(undefined, { month: "long", day: "numeric" });
```

`viewedWeek` is always a canonical YYYY-MM-DD Monday, so the label is always valid (no `null` case). The label now derives from the URL, not from an optional plan, so it still renders correctly on weeks with no plan.

- [ ] **Step 5: Update the JSX to use `viewedPlan` instead of `plan`**

Find each `plan` reference in the JSX (currently around lines 60–117) and update:

The header `monthLabel` conditional becomes unconditional (since `monthLabel` is always defined now):

```tsx
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[12px] uppercase tracking-[0.1em] text-ink-3 mb-1.5">
            Week of {monthLabel} · {toBuy.length} to buy
          </div>
          <h1 className="text-[26px] sm:text-[30px] font-semibold -tracking-[0.02em] text-ink-1">Shopping List</h1>
        </div>
        {viewedPlan && (
          <Button variant="ghost" icon={RefreshCw} onClick={handleGenerate} disabled={generating}>
            {generating ? "Regenerating…" : items.length ? "Regenerate" : "Generate"}
          </Button>
        )}
      </div>
```

The empty-state conditional updates from `!plan` to `!viewedPlan`:

```tsx
      {!viewedPlan && (
        <div className="rounded-[16px] border border-dashed border-line bg-surface-1 p-10 text-center text-ink-2">
          No active plan. Create one in the Planner first.
        </div>
      )}
```

The rest of the JSX (`toBuy`, `alreadyHave`, `done` sections, `Section`, `Row`, `byCategory`) doesn't reference `plan` directly, so no other changes needed here.

- [ ] **Step 6: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: clean. If tsc complains about `plan` being undefined or `monthLabel` having the wrong type, double-check Steps 2 and 4.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/ShoppingList.tsx
git commit -m "refactor(client): ShoppingList data flow is URL-driven; fix broken date"
```

---

## Task 2: Add prev / next / Today navigation controls

**Files:**
- Modify: `client/src/pages/ShoppingList.tsx`

**Why:** Task 1 made the page URL-aware but added no controls; the user can only change weeks by manually editing the URL. Add the three header buttons matching the planner's pattern.

- [ ] **Step 1: Add a `stepWeek` helper at the top of `ShoppingList.tsx`**

Find the top-of-file constants section (currently `CATEGORY_LABELS` around lines 12–22). Just below the `CATEGORY_LABELS` map, add:

```tsx
function stepWeek(weekStart: string, deltaDays: number): string {
  const d = new Date(weekStart + "T00:00:00");
  d.setDate(d.getDate() + deltaDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
```

(This duplicates the same helper from `Planner.tsx`; that's intentional — a tiny date helper is cheaper to duplicate than to factor into a third location. If a third caller appears, hoist it into `api/plans.ts` then.)

- [ ] **Step 2: Add lucide icons for the navigation controls**

Find the `lucide-react` import (currently line 2):

```tsx
import { RefreshCw, CheckCircle2, Check } from "lucide-react";
```

Replace with:

```tsx
import { RefreshCw, CheckCircle2, Check, ChevronLeft, ChevronRight } from "lucide-react";
```

- [ ] **Step 3: Add the navigation handlers + "is today" computation inside `ShoppingList()`**

Inside `ShoppingList()`, just before `const handleGenerate = ...`, add:

```tsx
  const todayWeek = useMemo(() => parseWeekParam(null), []);
  const isViewingToday = viewedWeek === todayWeek;

  const goPrevWeek = () => setSearchParams({ week: stepWeek(viewedWeek, -7) });
  const goNextWeek = () => setSearchParams({ week: stepWeek(viewedWeek, +7) });
  const goToday    = () => { if (!isViewingToday) setSearchParams({ week: todayWeek }); };
```

- [ ] **Step 4: Replace the page header to include navigation controls**

Find the current header (after Task 1, around lines 60–74):

```tsx
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[12px] uppercase tracking-[0.1em] text-ink-3 mb-1.5">
            Week of {monthLabel} · {toBuy.length} to buy
          </div>
          <h1 className="text-[26px] sm:text-[30px] font-semibold -tracking-[0.02em] text-ink-1">Shopping List</h1>
        </div>
        {viewedPlan && (
          <Button variant="ghost" icon={RefreshCw} onClick={handleGenerate} disabled={generating}>
            {generating ? "Regenerating…" : items.length ? "Regenerate" : "Generate"}
          </Button>
        )}
      </div>
```

Replace with:

```tsx
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <button
              onClick={goPrevWeek}
              aria-label="Previous week"
              className="w-7 h-7 grid place-items-center rounded-[8px] text-ink-2 hover:bg-surface-2 hover:text-ink-1"
            >
              <ChevronLeft size={14} />
            </button>
            <div className="text-[12px] uppercase tracking-[0.1em] text-ink-3 select-none">
              Week of {monthLabel}{toBuy.length > 0 ? ` · ${toBuy.length} to buy` : ""}
            </div>
            <button
              onClick={goNextWeek}
              aria-label="Next week"
              className="w-7 h-7 grid place-items-center rounded-[8px] text-ink-2 hover:bg-surface-2 hover:text-ink-1"
            >
              <ChevronRight size={14} />
            </button>
            <button
              onClick={goToday}
              disabled={isViewingToday}
              className="ml-1 px-2 py-1 text-[11px] uppercase tracking-[0.08em] font-semibold rounded-[8px] text-ink-2 hover:bg-surface-2 hover:text-ink-1 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-ink-2"
            >
              Today
            </button>
          </div>
          <h1 className="text-[26px] sm:text-[30px] font-semibold -tracking-[0.02em] text-ink-1">Shopping List</h1>
        </div>
        {viewedPlan && (
          <Button variant="ghost" icon={RefreshCw} onClick={handleGenerate} disabled={generating}>
            {generating ? "Regenerating…" : items.length ? "Regenerate" : "Generate"}
          </Button>
        )}
      </div>
```

(The `· N to buy` count now only appends when `toBuy.length > 0`. On weeks with no items, the header reads cleanly as `Week of <date>` without a dangling "0 to buy".)

- [ ] **Step 5: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/ShoppingList.tsx
git commit -m "feat(client): prev/next/today navigation on Shopping List"
```

---

## Task 3: Six-state body matrix + past-week read-only

**Files:**
- Modify: `client/src/pages/ShoppingList.tsx`

**Why:** Replace the existing single empty-state branch with the spec's full six-state matrix. Disable item toggling on past weeks. Hide the header Regenerate button on past weeks (a list with no edit affordance shouldn't have a regenerate button either).

- [ ] **Step 1: Add `isPastWeek` + `useNavigate` for the planner-link CTA**

Find the existing imports for `react-router-dom` (after Task 1, line 2):

```tsx
import { useSearchParams } from "react-router-dom";
```

Replace with:

```tsx
import { useNavigate, useSearchParams } from "react-router-dom";
```

Inside `ShoppingList()`, just below the existing `isViewingToday` line (added in Task 2), add:

```tsx
  const isPastWeek = viewedWeek < todayWeek;
  const navigate = useNavigate();
```

(String comparison works because both sides are canonical YYYY-MM-DD.)

- [ ] **Step 2: Make `handleToggle` a no-op on past weeks**

Find the `handleToggle` (currently around lines 45–48):

```tsx
  const handleToggle = async (id: number, checked: boolean) => {
    await toggleItem(id, checked);
    setItems(items.map((i) => i.id === id ? { ...i, checked } : i));
  };
```

Replace with:

```tsx
  const handleToggle = async (id: number, checked: boolean) => {
    if (isPastWeek) return; // past weeks are strictly read-only
    await toggleItem(id, checked);
    setItems(items.map((i) => i.id === id ? { ...i, checked } : i));
  };
```

- [ ] **Step 3: Tighten the header Regenerate button visibility**

The existing condition is `{viewedPlan && ...}`. After Task 1, the button shows whenever a plan exists. We want it only when:
- `viewedPlan` is non-null (something to regenerate from)
- `!isPastWeek` (no edits to history)
- `items.length > 0` (otherwise the body's Generate CTA covers the no-list case)

Find the header Regenerate block (after Task 2, in the header section):

```tsx
        {viewedPlan && (
          <Button variant="ghost" icon={RefreshCw} onClick={handleGenerate} disabled={generating}>
            {generating ? "Regenerating…" : items.length ? "Regenerate" : "Generate"}
          </Button>
        )}
```

Replace with:

```tsx
        {viewedPlan && !isPastWeek && items.length > 0 && (
          <Button variant="ghost" icon={RefreshCw} onClick={handleGenerate} disabled={generating}>
            {generating ? "Regenerating…" : "Regenerate"}
          </Button>
        )}
```

(The "Generate" copy variant was for the case `viewedPlan && items.length === 0`. That case now lives in the body's CTA card, which has its own Generate button. The header button collapses to "Regenerate" only.)

- [ ] **Step 4: Replace the body's empty-state branch with the six-state matrix**

Find the existing empty-state block (after Task 1, around lines 76–80):

```tsx
      {!viewedPlan && (
        <div className="rounded-[16px] border border-dashed border-line bg-surface-1 p-10 text-center text-ink-2">
          No active plan. Create one in the Planner first.
        </div>
      )}
```

Replace with:

```tsx
      {!viewedPlan ? (
        <NoPlanCard
          isPastWeek={isPastWeek}
          viewedWeek={viewedWeek}
          monthLabel={monthLabel}
          onGoToPlanner={() => navigate(`/planner?week=${viewedWeek}`)}
        />
      ) : items.length === 0 ? (
        <NoListCard
          isPastWeek={isPastWeek}
          generating={generating}
          onGenerate={handleGenerate}
        />
      ) : null}
```

(The populated-list rendering — `toBuy`, `alreadyHave`, `done` blocks — stays exactly as it is. Those blocks already check `> 0` before rendering, so they stay invisible when `items` is empty. The new branches only handle the empty cases above them.)

- [ ] **Step 5: Pass `disabled` to the populated `Row` rendering for past weeks**

Find the existing `toBuy.length > 0` rendering block (around lines 82–95 today, kept by Task 1):

```tsx
      {toBuy.length > 0 && (
        <Section title="To buy" count={toBuy.length}>
          {byCategory(toBuy).map(([cat, list]) => (
            <div key={cat}>
              <div className="px-4 sm:px-5 pt-2.5 pb-1 text-[11px] font-semibold text-accent-ink tracking-[0.05em] uppercase">
                {CATEGORY_LABELS[cat] ?? cat}
              </div>
              {list.map((item, i) => (
                <Row key={item.id} item={item} onToggle={handleToggle} last={i === list.length - 1} />
              ))}
            </div>
          ))}
        </Section>
      )}
```

Replace with (only the `<Row>` line changes — `disabled={isPastWeek}` added):

```tsx
      {toBuy.length > 0 && (
        <Section title="To buy" count={toBuy.length}>
          {byCategory(toBuy).map(([cat, list]) => (
            <div key={cat}>
              <div className="px-4 sm:px-5 pt-2.5 pb-1 text-[11px] font-semibold text-accent-ink tracking-[0.05em] uppercase">
                {CATEGORY_LABELS[cat] ?? cat}
              </div>
              {list.map((item, i) => (
                <Row key={item.id} item={item} onToggle={handleToggle} last={i === list.length - 1} disabled={isPastWeek} />
              ))}
            </div>
          ))}
        </Section>
      )}
```

Same for the `alreadyHave` block (around lines 97–106):

```tsx
      {alreadyHave.length > 0 && (
        <div className="bg-accent-soft border border-accent-line rounded-[14px] overflow-hidden">
          <div className="px-4 sm:px-5 py-3 text-[11px] text-accent-ink uppercase tracking-[0.08em] flex items-center gap-1.5 font-semibold">
            <CheckCircle2 size={12} /> Already in pantry · {alreadyHave.length}
          </div>
          {alreadyHave.map((item, i) => (
            <Row key={item.id} item={item} onToggle={handleToggle} last={i === alreadyHave.length - 1} muted disabled={isPastWeek} />
          ))}
        </div>
      )}
```

Same for the `done` block (around lines 108–117):

```tsx
      {done.length > 0 && (
        <div className="opacity-65 bg-surface-1 border border-line rounded-[14px] overflow-hidden">
          <div className="px-4 sm:px-5 py-3 text-[11px] text-ink-3 uppercase tracking-[0.08em]">
            Done · {done.length}
          </div>
          {done.map((item, i) => (
            <Row key={item.id} item={item} onToggle={handleToggle} last={i === done.length - 1} strikethrough disabled={isPastWeek} />
          ))}
        </div>
      )}
```

- [ ] **Step 6: Update the `Row` component to accept and use `disabled`**

Find the existing `Row` component (currently around lines 134–174):

```tsx
function Row({
  item, onToggle, last, muted, strikethrough,
}: {
  item: ShoppingItem;
  onToggle: (id: number, checked: boolean) => void;
  last: boolean;
  muted?: boolean;
  strikethrough?: boolean;
}) {
  return (
    <label
      className={`grid grid-cols-[auto_1fr_auto] gap-3 items-center px-4 sm:px-5 py-3 cursor-pointer ${last ? "" : "border-b border-line-soft"}`}
    >
      <span
        className="w-5 h-5 rounded-[6px] grid place-items-center"
        style={{
          border: `1.5px solid ${item.checked ? "var(--accent)" : "var(--ink-3)"}`,
          background: item.checked ? "var(--accent)" : "transparent",
          color: "var(--accent-on)",
        }}
      >
        {item.checked && <Check size={13} strokeWidth={2.5} />}
      </span>
      <input
        type="checkbox"
        checked={item.checked}
        onChange={() => onToggle(item.id, !item.checked)}
        className="hidden"
      />
      <div
        className={`text-[14px] ${muted ? "text-ink-2" : "text-ink-1"}`}
        style={{ textDecoration: strikethrough ? "line-through" : "none" }}
      >
        {item.ingredient.name}
      </div>
      <div className="text-[12.5px] text-ink-3 tabular-nums">
        {item.quantityToBuy > 0 ? `${item.quantityToBuy} ${item.ingredient.defaultUnit ?? ""}` : `Have ${item.quantityNeeded} ${item.ingredient.defaultUnit ?? ""}`}
      </div>
    </label>
  );
}
```

Replace with:

```tsx
function Row({
  item, onToggle, last, muted, strikethrough, disabled,
}: {
  item: ShoppingItem;
  onToggle: (id: number, checked: boolean) => void;
  last: boolean;
  muted?: boolean;
  strikethrough?: boolean;
  disabled?: boolean;
}) {
  // When disabled, render a plain <div> so the wrapper isn't clickable.
  // The hidden <input> isn't rendered either — it can't be reached visually
  // and it would be confusing to keep a tabbable disabled checkbox around.
  const Wrapper: any = disabled ? "div" : "label";
  return (
    <Wrapper
      className={`grid grid-cols-[auto_1fr_auto] gap-3 items-center px-4 sm:px-5 py-3 ${disabled ? "cursor-not-allowed opacity-80" : "cursor-pointer"} ${last ? "" : "border-b border-line-soft"}`}
    >
      <span
        className="w-5 h-5 rounded-[6px] grid place-items-center"
        style={{
          border: `1.5px solid ${item.checked ? "var(--accent)" : "var(--ink-3)"}`,
          background: item.checked ? "var(--accent)" : "transparent",
          color: "var(--accent-on)",
        }}
      >
        {item.checked && <Check size={13} strokeWidth={2.5} />}
      </span>
      {!disabled && (
        <input
          type="checkbox"
          checked={item.checked}
          onChange={() => onToggle(item.id, !item.checked)}
          className="hidden"
        />
      )}
      <div
        className={`text-[14px] ${muted ? "text-ink-2" : "text-ink-1"}`}
        style={{ textDecoration: strikethrough ? "line-through" : "none" }}
      >
        {item.ingredient.name}
      </div>
      <div className="text-[12.5px] text-ink-3 tabular-nums">
        {item.quantityToBuy > 0 ? `${item.quantityToBuy} ${item.ingredient.defaultUnit ?? ""}` : `Have ${item.quantityNeeded} ${item.ingredient.defaultUnit ?? ""}`}
      </div>
    </Wrapper>
  );
}
```

- [ ] **Step 7: Add the two empty-state card components at the bottom of the file**

After the existing `byCategory` function (at the very end of the file), append:

```tsx
function NoPlanCard({
  isPastWeek,
  monthLabel,
  onGoToPlanner,
}: {
  isPastWeek: boolean;
  viewedWeek: string;
  monthLabel: string;
  onGoToPlanner: () => void;
}) {
  if (isPastWeek) {
    return (
      <div className="rounded-[16px] border border-dashed border-line bg-surface-1 p-8 text-center">
        <div className="text-[14px] text-ink-2">No plan recorded for this week.</div>
      </div>
    );
  }
  return (
    <div className="rounded-[16px] border border-dashed border-line bg-surface-1 p-8 text-center flex flex-col items-center gap-3">
      <div className="text-[14px] text-ink-2">No plan for the week of {monthLabel}.</div>
      <Button variant="ghost" onClick={onGoToPlanner}>
        Create one in the Planner →
      </Button>
    </div>
  );
}

function NoListCard({
  isPastWeek,
  generating,
  onGenerate,
}: {
  isPastWeek: boolean;
  generating: boolean;
  onGenerate: () => void;
}) {
  if (isPastWeek) {
    return (
      <div className="rounded-[16px] border border-dashed border-line bg-surface-1 p-8 text-center">
        <div className="text-[14px] text-ink-2">No shopping list for this week.</div>
      </div>
    );
  }
  return (
    <div className="rounded-[16px] border border-dashed border-line bg-surface-1 p-8 text-center flex flex-col items-center gap-3">
      <div className="text-[14px] text-ink-2">No shopping list yet.</div>
      <Button variant="primary" icon={RefreshCw} onClick={onGenerate} disabled={generating}>
        {generating ? "Generating…" : "Generate from this week's plan"}
      </Button>
    </div>
  );
}
```

`NoPlanCard` takes `viewedWeek` in its prop type for forward use (e.g., if a future enhancement wants to show "the week of <X>" in the past-week message). It's accepted but unused in the past-week branch today; TypeScript won't complain because it's a valid prop.

- [ ] **Step 8: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: clean. If tsc complains about an unused `viewedWeek` prop in `NoPlanCard`, either delete it from the interface or actually use it; both are fine.

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/ShoppingList.tsx
git commit -m "feat(client): six-state body + past-week read-only on Shopping List"
```

---

## Task 4: Manual smoke test

No code changes — exercise each flow against the dev server.

**Setup:** the dev server runs on WSL with `tsx watch` auto-restart. Open the app at the dev URL (`http://<dev-host>:5173/shopping`).

- [ ] **Smoke 1 — broken-date fix + initial load + URL canonicalization**

1. Navigate to `/shopping` (no query string). Verify the URL becomes `/shopping?week=<this Monday>` (replace, not push).
2. Verify the header reads `Week of <readable date>` — e.g., `Week of May 4`. **Confirm it is not "Invalid Date"** (the bug being fixed).
3. Navigate to `/shopping?week=2026-05-13` (a Wednesday). Verify the URL silently snaps to `/shopping?week=2026-05-11`.
4. Navigate to `/shopping?week=garbage`. Verify the URL silently lands on `?week=<this Monday>`.

- [ ] **Smoke 2 — prev / next / Today navigation**

1. From the current week, click `›`. URL becomes `?week=<next Monday>`. Browser back returns to the current week.
2. Click `›` several more times. Each click pushes a new history entry.
3. Click `‹` repeatedly. Walks backward through visited weeks.
4. Click **Today**. URL snaps to `?week=<this Monday>`. Today button greys out.
5. Click **Today** again — nothing happens (button is disabled).

- [ ] **Smoke 3 — empty current/future week, plan exists but no list**

1. Navigate to a current/future week that has a plan but no shopping list yet (use the planner to ensure a plan exists for the target week, but don't pre-generate).
2. Verify the body shows the dashed `No shopping list yet` card with a `Generate from this week's plan` button.
3. Verify the header has **no** Regenerate button (because items.length === 0).
4. Click the Generate button in the card. Verify items populate; To buy / Already in pantry sections appear; the header gains a Regenerate button.

- [ ] **Smoke 4 — empty current/future week, no plan**

1. Navigate to a current/future week with no plan (e.g., `?week=<5 weeks from this Monday>`).
2. Verify the body shows `No plan for the week of <date>.` with a `Create one in the Planner →` button.
3. Click the button. Verify it navigates to `/planner?week=<that Monday>` (carries the viewed week through, so the planner lands on the same week).

- [ ] **Smoke 5 — past week, list exists, read-only**

1. Navigate to a past week that has a generated shopping list.
2. Verify the items render — including any items you previously checked.
3. Try clicking a row's checkbox. Verify nothing toggles (cursor is `not-allowed`, click is silently ignored).
4. Verify there's **no** Regenerate button in the header.

- [ ] **Smoke 6 — past week, no list**

1. Navigate to a past week that has a plan but no shopping list (or a past week with no plan).
2. Verify the body shows the relevant dashed card (`No shopping list for this week.` or `No plan recorded for this week.`) with **no** buttons.

- [ ] **Smoke 7 — Regenerate still works on current/future weeks**

1. Navigate to a current/future week with an existing list.
2. Click the header Regenerate button. Verify items refresh (existing items deleted, new items created from the plan; checked state is lost — pre-existing behavior).

- [ ] **Final typecheck + server tests**

```bash
cd client && npx tsc --noEmit
cd ../server && npx vitest run
```

Expected: client clean. Server tests at the same count as the pre-flight baseline (no server-side changes).

- [ ] **Final commit (only if smoke surfaced issues)**

If anything broke during smoke, fix, re-run the affected smoke, commit with a descriptive message. If everything passed first try, no extra commit needed.

---

## Task 5: Push and open PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feature/multi-week-shopping
```

- [ ] **Step 2: Open the PR**

Pick the base branch based on which one you used in pre-flight:

- **Pre-flight Option A (based on master):** `gh pr create --base master`
- **Pre-flight Option B (based on `feature/multi-week-planner`):** `gh pr create --base feature/multi-week-planner`

```bash
gh pr create --base <base-from-pre-flight> --title "feat: multi-week navigation on the Shopping List + broken-date fix" --body "$(cat <<'EOF'
## Summary

- Replace the Shopping List's "active plan or first plan" auto-pick with URL-driven multi-week navigation. The viewed week lives in `?week=YYYY-MM-DD` (always a Monday). Same pattern as the planner — `parseWeekParam` + `pickPlanForWeek` from `api/plans.ts`.
- Add prev / next / Today buttons in the page header. Initial load with no `?week=` redirects (replace) to the current week.
- Six-state body matrix: past weeks are read-only (disabled checkboxes, no Generate button at all); current/future weeks show the existing items UI when a list is generated, a `Generate from this week's plan` CTA when only the plan exists, and a `Create one in the Planner →` link (carrying `?week=`) when no plan exists.
- Fix the broken `Week of <date>` header — was rendering "Invalid Date" because the code concatenated `"T00:00:00"` onto an already-ISO string. Now derives from `viewedWeek` via `localMidnightFromISO`.
- No server changes — `GET /api/plans`, `GET /api/shopping/:planId`, `POST /api/shopping/generate/:planId`, `PUT /api/shopping/item/:id` all stay as-is.

## Base branch note

Pick the base based on whether the multi-week-planner PR has merged to master. This branch needs `parseWeekParam` and `pickPlanForWeek`, which only exist on `feature/multi-week-planner` until that PR merges. After it merges, retarget this PR with \`gh pr edit <num> --base master\` (GitHub may auto-retarget when the upstream branch is deleted).

## Test plan

Automated:
- [x] Client typecheck (\`npx tsc --noEmit\`) clean.
- [x] Server tests unchanged (no server-side work).

Interactive smokes (run by reviewer):
- [ ] Smoke 1 — initial load shows correct date (broken-date bug fixed); URL canonicalization works.
- [ ] Smoke 2 — prev / next / Today push history; back/forward walks through visited weeks; Today greys out when on current week.
- [ ] Smoke 3 — empty current/future week with plan but no list shows the Generate CTA; Generate populates the list.
- [ ] Smoke 4 — empty current/future week with no plan shows the planner-link CTA; clicking goes to /planner with ?week= preserved.
- [ ] Smoke 5 — past week with list is read-only; checkboxes don't toggle; no Regenerate button.
- [ ] Smoke 6 — past week with no list shows the appropriate dashed card with no button.
- [ ] Smoke 7 — Regenerate still works on current/future weeks with existing lists.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Report the PR URL when done.
