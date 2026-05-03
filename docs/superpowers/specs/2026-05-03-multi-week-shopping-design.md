# Multi-Week Shopping List Navigation — Design Notes

**Date:** 2026-05-03
**Status:** Approved. Next step: implementation plan.
**Trigger:** The shopping list page only ever shows one plan's list, picked
by `plans.find((p) => p.status === "active") ?? plans[0]`. There's no way
to flip to next week's list (the actual one the user wants on a Sunday
shopping run), and the header date display is broken — `"2026-04-27T00:00:00.000Z" + "T00:00:00"` produces an invalid date string and renders
"Invalid Date." Same multi-week story as the planner: navigation, plus a
small bug fix on the way.

**Depends on:** the multi-week-planner work (`2026-05-03-multi-week-planner-design.md`),
which adds `parseWeekParam` and `pickPlanForWeek` exports to `api/plans.ts`.
This spec assumes those helpers are present.

## Scope

- **In:** prev/next/today navigation on `/shopping` with the viewed week
  encoded in the URL as `?week=YYYY-MM-DD` (always a Monday). Initial
  load with no param redirects (replace) to the current week.
- **In:** swap the page's data flow from "pick the active plan, render
  its list" to "load all plans, derive viewed plan from URL via
  `pickPlanForWeek`, fetch the list for that plan."
- **In:** empty-state UI for the six cells of the (past / current-future)
  × (list-exists / plan-but-no-list / no-plan) matrix. Past weeks are
  read-only (no checkbox toggling, no Generate button).
- **In:** the broken-date fix on the page header. Currently
  `new Date(plan.weekStartDate + "T00:00:00")` doubles up the time
  portion; replace with `localMidnightFromISO(viewedWeek)` (the existing
  helper from `api/plans.ts`).
- **Out (v1):** combined "merged view" across multiple weeks (sum
  quantities across N plans into one list). The URL contract leaves
  room for `?weeks=...` or `?range=N` later without conflicting with
  the v1 `?week=` param. No code work to "leave the door open" beyond
  not painting into a corner.
- **Out (v1):** confirming Regenerate when items already exist
  (pre-existing UX issue; not scope here).
- **Out (v1):** preserving checked state across regenerates
  (pre-existing service behavior; not scope here).
- **Out (v1):** duplicate-plan inline switcher (parallel feature on the
  planner). Add later if duplicates actually bite.
- **Out (v1):** any server-side change. `GET /api/plans`,
  `GET /api/shopping/:planId`, `POST /api/shopping/generate/:planId`,
  `PUT /api/shopping/item/:id` already cover the API surface.

## User flow

1. User navigates to `/shopping` with no `?week=` param.
2. The page reads no param, computes "this Monday" via `parseWeekParam(null)`,
   and `replace`s the URL to `/shopping?week=<this Monday>`.
3. Page fetches `GET /api/plans` once, gets every plan.
4. `viewedPlan` is `pickPlanForWeek(plans, viewedWeek)`. If non-null, the
   page fetches `GET /api/shopping/:planId` and renders items.
5. **Header** reads `Week of <Mon Apr 27> · N to buy` (or just
   `Week of <Mon Apr 27>` when no list exists). Prev/next arrows flank
   the label; Today button to the right; **Regenerate** action stays
   on the right side **only on current/future weeks where a list
   already exists**.
6. **Body** depends on the matrix:
   - **Past + list exists:** items render with disabled checkboxes
     (visual state preserved, click is a no-op).
   - **Past + plan, no list:** dashed card `No shopping list for this
     week.` (no button).
   - **Past + no plan:** dashed card `No plan recorded for this week.`
   - **Current/Future + list exists:** items render normally with the
     existing To buy / Already in pantry / Done sections.
   - **Current/Future + plan, no list:** dashed card `No shopping list
     yet — Generate from this week's plan` (button calls the existing
     `generateShoppingList(viewedPlan.id)`).
   - **Current/Future + no plan:** dashed card `No plan for this week.
     Create one in the Planner →` linking to
     `/planner?week=<viewedWeek>` (carries the viewed week into the
     planner so the user lands on the same week they wanted to shop
     for).
