# Multi-Week Planner Navigation — Design Notes

**Date:** 2026-05-03
**Status:** Approved. Next step: implementation plan.
**Trigger:** The Planner page only ever shows a single plan, picked by
`pickRelevantPlan` (a draft covering today → any plan covering today →
soonest non-past → null). There's no way to look at last week's plan, no
way to flip to next week's draft, and no way to set up a plan two weeks
out without first finishing or abandoning whatever the helper auto-picked
today. The user wants prev/next week navigation so the page actually
behaves like a calendar.

## Scope

- **In:** prev/next/today navigation on `/planner` with the viewed week
  encoded in the URL as `?week=YYYY-MM-DD` (always a Monday). Initial
  load with no param redirects to the current week. Empty-state UI for
  weeks with no plan (create-CTA on current/future, read-only "No plan
  recorded" on past).
- **In:** swap the Planner's data flow from "pick one plan, render"
  to "load all plans, render the one matching the URL." The plan list
  becomes the single source of truth for the page; navigation is a
  cheap URL change with no extra fetches.
- **In:** an inline `+1 other plan for this week — switch` notice when
  the viewed week happens to have multiple plans (drafts win the
  default tiebreak; the notice lets you flip to the other one).
- **Out (v1):** a date picker on the week label. Arrows are enough for
  near-term navigation; we can add a date picker later if it turns
  out users actually need to jump 6 months.
- **Out (v1):** a horizontal "weeks strip" or full plans-list drawer.
  Same reasoning — YAGNI until the arrows feel insufficient.
- **Out (v1):** any server-side change. The existing `GET /api/plans`
  already returns every plan (newest first), and `POST /api/plans`
  already accepts an arbitrary `weekStartDate`. No schema changes, no
  new endpoints.
- **Out (v1):** deleting a whole `WeeklyPlan` from the UI (still no
  affordance for it today; out of scope here).
- **Out (v1):** unit tests of the new pure helpers via a client-side
  Vitest setup. The client doesn't have a test runner today; adding
  one is its own project. Helpers are typecheck-validated and
  exercised in the smoke checklist.

## User flow

1. User navigates to `/planner` with no `?week=` param.
2. The page reads no param, computes "this Monday" in local time, and
   `replace`s the URL to `/planner?week=<this Monday>`. Initial history
   starts on the current week.
3. The page fetches `GET /api/plans` once, gets every plan ever made.
4. The plan matching the viewed week renders in the existing 7-column
   grid. If multiple plans match the same week, drafts win the
   tiebreak; if no plan is a draft, the first by id wins. The inline
   notice appears when the count is >1.
5. If no plan matches the viewed week:
   - **Current or future week:** a dashed-border CTA card above the
     grid: `No plan for this week yet — Create plan for the week of
     <Mon Apr 27>`. Click → `POST /api/plans` with that `weekStartDate`,
     merge response into the local plans array, grid re-renders with
     the new plan. Below the CTA, the 7-column grid renders with day
     labels but greyed-out slot placeholders (no `+ Add` buttons).
   - **Past week:** the same dashed-border card but with read-only
     text: `No plan recorded for this week.` No button. Same greyed
     grid below.
6. **Click `‹`** → URL `push`es `?week=<viewed - 7d>`. New week renders.
   Browser back returns to the previous week.
7. **Click `›`** → URL `push`es `?week=<viewed + 7d>`.
8. **Click Today** → URL `push`es `?week=<this Monday>` if not already
   there. Today button is disabled when on the current week.
9. **Click the duplicate-plan switcher** → swaps which of the two
   matching plans renders. Same URL.

## Architecture

### Modified files

- `client/src/pages/Planner.tsx` — the main change. Replace the
  `pickRelevantPlan(plans)` call with derivation from URL state. Add
  prev/next/today controls. Add empty-state rendering. Add the
  duplicate-plan inline switcher.
- `client/src/api/plans.ts` — add two pure helpers, `parseWeekParam`
  and `pickPlanForWeek`. Both live next to the existing
  `pickRelevantPlan`, `getNextMonday`, `localMidnightFromISO` helpers.

### Unchanged files

- `client/src/api/plans.ts` (other than the additions) — types,
  fetchers, and existing helpers stay as-is. `pickRelevantPlan` stays
  exported because the Dashboard or other pages may still want
  "pick the single most relevant plan" semantics; only the Planner
  stops using it.
- `server/**/*` — no server changes. `GET /api/plans` and
  `POST /api/plans` already do what we need.
- `client/src/api/client.ts`, all other Pantry / Recipes / Plans
  components — untouched.

### Data flow

```
URL ?week=YYYY-MM-DD
  ↓ useSearchParams + parseWeekParam
viewedWeek (string)         ←─────────┐
                                       │
GET /api/plans                         │
  ↓                                    │
plans: WeeklyPlan[]                    │
  ↓ pickPlanForWeek(plans, viewedWeek) │
viewedPlan: WeeklyPlan | null          │
  ↓                                    │
Planner grid renders                   │
                                       │
Mutations on viewedPlan ──→ update plans array in place
                                       │
prev / next / today / switcher ───────┘ (URL change only)
```

`viewedPlan` is `useMemo`-derived from `plans` + `viewedWeek`; no state
mirror. Mutations update the `plans` array (existing pattern); the
derivation re-runs and the grid re-renders.

### URL contract

- **Param:** `?week=YYYY-MM-DD` — must be a Monday in local time.
- **Initial load with no `?week=`:** `replace` to `?week=<this Monday>`.
  Replace, not push — the user shouldn't have to back-button through a
  redirect.
- **Arrow / Today clicks:** `push` so browser back/forward walk through
  visited weeks.
- **Malformed param:** `parseWeekParam` snaps to the Monday of that
  date's calendar week. If the date itself is unparseable, snap to
  today's Monday. No error toast, no redirect — quietly correct.
- **Switcher click:** no URL change. Just swaps which plan in the
  derivation wins.

### Pure helpers

```ts
// client/src/api/plans.ts (appended)

/**
 * Normalize an arbitrary week-param string to a 'YYYY-MM-DD' Monday in
 * local time. Used to make the URL canonical regardless of how the user
 * landed on the page.
 *
 * - Valid YYYY-MM-DD that's already a Monday → unchanged.
 * - Valid YYYY-MM-DD on any other day        → snaps to that calendar
 *                                               week's Monday.
 * - Empty / malformed input                  → today's Monday.
 */
export function parseWeekParam(raw: string | null | undefined): string;

/**
 * Pick which plan in the array represents the viewed week. Drafts win
 * the default tiebreak; otherwise lowest id wins (deterministic). Returns
 * null when no plan matches.
 */
export function pickPlanForWeek(plans: WeeklyPlan[], weekStart: string): WeeklyPlan | null;
```

## Empty-state UX

- **Empty grid layout:** the same 7-column grid the populated plan
  renders, but every slot is a greyed placeholder — no `+ Add` button,
  no meal pill. Day-of-week labels and dates render normally.
- **Current / future week, no plan:** a CTA card renders **above** the
  empty grid (full-width, dashed border, same family as today's "No
  active plan yet" empty state). Text: `No plan for this week yet`.
  Button: `Create plan for the week of <Mon Apr 27>` →
  `POST /api/plans` with `{ weekStartDate: viewedWeek }`. On success,
  merge the new plan into the local `plans` array; the grid re-renders
  with the actual plan in place. Below the CTA, the empty 7-column
  grid renders as visual context — day labels with dates, but the
  slot rows show greyed placeholders (no `+ Add` buttons). Helps the
  user understand the shape they're about to fill.
- **Past week, no plan:** same empty grid + greyed text `No plan
  recorded for this week.` No CTA. Read-only history.

## Duplicate-plan handling

- **Detection:** `plans.filter((p) => p.weekStartDate === viewedWeek)`
  returns more than one entry.
- **Default pick:** drafts first; if none, lowest `id` wins. (This is
  the same intent as `pickRelevantPlan`'s draft preference, just
  scoped to a fixed week.)
- **UI:** a small inline notice between the page header and the grid
  reads `Showing draft. +1 active plan for this week — switch.`
  (Or "+N other plans" if more than 2 — unlikely but cheap to handle.)
  Click `switch` → cycle to the next-best plan for that week. No URL
  change.

## Edge cases

- **Browser back/forward** → works automatically; each arrow click is a
  `push`, the initial no-param redirect is a `replace`.
- **Bookmark / share** → works because `?week=` is the canonical week.
- **`?week=2026-02-30`** or other invalid date → `parseWeekParam`
  silently snaps. Browser parses 2026-02-30 as Mar 2; that calendar
  week's Monday is Feb 26 (or whatever). User sees the right week.
- **`?week=` not a Monday** (e.g., user shared a Wednesday URL) →
  `parseWeekParam` snaps it to that week's Monday. Quietly canonical.
- **Empty week → click "Create" → server creates plan** → response has
  `weekStartDate === viewedWeek`, merge into `plans`, re-render. No URL
  navigation needed.
- **Rapid arrow clicks** → URL updates atomically; React batches the
  re-renders; the grid keys off `viewedWeek` so it swaps without
  flicker.
- **Today highlight crosses midnight while the page sits open** → the
  highlight is computed from `new Date()` at render. Stale until the
  next render. Acceptable; refresh fixes it. Not worth a daily timer.
- **No plans at all** → still works. Initial fetch returns `[]`, viewing
  the current week renders the empty + CTA. First click of the CTA
  creates the first plan.

## Testing

No new server routes, no schema, no service logic — testing burden is
small.

**Pure helpers (would be unit-tested if `client/` had a test runner;
typecheck-validated and smoke-exercised today):**
- `parseWeekParam(raw)`:
  - Valid Monday string → unchanged.
  - Mid-week date → snaps to that week's Monday.
  - Invalid date → today's Monday.
  - Empty / null / undefined → today's Monday.
- `pickPlanForWeek(plans, weekStart)`:
  - No plans → null.
  - One plan matching → that plan.
  - Two plans matching, one draft → draft wins.
  - Two plans matching, neither draft → lowest `id` wins.
  - Plans for other weeks present → ignored.

**Smoke checklist (manual, run by reviewer):**
1. Land on `/planner` → URL shows `?week=<this Monday>`, current week
   renders.
2. Click `›` → URL updates, next week shows. If no plan exists,
   empty + CTA appears.
3. Click `‹` from current week → previous week shows; if no plan,
   read-only "No plan recorded" text appears (no CTA).
4. Click "Today" → snaps to current week, button greys out.
5. Browser back → returns to the previous week visited.
6. Reload while on `?week=2026-05-11` → same week re-renders.
7. From an empty future-week CTA, click Create → grid populates, you
   can immediately add a planned meal.
8. Manually insert two plans for the same week (e.g., via a quick psql
   SSH nudge: `INSERT INTO weekly_plans (week_start_date, status) VALUES
   ('2026-05-11', 'active'), ('2026-05-11', 'draft');`) → the inline
   switcher appears, clicking cycles between them.
9. Hit `/planner?week=garbage` → silently lands on the current week.
10. Hit `/planner?week=2026-05-13` (a Wednesday) → silently snaps to
    Monday 2026-05-11.
