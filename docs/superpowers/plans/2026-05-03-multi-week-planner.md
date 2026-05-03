# Multi-Week Planner Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add prev/next/today week navigation to the Planner page so the user can view past plans, manage current/future plans, and create plans for arbitrary upcoming weeks. The viewed week lives in the URL as `?week=YYYY-MM-DD` (a Monday).

**Architecture:** Pure client-side. The Planner stops calling `pickRelevantPlan(plans)` to collapse to one plan; instead it loads all plans, derives `viewedWeek` from the URL via React Router's `useSearchParams`, and picks the matching plan via a new `pickPlanForWeek` helper. Mutations update the `plans` array in place. Empty weeks get a CTA-vs-read-only treatment based on whether the week is past or current/future.

**Tech Stack:** React 18, TypeScript, `react-router-dom` v7 (`useSearchParams`), Tailwind v4. No new dependencies on either side. Server is unchanged — `GET /api/plans` and `POST /api/plans` already cover the API needs.

---

## File Structure

### Modify

- `client/src/api/plans.ts` — append two pure helpers: `parseWeekParam` and `pickPlanForWeek`. Both live next to the existing `pickRelevantPlan`, `getNextMonday`, `localMidnightFromISO` exports. `pickRelevantPlan` stays exported because Dashboard still uses it; the Planner stops calling it.
- `client/src/pages/Planner.tsx` — main change. Swap `pickRelevantPlan` for URL-driven derivation; manage `plans: WeeklyPlan[]` instead of `plan: WeeklyPlan | null`; add prev/next/today controls; add empty-state UI for current/future and past weeks; add the duplicate-plan inline switcher.

### No changes

- `server/**/*` — no schema changes, no new endpoints. `GET /api/plans` returns every plan (already used today, just no longer narrowed via `pickRelevantPlan`); `POST /api/plans` accepts an arbitrary `weekStartDate` (already exposed).
- `client/src/pages/Dashboard.tsx` — has its own copies of plan helpers; out of scope for this work.
- `client/src/api/plans.ts` types and existing exports — untouched.

---

## Pre-flight: create the worktree and branch

This feature branches from `master`.

- [ ] **Step 1: Fetch and create the worktree**

From `C:\Users\mlgbr\Desktop\Projects\AgenticMealPlanner`:

```bash
git fetch origin
git worktree add .worktrees/multi-week-planner -b feature/multi-week-planner origin/master
cd .worktrees/multi-week-planner
```

- [ ] **Step 2: Install deps**

```bash
npm install
```

Expected: ~30s. Some moderate-severity audit warnings — benign.

- [ ] **Step 3: Generate Prisma client locally so the typecheck baseline doesn't fail**

```bash
cd server && npx prisma generate
```

Expected: `✔ Generated Prisma Client`. No DB access required — only reads `schema.prisma`.

- [ ] **Step 4: Verify baseline**

```bash
cd ../client && npx tsc --noEmit
cd ../server && npx vitest run
```

Expected: client tsc clean. Server tests should be at the current passing count (~28 pre-existing, possibly more if the receipt-tracking work has merged by the time you start — accept whatever passes on master as the baseline).

---

## Task 1: Add `parseWeekParam` and `pickPlanForWeek` helpers

**Files:**
- Modify: `client/src/api/plans.ts` — append two new exports.

**Why:** Two pure functions the Planner needs. Keeping them next to the other plan/date helpers avoids drift and lets future pages (Dashboard, etc.) reuse them.

- [ ] **Step 1: Append the helpers to `client/src/api/plans.ts`**

Open `client/src/api/plans.ts`. After the existing `pickRelevantPlan` function (which is at the end of the file), append:

```ts
/**
 * Normalize an arbitrary week-param string to a 'YYYY-MM-DD' Monday in local
 * time. Used to make the viewed-week URL canonical regardless of how the
 * user landed on the page.
 *
 *   - Valid 'YYYY-MM-DD' that's already a Monday → unchanged.
 *   - Valid 'YYYY-MM-DD' on any other day        → snaps to that calendar
 *                                                   week's Monday.
 *   - Empty / null / undefined / unparseable     → today's Monday.
 */
export function parseWeekParam(raw: string | null | undefined): string {
  let d: Date;
  if (!raw) {
    d = new Date();
  } else {
    // Accept either 'YYYY-MM-DD' or a longer ISO string; treat as local midnight.
    const ymd = raw.length >= 10 ? raw.slice(0, 10) : raw;
    const tryDate = new Date(ymd + "T00:00:00");
    d = Number.isNaN(tryDate.getTime()) ? new Date() : tryDate;
  }
  // JS getDay(): 0 = Sunday … 6 = Saturday. We want Monday-anchored weeks
  // where Monday = 0 and Sunday = 6.
  const dayIndex = (d.getDay() + 6) % 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - dayIndex);
  const yyyy = monday.getFullYear();
  const mm = String(monday.getMonth() + 1).padStart(2, "0");
  const dd = String(monday.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Pick the plan that represents the viewed week. Drafts win the default
 * tiebreak; otherwise lowest id wins (deterministic). Returns null when no
 * plan matches.
 */
export function pickPlanForWeek(
  plans: WeeklyPlan[],
  weekStart: string,
): WeeklyPlan | null {
  const matches = plans.filter((p) => p.weekStartDate.slice(0, 10) === weekStart);
  if (matches.length === 0) return null;
  const draft = matches.find((p) => p.status === "draft");
  if (draft) return draft;
  // Lowest id deterministic tiebreak.
  return matches.slice().sort((a, b) => a.id - b.id)[0];
}
```

- [ ] **Step 2: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: clean (no output).

- [ ] **Step 3: Sanity-test the helpers in a Node REPL (optional but quick)**

Skip if you trust the typecheck. If you want a smoke check:

```bash
cd client && node --input-type=module -e "
import { parseWeekParam, pickPlanForWeek } from './src/api/plans.ts';
console.log('today        ->', parseWeekParam(null));
console.log('Wed 2026-05-06 ->', parseWeekParam('2026-05-06'));
console.log('Sat 2026-05-09 ->', parseWeekParam('2026-05-09'));
console.log('garbage       ->', parseWeekParam('not-a-date'));
console.log('pick (none)   ->', pickPlanForWeek([], '2026-05-04'));
"
```

This won't actually run — Node can't import `.ts` files without a loader. Skip it. The TypeScript compiler is the verification.

- [ ] **Step 4: Commit**

```bash
git add client/src/api/plans.ts
git commit -m "feat(client): parseWeekParam + pickPlanForWeek helpers"
```

---

## Task 2: Refactor Planner.tsx data flow to URL-driven

**Files:**
- Modify: `client/src/pages/Planner.tsx`

**Why:** Replace the `plan: WeeklyPlan | null` single-plan state with `plans: WeeklyPlan[]` + URL-derived `viewedWeek`. Mutations update the array in place. No new UI controls in this task; the existing "New plan" header button stays (with `handleNew` updated to create for the viewed week instead of next Monday). Empty state still uses the existing dashed-card placeholder. Tasks 3–5 layer the new UI on top.

- [ ] **Step 1: Update imports**

Open `client/src/pages/Planner.tsx`. The current top-of-file imports for `react-router-dom` look like:

```tsx
import { useNavigate } from "react-router-dom";
```

Replace with:

```tsx
import { useNavigate, useSearchParams } from "react-router-dom";
```

The current `../api/plans` import block looks like:

```tsx
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

Update to drop `pickRelevantPlan`, drop `getNextMonday` (no longer needed in this file), and add `parseWeekParam` and `pickPlanForWeek`:

```tsx
import {
  addPlannedMeal,
  createPlan,
  generatePlan,
  getPlans,
  localMidnightFromISO,
  parseWeekParam,
  pickPlanForWeek,
  removePlannedMeal,
  updatePlan,
  updatePlannedMeal,
  type WeeklyPlan,
  type PlannedMeal,
} from "../api/plans";
```

Add a `useMemo` import to the React imports if it isn't already. The existing top of the file is:

```tsx
import { useEffect, useMemo, useState } from "react";
```

`useMemo` is already there — good.

- [ ] **Step 2: Replace the component's state and effects**

Find the top of the `Planner()` function (currently around lines 60–73). It looks like:

```tsx
export default function Planner() {
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [picker, setPicker] = useState<PickerCtx | null>(null);
  const [editing, setEditing] = useState<PlannedMeal | null>(null);
  const [generating, setGenerating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    getPlans().then((p) => setPlan(pickRelevantPlan(p)));
    getMeals().then(setMeals).catch(() => setMeals([]));
  }, []);