7. **Click `‹`** → URL `push`es `?week=<viewed - 7d>`. The new week
   re-derives `viewedPlan`; if it has a different id than the previous
   plan, the items refetch.
8. **Click `›`** → URL `push`es `?week=<viewed + 7d>`.
9. **Click Today** → URL `push`es `?week=<this Monday>` if not already
   there. Today button disabled when on the current week.
10. **Click an item checkbox**:
    - On current/future weeks → toggles via existing `toggleItem`.
    - On past weeks → no-op. Cursor is `not-allowed`.

## Architecture

### Modified files

- `client/src/pages/ShoppingList.tsx` — main change. Swap single-plan
  state for `plans: WeeklyPlan[]` + URL-derived `viewedWeek`. Add
  prev/next/today controls, six-state body, broken-date fix, past-week
  read-only behavior.

### No changes

- `server/**/*` — no schema changes, no new endpoints.
- `client/src/api/shopping.ts` — types and fetchers stay as-is.
- `client/src/api/plans.ts` — relies on `parseWeekParam`,
  `pickPlanForWeek`, and `localMidnightFromISO` already exported by the
  multi-week-planner work.
- `client/src/pages/Planner.tsx`, anything else — untouched.

### Data flow

```
URL ?week=YYYY-MM-DD
  ↓ useSearchParams + parseWeekParam
viewedWeek (string)
  ↓
plans (fetched once on mount)  ── pickPlanForWeek(plans, viewedWeek) ──→ viewedPlan
                                                                          ↓
                                         (effect on viewedPlan?.id) ───→ items: ShoppingItem[]
                                                                          ↓
                                                                       Render — six-state matrix
```

`viewedWeek` is the single source of truth for the URL. `viewedPlan`
re-derives whenever `plans` or `viewedWeek` changes. `items` refetches
when `viewedPlan?.id` changes; an empty array shows briefly during the
transition (no explicit loading spinner — the existing rendering handles
empty arrays cleanly).

### URL contract

Mirrors the planner's:

- `?week=YYYY-MM-DD` (Monday) is the source of truth.
- Initial no-param load: `replace` to `?week=<this Monday>`.
- Arrow / Today clicks: `push` for browser back/forward.
- Malformed param: `parseWeekParam` snaps to that calendar week's
  Monday. If the input is unparseable, snap to today's Monday. No
  error toast.

The `?week=` param is reserved for single-week navigation. A future
merged view can add `?weeks=W1,W2,...` or `?range=N` without conflict.

### State

- `plans: WeeklyPlan[]` — fetched once on mount.
- `items: ShoppingItem[]` — the viewed plan's shopping list.
- `generating: boolean` — unchanged from today.
- `viewedWeek: string` — derived from `?week=` URL param via
  `parseWeekParam`.
- `viewedPlan: WeeklyPlan | null` — derived via `pickPlanForWeek`.
- `isPastWeek: boolean` — `viewedWeek < todayWeek` (string comparison
  on canonical YYYY-MM-DD).
- `isViewingToday: boolean` — `viewedWeek === todayWeek`.

### Mutations

- **Generate / Regenerate** → `generateShoppingList(viewedPlan.id)`,
  replace local `items` with response. Pre-existing service behavior:
  deletes existing rows first (so check state is lost across
  regenerate).
- **Toggle item** → `toggleItem(id, checked)`, update matching item in
  `items` in place. **Early-return when `isPastWeek`** so past lists
  don't accept toggles.

### Broken-date fix

```tsx
// Before:
const monthLabel = plan?.weekStartDate
  ? new Date(plan.weekStartDate + "T00:00:00").toLocaleDateString(
      undefined, { month: "long", day: "numeric" })
  : null;

// After:
const monthLabel = localMidnightFromISO(viewedWeek)
  .toLocaleDateString(undefined, { month: "long", day: "numeric" });
```

`viewedWeek` is always a YYYY-MM-DD canonical Monday, so the label
always renders correctly — including on weeks with no plan.

