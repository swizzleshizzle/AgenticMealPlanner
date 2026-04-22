# Add-to-Plan from Recipe Detail — Design Notes

**Date:** 2026-04-22
**Status:** Approved. Next step: implementation plan.
**Trigger:** On the recipe detail page, both the "Add to plan" and "Scale
servings" buttons are non-op placeholders. Scale Servings is being deleted
(the planner's per-occurrence servings stepper already covers the real use
case). Add to plan is being wired up — it's a legitimately useful jump from
a recipe to scheduling it without routing through the planner.

## Scope

- **In:** a new modal opened from `RecipeDetail` that lets the user pick day,
  slot, servings, and cook-style for the recipe, then adds it to the most
  relevant existing plan via the existing `POST /api/plans/:id/meals` endpoint.
  A minimal in-house toast primitive to confirm the add, with a "View plan"
  action.
- **In:** deleting the `Scale servings` button from `RecipeDetail`.
- **Out:** scaling recipe ingredient quantities (YAGNI — not actually needed;
  the per-plan servings stepper covers real cases).
- **Out:** any server-side change. Uses existing endpoints.
- **Out:** recipe state preservation across navigation when there's no plan
  yet — the user heads to the planner and comes back.
- **Out:** queued toasts, undo, persistent notification center. Single toast
  at a time, auto-dismiss.

## User flow

1. User is on `/recipes/:id` and clicks **Add to plan**.
2. Modal opens. It fetches plans and picks the most relevant one (draft
   covering today → any plan covering today → soonest non-past → null).
3. If no plan exists, the modal shows a "No active plan yet" state with a
   **Go to planner →** action that navigates to `/planner`. The user builds
   a plan there and comes back to the recipe page if they still want to add
   it.
4. If a plan exists, the modal's body shows day / slot / servings /
   cook-style controls with smart defaults:
   - **Day + slot:** the first empty `{day, slot}` pair in the week, scanned
     Mon → Sun and Lunch → Dinner per day.
   - **Servings:** the recipe's base `meal.servings`.
   - **Cook style (`isPrep`):** `day === "sunday" && !!meal.canBatch` —
     matches the `Planner.handlePick` rule we just shipped with the
     multi-cook-style work.
5. If the user picks an already-occupied `{day, slot}`, the modal shows an
   amber inline note naming the existing meal. Confirmation still works; the
   add creates a second row in that slot (the planner UI renders the first
   match, so this is a soft warning not a hard block).
6. User clicks **Add to plan**. The modal calls `addPlannedMeal` and closes
   on success. A toast appears: *"Added to Thursday dinner"* with a **View
   plan** action that navigates to `/planner`.
7. On server error, the modal stays open and renders an inline error banner
   at the bottom; the user can retry or cancel.

## Architecture

### New files

- `client/src/components/AddToPlanModal.tsx` — the modal component.
- `client/src/components/ui/ToastProvider.tsx` — context provider + `useToast`
  hook + single-toast state.
- `client/src/components/ui/Toast.tsx` — the visual. Styled with existing
  tokens (`surface-1`, `line`, `accent-ink`).

### Modified files

- `client/src/pages/RecipeDetail.tsx` — remove the `Scale servings` button;
  wire the `Add to plan` button to open `AddToPlanModal`; call
  `useToast()` on the success callback.
- `client/src/App.tsx` — wrap the route tree in `<ToastProvider>`.
- `client/src/api/plans.ts` — extract and export two helpers currently
  duplicated inline in `Planner.tsx`:
  - `pickRelevantPlan(plans: WeeklyPlan[]): WeeklyPlan | null` — the
    draft-covering-today → any-covering-today → soonest-non-past fallback
    chain, pulled from `Planner.tsx:110-121`.
  - `getNextMonday(): string` — the "upcoming Monday on-or-after today,
    local-time YYYY-MM-DD" helper, pulled from `Planner.tsx:55-64`.
  Update `Planner.tsx` to consume these shared helpers instead of its
  private copies.

## Modal structure

### Fields in order

1. **Target plan context line** (not editable) — "Adding to week of [Monday,
   April 27]".
2. **Day** — seven capsule buttons (Mon–Sun), same visual style as the slot
   toggle in `PlannedMealEditModal`. Each capsule shows the three-letter day
   label; a small dot under the label indicates a day that is fully booked
   (both lunch and dinner already taken).
3. **Slot** — Lunch / Dinner toggle, two capsules. Below the toggle, a line
   of small text either shows "Slot is open" or "Already has X in this slot"
   with an amber tone when occupied.
4. **Servings** — ± stepper identical to the one in `PlannedMealEditModal`
   (min 1, max 12, `tabular-nums` display).