```

Replace with:

```tsx
export default function Planner() {
  const [plans, setPlans] = useState<WeeklyPlan[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [picker, setPicker] = useState<PickerCtx | null>(null);
  const [editing, setEditing] = useState<PlannedMeal | null>(null);
  const [generating, setGenerating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // The viewed week is the URL's source of truth. parseWeekParam normalizes
  // anything weird (mid-week dates, garbage strings, missing param) to the
  // Monday of the relevant calendar week.
  const rawWeekParam = searchParams.get("week");
  const viewedWeek = parseWeekParam(rawWeekParam);

  // If the URL was missing or non-canonical, replace it (don't push) so the
  // user's browser history doesn't get cluttered with redirects on first
  // load.
  useEffect(() => {
    if (rawWeekParam !== viewedWeek) {
      setSearchParams({ week: viewedWeek }, { replace: true });
    }
  }, [rawWeekParam, viewedWeek, setSearchParams]);

  useEffect(() => {
    getPlans().then(setPlans).catch(() => setPlans([]));
    getMeals().then(setMeals).catch(() => setMeals([]));
  }, []);

  const viewedPlan = useMemo(
    () => pickPlanForWeek(plans, viewedWeek),
    [plans, viewedWeek],
  );
```

- [ ] **Step 3: Update the mutation handlers to operate on the `plans` array**

Find the existing handlers (`handlePick`, `updatePm`, `removePm`, `handleNew`, `handleGenerate`, `handleActivate`, `handleSync`) — currently lines ~74–139. They all reference `plan` / `setPlan`. Replace each one as follows.

`handlePick`:

```tsx
  const handlePick = async (mealId: number) => {
    if (!viewedPlan || !picker) return;
    const meal = meals.find((m) => m.id === mealId);
    if (picker.mode === "add") {
      const canBatchHere = picker.day === "sunday" && !!meal?.canBatch;
      const planned = await addPlannedMeal(viewedPlan.id, {
        mealId,
        day: picker.day,
        mealSlot: picker.slot,
        servings: meal?.servings ?? 2,
        isPrep: canBatchHere,
      });
      setPlans((prev) =>
        prev.map((p) =>
          p.id === viewedPlan.id
            ? { ...p, plannedMeals: [...p.plannedMeals, planned as PlannedMeal] }
            : p,
        ),
      );
    } else {
      const updated = await updatePlannedMeal(viewedPlan.id, picker.plannedId, { mealId });
      setPlans((prev) =>
        prev.map((p) =>
          p.id === viewedPlan.id
            ? { ...p, plannedMeals: p.plannedMeals.map((pm) => (pm.id === updated.id ? updated : pm)) }
            : p,
        ),
      );
      if (editing?.id === updated.id) setEditing(updated);
    }
    setPicker(null);
  };
```

`updatePm`:

```tsx
  const updatePm = async (pm: PlannedMeal, patch: Partial<PlannedMeal>) => {
    if (!viewedPlan) return;
    const updated = await updatePlannedMeal(viewedPlan.id, pm.id, patch);
    setPlans((prev) =>
      prev.map((p) =>
        p.id === viewedPlan.id
          ? { ...p, plannedMeals: p.plannedMeals.map((x) => (x.id === updated.id ? updated : x)) }
          : p,
      ),
    );
    if (editing?.id === updated.id) setEditing(updated);
  };
```

`removePm`:

```tsx
  const removePm = async (pm: PlannedMeal) => {
    if (!viewedPlan) return;
    await removePlannedMeal(viewedPlan.id, pm.id);
    setPlans((prev) =>
      prev.map((p) =>
        p.id === viewedPlan.id
          ? { ...p, plannedMeals: p.plannedMeals.filter((x) => x.id !== pm.id) }
          : p,
      ),
    );
    if (editing?.id === pm.id) setEditing(null);
  };
```

`handleNew` (now creates for the viewed week, not next Monday):

```tsx
  const handleNew = async () => {
    const next = await createPlan(viewedWeek);
    setPlans((prev) => [...prev, next]);
  };
```

`handleGenerate`:

```tsx
  const handleGenerate = async () => {
    if (!viewedPlan) return;
    setGenerating(true);
    try {
      const updated = await generatePlan(viewedPlan.id);
      setPlans((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } finally { setGenerating(false); }
  };
```

`handleActivate`:

```tsx
  const handleActivate = async () => {
    if (!viewedPlan) return;
    const updated = await updatePlan(viewedPlan.id, { status: "active" });
    setPlans((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };
```

`handleSync`:

```tsx
  const handleSync = async () => {
    if (!viewedPlan) return;
    setSyncing(true);
    try { await syncCalendar(viewedPlan.id); } finally { setSyncing(false); }
  };
```

- [ ] **Step 4: Update the `weekStart` / `monthLabel` derivation**

Find this block (currently lines ~143–145):

```tsx
  const weekStart = plan?.weekStartDate ?? getNextMonday();
  const startObj = localMidnightFromISO(weekStart);
  const monthLabel = startObj.toLocaleDateString(undefined, { month: "long", day: "numeric" });
```

Replace with:

```tsx
  const weekStart = viewedWeek;
  const startObj = localMidnightFromISO(weekStart);
  const monthLabel = startObj.toLocaleDateString(undefined, { month: "long", day: "numeric" });
```

(`getNextMonday` import was already removed in Step 1.)

- [ ] **Step 5: Update the `summary` useMemo and JSX references from `plan` to `viewedPlan`**

Find the summary block (currently lines ~147–162):

```tsx
  const summary = useMemo(() => {
    if (!plan) return null;
    const prep = plan.plannedMeals.filter((m) => m.isPrep && m.status !== "skipped").length;
    const fresh = plan.plannedMeals.filter((m) => !m.isPrep && m.status !== "skipped").length;
    let totalProtein = 0, count = 0;
    for (const pm of plan.plannedMeals) {
      if (pm.status === "skipped") continue;
      const scale = pm.servings / (pm.meal.servings || 1);
      if (pm.meal.proteinG) {
        totalProtein += pm.meal.proteinG * scale;
        count += 1;
      }
    }
    const avgProtein = count > 0 ? Math.round(totalProtein / count) : 0;
    return { prep, fresh, avgProtein };
  }, [plan]);
```

Replace with:

```tsx
  const summary = useMemo(() => {
    if (!viewedPlan) return null;
    const prep = viewedPlan.plannedMeals.filter((m) => m.isPrep && m.status !== "skipped").length;
    const fresh = viewedPlan.plannedMeals.filter((m) => !m.isPrep && m.status !== "skipped").length;
    let totalProtein = 0, count = 0;
    for (const pm of viewedPlan.plannedMeals) {
      if (pm.status === "skipped") continue;
      const scale = pm.servings / (pm.meal.servings || 1);
      if (pm.meal.proteinG) {
        totalProtein += pm.meal.proteinG * scale;
        count += 1;
      }
    }
    const avgProtein = count > 0 ? Math.round(totalProtein / count) : 0;
    return { prep, fresh, avgProtein };
  }, [viewedPlan]);
```

- [ ] **Step 6: Update every remaining `plan` reference in the JSX to `viewedPlan`**

The JSX still references `plan` in several places. Update each. The header status pill block (currently lines ~176–197):

```tsx
          {viewedPlan && (
            <Pill tone={viewedPlan.status === "active" ? "accent" : viewedPlan.status === "draft" ? "warn" : "neutral"} size="md">
              {viewedPlan.status === "active" ? <Check size={11} /> : null}
              {viewedPlan.status === "active" ? "Active plan" : viewedPlan.status === "draft" ? "Draft" : viewedPlan.status}
            </Pill>
          )}
          {!viewedPlan && (
            <Button variant="primary" icon={Plus} onClick={handleNew}>New plan</Button>
          )}
          {viewedPlan?.status === "draft" && (
            <>
              <Button variant="ghost" icon={Sparkles} onClick={handleGenerate} disabled={generating}>
                {generating ? "Generating…" : "Auto-generate"}
              </Button>
              <Button variant="primary" onClick={handleActivate}>Confirm plan</Button>
            </>
          )}
          {viewedPlan?.status === "active" && (
            <Button variant="primary" icon={CalendarDays} onClick={handleSync} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync to Calendar"}
            </Button>
          )}
```

The body conditional (currently around line 253):

```tsx
      {!viewedPlan ? (
        <div className="rounded-[16px] border border-dashed border-line bg-surface-1 p-10 text-center text-ink-2">
          No active plan yet. Start one for next week.
        </div>
      ) : (
        <>
```

The map inside the populated branch (currently around line 261):

```tsx
            {DAYS.map((day) => {
              const meals = viewedPlan.plannedMeals.filter((m) => m.day === day);
```

The picker / editing modals at the bottom (currently lines ~369–390) reference `plan` — leave the modal props as-is, but the conditional rendering uses `picker` / `editing` directly (which are still in state), so no change there.

Search the file for any remaining `plan?.` or `plan.` references that aren't `plannedMeal*` — replace each with `viewedPlan?.` or `viewedPlan.`. The `useMemo` summary callback already updated in Step 5.

- [ ] **Step 7: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: clean. If tsc complains about unused `getNextMonday` or `pickRelevantPlan` imports, double-check Step 1's import edits — those should both be gone.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/Planner.tsx
git commit -m "refactor(client): Planner data flow is URL-driven via viewedWeek"
```

---

## Task 3: Add prev / next / Today navigation controls

**Files:**
- Modify: `client/src/pages/Planner.tsx`

**Why:** With Task 2 done, the page reads from the URL but the user has no UI to change it. Add the three header buttons.

- [ ] **Step 1: Add a `stepWeek` helper at the top of `Planner.tsx` (above the component)**

Find the top-of-file helper section in `Planner.tsx` (currently `todayKey()` and `dayDate()` at lines ~44–52). Below `dayDate`, add:

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

- [ ] **Step 2: Add lucide icons for the navigation controls**

Find the `lucide-react` import block (currently lines 3–16):

```tsx
import {
  Sparkles,
  CalendarDays,
  Flame,
  Leaf,
  Plus,
  Check,
  Search,
  X,
  Trash2,
  Replace,
  Minus,
  ExternalLink,
} from "lucide-react";
```

Add `ChevronLeft` and `ChevronRight`:

```tsx
import {
  Sparkles,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Flame,
  Leaf,
  Plus,
  Check,
  Search,
  X,
  Trash2,
  Replace,
  Minus,
  ExternalLink,
} from "lucide-react";
```

- [ ] **Step 3: Add the navigation handlers + "is today" computation inside `Planner()`**

Inside `Planner()`, just before `const handlePick = ...`, add:

```tsx
  const todayWeek = useMemo(() => parseWeekParam(null), []);
  const isViewingToday = viewedWeek === todayWeek;

  const goPrevWeek = () => setSearchParams({ week: stepWeek(viewedWeek, -7) });
  const goNextWeek = () => setSearchParams({ week: stepWeek(viewedWeek, +7) });
  const goToday    = () => { if (!isViewingToday) setSearchParams({ week: todayWeek }); };
```

- [ ] **Step 4: Replace the page header to include navigation controls**

Find the current header (currently lines ~166–199) which is:

```tsx
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[12px] uppercase tracking-[0.1em] text-ink-3 mb-1.5">
            Week of {monthLabel}
          </div>
          <h1 className="text-[26px] sm:text-[30px] font-semibold -tracking-[0.02em] text-ink-1">
            Weekly Planner
          </h1>
        </div>
        <div className="flex gap-2.5 items-center flex-wrap">
          {/* status pill + action buttons unchanged */}
        </div>
      </div>
```

Replace the left-side `<div>` (the `Week of {monthLabel}` block) with:

```tsx
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
              Week of {monthLabel}
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
          <h1 className="text-[26px] sm:text-[30px] font-semibold -tracking-[0.02em] text-ink-1">
            Weekly Planner
          </h1>
        </div>
```

- [ ] **Step 5: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/Planner.tsx
git commit -m "feat(client): prev/next/today navigation on Planner"
```

---

## Task 4: Empty-state UI for current/future and past weeks

**Files:**
- Modify: `client/src/pages/Planner.tsx`

**Why:** Replace the existing single-line dashed-card empty state with the spec's two-mode empty state — CTA card for current/future weeks, read-only message for past weeks. Below the card, render an empty greyed grid as visual context. Also remove the now-redundant `New plan` button from the header.

- [ ] **Step 1: Add an `isPastWeek` computation**

Inside `Planner()`, just below the existing `isViewingToday` line, add:

```tsx
  const isPastWeek = viewedWeek < todayWeek;
```

(String comparison works because both values are canonical YYYY-MM-DD.)

- [ ] **Step 2: Scope the "today" highlight to the current week only**

Find the existing line in the component body (currently around line 141 after Tasks 2–3):

```tsx
  const today = todayKey();
```

Replace with:

```tsx
  const today = isViewingToday ? todayKey() : null;
```

The populated-grid map already does `const isToday = day === today;` — when `today` is `null`, that comparison is always false, so no day card gets the today highlight. The spec is explicit: highlight only shows on the week containing today.

- [ ] **Step 3: Remove the `New plan` button from the header**

Find this block (currently lines ~182–184 after Task 3):

```tsx
          {!viewedPlan && (
            <Button variant="primary" icon={Plus} onClick={handleNew}>New plan</Button>
          )}
```

Delete it entirely. The empty-state CTA below replaces it.

- [ ] **Step 4: Replace the body's empty-state branch**

Find the conditional (currently around line 253):

```tsx
      {!viewedPlan ? (
        <div className="rounded-[16px] border border-dashed border-line bg-surface-1 p-10 text-center text-ink-2">
          No active plan yet. Start one for next week.
        </div>
      ) : (
        <>
```

Replace with:

```tsx
      {!viewedPlan ? (
        <>
          <EmptyWeekCard
            isPastWeek={isPastWeek}
            weekLabel={monthLabel}
            onCreate={handleNew}
          />
          <EmptyWeekGrid weekStart={weekStart} today={isViewingToday ? today : null} />
        </>
      ) : (
        <>
```

- [ ] **Step 5: Add the two new presentation components at the bottom of the file**

Find the bottom of `Planner.tsx` — after the last existing component (`Field`, currently around line 757). Append:

```tsx
function EmptyWeekCard({
  isPastWeek,
  weekLabel,
  onCreate,
}: {
  isPastWeek: boolean;
  weekLabel: string;
  onCreate: () => void;
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
      <div className="text-[14px] text-ink-2">No plan for this week yet.</div>
      <Button variant="primary" icon={Plus} onClick={onCreate}>
        Create plan for the week of {weekLabel}
      </Button>
    </div>
  );
}

function EmptyWeekGrid({ weekStart, today }: { weekStart: string; today: string | null }) {
  return (
    <div className="lg:grid lg:grid-cols-7 lg:gap-3 flex gap-3 overflow-x-auto amp-no-scrollbar -mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 snap-x snap-mandatory opacity-60">
      {DAYS.map((day) => {
        const isToday = day === today;
        return (
          <div
            key={day}
            className={`snap-start shrink-0 w-[72%] sm:w-[44%] lg:w-auto bg-surface-1 rounded-[14px] p-3 flex flex-col gap-2.5 min-h-[280px] border ${
              isToday ? "border-accent" : "border-line-soft"
            }`}
          >
            <div className="flex items-baseline justify-between">
              <div>
                <div className={`text-[11px] uppercase tracking-[0.08em] font-semibold ${isToday ? "text-accent-ink" : "text-ink-3"}`}>
                  {DAY_LABELS[day]}
                </div>
                <div className="text-[20px] font-semibold text-ink-3 -tracking-[0.02em] mt-px">
                  {dayDate(weekStart, day)}
                </div>
              </div>
            </div>
            {(["lunch", "dinner"] as const).map((slot) => (
              <div key={slot} className="flex flex-col gap-1">
                <div className="text-[10px] uppercase tracking-[0.08em] text-ink-3">{slot}</div>
                <div className="border border-dashed border-line-soft rounded-[10px] py-4 bg-surface-2/40" />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/Planner.tsx
git commit -m "feat(client): empty-state UI + scoped today highlight"
```

---

## Task 5: Duplicate-plan inline switcher

**Files:**
- Modify: `client/src/pages/Planner.tsx`

**Why:** When a week has more than one plan (e.g., a draft and an active for the same week), show an inline notice between the page header and the grid that lets the user flip to the other plan. v1 picks drafts first; the switcher cycles to whichever is not currently shown.

- [ ] **Step 1: Compute `weekDuplicates` inside `Planner()`**

Just below the existing `viewedPlan` useMemo, add:

```tsx
  const weekDuplicates = useMemo(
    () => plans.filter((p) => p.weekStartDate.slice(0, 10) === viewedWeek),
    [plans, viewedWeek],
  );

  // Track which duplicate is currently in view. Defaults to the same one
  // pickPlanForWeek picks; clicking the switcher cycles forward.
  const [duplicateIndex, setDuplicateIndex] = useState(0);

  // When the viewed week changes, reset the duplicate cursor.
  useEffect(() => {
    setDuplicateIndex(0);
  }, [viewedWeek]);

  // Override the viewedPlan derivation when there are duplicates and the
  // user has rotated past the first one. We sort the duplicates the same
  // way pickPlanForWeek does (drafts first, then by id).
  const sortedDuplicates = useMemo(() => {
    const drafts = weekDuplicates.filter((p) => p.status === "draft").sort((a, b) => a.id - b.id);
    const others = weekDuplicates.filter((p) => p.status !== "draft").sort((a, b) => a.id - b.id);
    return [...drafts, ...others];
  }, [weekDuplicates]);

  const effectiveViewedPlan =
    sortedDuplicates.length > 1
      ? sortedDuplicates[duplicateIndex % sortedDuplicates.length]
      : viewedPlan;
```

Then **replace every remaining reference to `viewedPlan` in the rest of the component with `effectiveViewedPlan`** — handlers (`handlePick`, `updatePm`, `removePm`, `handleGenerate`, `handleActivate`, `handleSync`), `summary` useMemo, JSX status pill, the body conditional, and the day map.

A find-and-replace within the function body should work; just make sure not to replace inside the `useMemo` for `viewedPlan` itself or inside `pickPlanForWeek`'s call. Concretely, after this step the only place `viewedPlan` should still appear is the original `useMemo`:

```tsx
  const viewedPlan = useMemo(
    () => pickPlanForWeek(plans, viewedWeek),
    [plans, viewedWeek],
  );
```

Everything else uses `effectiveViewedPlan`.

- [ ] **Step 2: Render the switcher between the header and the body**

Find the body conditional (the `{!effectiveViewedPlan ? ...}` block — currently around line 253). Just above that block, but inside the same parent `<div className="flex flex-col gap-7">`, add:

```tsx
      {sortedDuplicates.length > 1 && (
        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] bg-warn-soft border border-warn-line text-warn-ink text-[12.5px]">
          <span>
            Showing <span className="font-semibold capitalize">{effectiveViewedPlan?.status}</span>.
            +{sortedDuplicates.length - 1} other plan{sortedDuplicates.length - 1 === 1 ? "" : "s"} for this week.
          </span>
          <button
            onClick={() => setDuplicateIndex((i) => (i + 1) % sortedDuplicates.length)}
            className="ml-auto text-[12.5px] font-semibold underline hover:no-underline"
          >
            Switch
          </button>
        </div>
      )}
```

- [ ] **Step 3: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Planner.tsx
git commit -m "feat(client): inline switcher when multiple plans cover the same week"
```

---

## Task 6: Manual smoke test

No code changes — exercise each flow against the dev server.

**Setup:** dev server lives on WSL with `tsx watch` auto-restart. After pushing the branch (or using your existing dev server bound to master), open the app at the dev URL (`http://<dev-host>:5173/planner`).

- [ ] **Smoke 1 — initial load + URL canonicalization**

1. Navigate to `/planner` (no query string). Verify the URL becomes `/planner?week=<this Monday>` (replace, not push — back button should NOT take you to `/planner`).
2. Navigate to `/planner?week=2026-05-13` (a Wednesday). Verify the URL silently snaps to `/planner?week=2026-05-11` and the planner shows that week.
3. Navigate to `/planner?week=garbage`. Verify the URL silently lands on `?week=<this Monday>`.

- [ ] **Smoke 2 — prev / next / Today navigation**

1. From the current week, click `›`. URL becomes `?week=<next Monday>`. Browser back returns to the current week.
2. Click `›` several more times. Each click pushes a new history entry.
3. Click `‹` repeatedly. Walks backward through visited weeks.
4. Click **Today**. URL snaps to `?week=<this Monday>`. Today button greys out.
5. Click **Today** again — nothing happens (button is disabled).

- [ ] **Smoke 3 — empty current/future week**

1. Navigate to a future week with no plan (e.g., `?week=<3 weeks from this Monday>`).
2. Verify the header reads `Week of <Mon date>`, no status pill renders.
3. Verify the body shows: a dashed-border card with "No plan for this week yet" + a `Create plan for the week of …` button. Below that, a greyed 7-column grid with date labels.
4. Click the create button. Verify the card disappears, the grid populates with the empty (but real) plan, and the status pill in the header now shows `Draft`.
5. Add a meal via the empty `+ Add` slot. Verify it lands.

- [ ] **Smoke 4 — empty past week**

1. Navigate to a past week with no plan (e.g., `?week=<2 weeks ago Monday>`).
2. Verify: dashed card with "No plan recorded for this week." — no button. Greyed grid below.
3. Verify: today highlight does NOT appear (no day card has the accent border).

- [ ] **Smoke 5 — populated past week (read-only behavior is fine, edits work)**

1. Navigate to a past week that has a plan (e.g., last week's plan if you've been using the app).
2. Verify the grid renders the past plan's planned meals.
3. Verify clicking a meal still opens the edit modal — past weeks aren't read-only at the data level (the spec is explicit about this; "past = no create CTA" is the only restriction).

- [ ] **Smoke 6 — duplicate plans for one week**

1. SSH to the dev server and run a quick psql nudge to insert a duplicate plan covering a week you can navigate to:

   ```bash
   ssh -p 22 swizz@100.114.226.44 'cd /home/swizz/projects/AgenticMealPlanner/server && DATABASE_URL=$(grep "^DATABASE_URL" .env | cut -d= -f2- | tr -d "\"" | tr -d "'\''" | sed "s/?.*$//") && psql "$DATABASE_URL"' <<'EOF'
   INSERT INTO weekly_plans (week_start_date, status, created_at, updated_at)
   VALUES ('2026-05-11', 'draft',  NOW(), NOW()),
          ('2026-05-11', 'active', NOW(), NOW());
   EOF
   ```

   Pick a Monday that doesn't already have a plan; adjust the date if needed.

2. Reload the app, navigate to `/planner?week=2026-05-11`.
3. Verify the inline notice appears: `Showing draft. +1 other plan for this week. Switch`.
4. Click **Switch**. Verify the status pill flips to `Active`, and the grid contents change to the other plan's planned meals (likely empty if you just inserted them).
5. Click **Switch** again. Cycles back to the draft.

6. Clean up the test data:

   ```bash
   ssh -p 22 swizz@100.114.226.44 'cd /home/swizz/projects/AgenticMealPlanner/server && DATABASE_URL=$(grep "^DATABASE_URL" .env | cut -d= -f2- | tr -d "\"" | tr -d "'\''" | sed "s/?.*$//") && psql "$DATABASE_URL"' <<'EOF'
   DELETE FROM weekly_plans WHERE week_start_date = '2026-05-11' AND id IN (
     SELECT id FROM weekly_plans WHERE week_start_date = '2026-05-11' ORDER BY id DESC LIMIT 2
   );
   EOF
   ```

   (Adjust if you have a real plan you don't want to delete; only remove the two you inserted.)

- [ ] **Smoke 7 — calendar sync still works**

1. Navigate to a week with an active plan.
2. Click **Sync to Calendar**. Verify it still functions (no regressions from the plans-array refactor).

- [ ] **Final typecheck + server tests**

```bash
cd client && npx tsc --noEmit
cd ../server && npx vitest run
```

Expected: client clean. Server tests should be at the same count as the pre-flight baseline (no server-side changes were made).

- [ ] **Final commit (if smoke surfaced issues)**

If anything broke during smoke, fix, re-run the affected smoke, commit with a descriptive message. If everything passed first try, no extra commit needed.

---

## Task 7: Push and open PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feature/multi-week-planner
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base master --title "feat: multi-week navigation on the Planner" --body "$(cat <<'EOF'
## Summary

- Replace `pickRelevantPlan`-based single-plan rendering on `/planner` with URL-driven multi-week navigation. The viewed week lives in `?week=YYYY-MM-DD` (always a Monday).
- Add prev / next / Today buttons in the page header. Initial load with no `?week=` redirects to the current week (via `replace`, not `push`).
- Add empty-state UI for weeks without a plan: a `Create plan for the week of …` CTA on current/future weeks, a read-only `No plan recorded for this week.` message on past weeks. A greyed 7-column grid renders below either card as visual context.
- Add an inline switcher when more than one plan covers the same week. Drafts win the default tiebreak; the switcher cycles forward.
- New pure helpers in `client/src/api/plans.ts`: `parseWeekParam` (canonicalize/snap any input to a Monday) and `pickPlanForWeek` (resolve `viewedWeek` → plan, draft-first tiebreak). `pickRelevantPlan` stays exported because Dashboard still uses it.
- No server changes — `GET /api/plans` and `POST /api/plans` already cover what the Planner needs.

## Test plan

Automated:
- [x] Client typecheck (\`npx tsc --noEmit\`) clean.
- [x] Server tests unchanged (no server-side work).

Interactive smokes (run by reviewer):
- [ ] Smoke 1 — initial load redirects to `?week=<this Monday>`; mid-week and garbage params snap silently.
- [ ] Smoke 2 — prev / next / Today push history; back/forward walks through visited weeks; Today greys out when on current week.
- [ ] Smoke 3 — empty current/future week shows the CTA + greyed grid; Create button spins up a real plan in place.
- [ ] Smoke 4 — empty past week shows "No plan recorded" with no button.
- [ ] Smoke 5 — populated past week renders + edits still work (no read-only data-level restriction).
- [ ] Smoke 6 — two plans for one week → inline switcher appears; Switch cycles between them.
- [ ] Smoke 7 — calendar sync still works after the plans-array refactor.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Report the PR URL when done.