## Empty-state UX

### The six-state matrix

|                       | List exists                                                          | Plan but no list                                                     | No plan                                              |
|---                    |---                                                                   |---                                                                   |---                                                   |
| **Past**              | Items render with **disabled** checkboxes (visual state preserved). | Dashed card: `No shopping list for this week.` No button.           | Dashed card: `No plan recorded for this week.`        |
| **Current / Future**  | Items render normally (To buy / Already in pantry / Done sections). | Dashed card: `No shopping list yet — Generate from this week's plan`. Button calls the existing generate handler. | Dashed card: `No plan for this week. Create one in the Planner →` linking to `/planner?week=<viewedWeek>`. |

### Header behavior

- `Week of <date>` — always renders correctly (broken-date fix).
- `· N to buy` count — appended only when a list exists with at least
  one to-buy item.
- Prev / Next / Today — always rendered.
- **Regenerate** button (top-right) — rendered only when:
  - `!isPastWeek` (no edits to history)
  - `viewedPlan` is non-null (something to regenerate from)
  - `items.length > 0` (otherwise the body's "Generate" CTA covers it)

### Past-week read-only

- Item rows render but with `cursor-not-allowed` and a disabled
  appearance on the checkbox.
- The toggle handler early-returns when `isPastWeek`; clicks are silently
  ignored.
- No Regenerate button (per above).
- This matches the user-confirmed "past = strictly read-only" choice
  from brainstorming.

## Edge cases

- **Browser back/forward** → works automatically. Arrows `push`,
  initial redirect `replace`s.
- **Bookmark/share a week URL** → canonical, just works.
- **Malformed `?week=`** → quietly snaps via `parseWeekParam`.
- **Plan exists, no list yet** → `Generate from this week's plan` CTA in
  the body. Clicking calls the existing endpoint; UI re-renders.
- **Generate while items exist** → existing service deletes rows first,
  loses check states. Pre-existing behavior; not scoped here. (A
  future PR may add a confirm-and-preserve step.)
- **Past week + click an item** → no-op. Pointer feedback shows the
  click is intentionally inert.
- **Plan generated in another tab while this one is on `?week=`** →
  existing tab doesn't pick it up until reload. Acceptable; same
  pattern as the planner.
- **Plan deleted while viewing** → no UI exposes plan deletion today;
  out of scope.
- **Two plans for one week** → `pickPlanForWeek` picks one (drafts
  first, then by id). Edge: list belongs to the active plan, but the
  picker shows the draft, so the user sees "Generate" instead of
  items. Rare; if it bites we add a duplicate-plan switcher in a
  follow-up.
- **No plans at all** → fetch returns `[]`, viewedPlan is null,
  current week shows "No plan for this week. Create one in the
  Planner →" CTA.

## Testing

No new server routes, no schema, no service logic. The pure helpers
(`parseWeekParam`, `pickPlanForWeek`, `localMidnightFromISO`) come from
the planner work and are already exercised. Nothing new to unit-test.

**Smoke checklist (manual, run by reviewer):**
1. Land on `/shopping` → URL `replace`s to `?week=<this Monday>`. Header
   reads `Week of <readable date>` (no longer "Invalid Date").
2. Plan + list exists for this week → items render normally; `· N to
   buy` count appears in header.
3. Click `›` to next week. If plan exists, no list → body shows
   "Generate from this week's plan" CTA. Click → list populates.
4. Click `›` again to a future week with no plan → body shows "No plan
   for this week. Create one in the Planner →". Click → lands on
   `/planner?week=<that Monday>`.
5. Click `‹` to a past week with a list → items render with disabled
   checkboxes. Clicking a row does nothing. No Regenerate button in
   the header.
6. Click `‹` further to a past week with no list → "No shopping list
   for this week" dashed card. No button.
7. Click Today → snaps to current week, button greys out.
8. Browser back walks through visited weeks.
9. Reload while on `?week=2026-05-11` → same week re-renders with the
   same items.
10. Hit `/shopping?week=garbage` → quietly lands on the current week.