5. **Cook style** — Fresh / Batch toggle, same visual pattern as the edit
   modal's. Default comes from the Sunday-only rule above; user can override.
6. **Footer:** `Cancel` (ghost) + `Add to plan` (primary). Primary is
   disabled while the add is in flight.

### No-plan state

Replaces the body (keeps the header + close X) with:

- CalendarDays icon (top-center, `accent-ink`).
- Title: "No active plan yet".
- Body: "The next plan would start Monday, [date]. Head to the planner to
  set it up." — where `[date]` comes from `getNextMonday()` formatted as
  "Month Day" in the user's locale.
- Actions: **Go to planner →** (primary, navigates to `/planner`) + **Cancel**
  (ghost).

## Toast primitive

### Contract

```ts
type Toast = {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
};

// Single-toast state, not a queue. Replace-on-new.
// Auto-dismiss at 4000ms. Hover pauses the timer.
```

The provider exposes a `show({ message, action? })` function via a
`useToast()` hook. Internally a single `Toast | null` state + a `setTimeout`
ref. When `show` is called while a previous toast is still visible, the
previous one is replaced (no queue).

### Visual

- Fixed `bottom-4 right-4`, `z-[300]` (above modals, which use `z-[200]`).
- Container: `bg-surface-1 border border-line rounded-[12px] px-4 py-3
  shadow-[var(--shadow-hero)]`.
- Message: `text-[13.5px] text-ink-1`.
- Action (if present): right-aligned button, `text-[12.5px]
  text-accent-ink hover:underline`.
- Enter/exit: fade + translate-y on mount/unmount. Respect
  `motion-reduce:transition-none`.

### Why hand-rolled vs library

The app has a hand-rolled design system with consistent tokens (`surface-1`,
`line`, `accent-ink`, `shadow-hero`). A library toast (`sonner`,
`react-hot-toast`) would need restyling to match. Total estimated size is
~80 lines; not worth a dependency for one use case.

## Edge cases

| Scenario | Behavior |
| --- | --- |
| No plan exists | No-plan state in the modal; `Go to planner →` action. |
| Multiple eligible plans | Auto-pick via `pickRelevantPlan` chain. No picker in v1. |
| User selects an occupied `{day, slot}` | Amber warning under the slot toggle; confirm still works; server creates a second row. |
| Plan mutated between open and confirm | Race accepted; add proceeds against the stale plan id. If it becomes a problem later, add a refetch-on-confirm. |
| Recipe deleted mid-flow | Not defended; `RecipeDetail` already loaded the meal so data is in hand. |
| Server error on confirm | Inline error banner at the modal footer; modal stays open; user can retry or cancel. |
| Concurrent auto-generate | Out of scope — consistent with how the planner handles concurrent manual adds today. |

## Interaction with recently-shipped multi-cook work

- The `isPrep` default reuses the rule from `Planner.handlePick`:
  `day === "sunday" && !!meal.canBatch`. This is the same rule the
  auto-generator's validator enforces. If either place's rule changes, both
  need to change in sync.
- Because `mealType` has been dropped (migration 004), the modal reads
  `meal.canBatch` / `meal.canFresh` directly — no legacy enum reference.

## Testing

Pragmatic, matches existing repo conventions (no client test framework
today, only server vitest):

- The two helpers extracted into `api/plans.ts` (`pickRelevantPlan` and
  `getNextMonday`) are direct transplants of already-working inline logic
  from `Planner.tsx`. Correctness is preserved by keeping the Planner on
  the same helpers — if either regresses, the Planner's existing behavior
  (dashboard selection + getNextMonday for new plans) will break visibly.
  No new unit tests; adding vitest to the client for two pure functions
  isn't worth the toolchain overhead.
- The modal itself and the toast get a manual smoke test checklist executed
  in the implementation plan: (1) add from recipe, confirm it lands on the
  planner; (2) add when no plan exists, confirm navigation; (3) add into an
  occupied slot, confirm the warning and that the add still works;
  (4) server error, confirm the inline banner and that the modal stays open.
- Typecheck (`tsc --noEmit`) + the existing server test suite must stay
  green.

## Out of scope (deferred)

- Plan picker (multiple eligible plans): not needed given there's usually
  one draft at a time. Revisit if the app grows multi-plan workflows.
- Undo: we're not wiring an undo for the add. If the user adds to the
  wrong slot, they fix it via the planner's existing swap / remove flow.
- Persistent or queued notifications: one toast at a time, no history.
- Preserving the recipe-in-flight across a `Go to planner` navigation from
  the no-plan state: user goes to the planner, builds a plan, comes back.
- Creating a plan from the recipe page: handled by the planner's existing
  "New plan" button.
