# Receipt Review Modal — Layout & UX Redesign

**Date:** 2026-05-03
**Status:** Approved. Next step: implementation plan.
**Trigger:** The "Add from receipt" review stage in `AddFromReceiptModal.tsx`
crams seven editable columns into a 640px modal. Each row uses its own
`grid-cols-[...]` template, so columns don't visually align across rows.
Parsed names truncate to `lime ...` / `le...` / `br...`, removing the
context that makes review possible. The "Create '<name>'" affordance
wraps to four lines on long names (e.g. "super blend greens"), blowing
up that row's height and breaking the rhythm of the list. Receipt review
is *the* dense screen in the app and currently the worst-feeling one.

## Scope

- **In:** Desktop-only widening of the review-stage modal from
  `max-w-[640px]` to `max-w-[1000px]`, with a single shared CSS grid
  template applied to a new sticky column header and every data row.
- **In:** Item-cell consolidation so confident-match, low-confidence-match,
  and needs-create rows all share one consistent layout. The
  `Create "<name>"` button is constrained to its column so it can never
  wrap.
- **In:** Display-only normalization of the unit input — render `count`
  as `ea`. Stored value is unchanged.
- **Out:** Mobile (`< sm`) layout. The current stacked design tested fine
  on phone; the new table is gated behind `sm:` and mobile keeps today's
  rendering verbatim.
- **Out:** The upload stage, parsing stage, error stage, header tiles
  (Store / Trip date / Total), the non-food collapsible at the bottom,
  and the footer. None change.
- **Out:** Bulk actions (select-all, set-all-location), row grouping by
  attention-needed, and any reordering of rows. Discussed and deferred —
  layered features that can come later if review still feels slow after
  the layout fix.
- **Out:** Any server-side or API change. This is a pure client-side
  refactor of `client/src/components/AddFromReceiptModal.tsx`.

## Vessel & breakpoints

- Modal shell: `max-w-[640px]` → `max-w-[640px] md:max-w-[1000px]` on
  the outer container in `AddFromReceiptModal`. Below `md` the cap stays
  at the current 640px (and is bound by the viewport on real phones);
  at `md+` the modal can grow to 1000px. Same `max-h-[88vh]`, same
  `rounded-[16px]`, same overlay treatment.
- The Tailwind `md:` breakpoint (768px) is the switch point between
  mobile rendering (today's stacked card-per-row) and the new desktop
  table. **Why `md:` and not `sm:`**: at a 640px viewport the table's
  fixed columns (484px total + 48px gaps + 40px padding = 572px) leave
  only ~68px for the Item column, which is unusable. At 768px the Item
  column gets ~196px — tight but viable, and at 768px the iPad-portrait
  use case is preserved. Below `md`, `RowEditor` keeps its current
  `grid-cols-[auto_1fr_auto_auto]` layout. At `md+`, both the new
  header row and `RowEditor` use the shared 7-column template described
  below.
- Header tiles (Store / Trip date / Total) and footer (Cancel / Commit)
  layouts are unchanged — they already use a `grid-cols-1 sm:grid-cols-3`
  pattern that scales fine to 1000px.

## Shared grid template

One template, applied to the header row and every `RowEditor` at `md+`:

```
grid-cols-[28px_minmax(0,1fr)_72px_72px_104px_136px_72px]
```

| # | Column   | Width        | Content                                          |
|---|----------|--------------|--------------------------------------------------|
| 1 | ☐        | 28px         | `isCommitted` checkbox                           |
| 2 | Item     | `1fr`        | Match badge + parsed name, OR Create button      |
| 3 | Qty      | 72px         | `quantity` number input                          |
| 4 | Unit     | 72px         | `unit` text input (display: `count` → `ea`)      |
| 5 | Location | 104px        | `locationGuess` select (Fridge/Freezer/Pantry)   |
| 6 | Expires  | 136px        | `expirationDate` date input                      |
| 7 | Price    | 72px         | Read-only, right-aligned, `tabular-nums`         |

At 1000px modal width minus padding (`p-4 sm:p-5` on the body) and the
6 inter-column gaps (`gap-2`, 8px each), the Item column gets ~350px —
ample for typical parsed names without truncation.

## Sticky column header

A new header row, same grid template, rendered immediately above the
food-items list inside the existing scrollable body
(`flex-1 overflow-y-auto`). Sticks to the top of that scroll container
so the Store / Trip date / Total tiles scroll away but the column
labels remain.

- Container: `sticky top-0 z-10 bg-surface-1 border-b border-line-soft`.
- Cell labels: existing
  `text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold`
  treatment. Labels: ☐ (no text), `Item`, `Qty`, `Unit`, `Location`,
  `Expires`, `Price`.
- Rendered just below today's `Food items (N/M selected)` strapline.
  The strapline itself remains non-sticky and scrolls away with the
  Store/Trip/Total tiles; the column header is what stays pinned.

## Item cell — three states, one shape

Today's `RowEditor` renders the match-vs-create distinction inside an
inner flex container with no width discipline. The redesign keeps three
visual states but unifies them under one cell shape:

**Confident match** (`ingredientId != null`, `matchConfidence !== "low"`)

```
[lime]  lime, large fresh
 ^badge ^parsed name
```

- Badge: existing `bg-accent-soft text-accent-ink border border-accent-line`.
- Parsed name: `text-[11px] text-ink-3 truncate`. Wider column means
  truncation rarely fires, but `title={row.parsedName}` provides the
  full text on hover as a safety net.

**Low-confidence match** (`matchConfidence === "low"`)

- Identical structure. Badge swaps to
  `bg-warn-soft text-warn-ink border border-warn-line`. No layout
  difference — the warn color *is* the signal.

**Needs create** (`ingredientId == null`)

```
[+ Create "super blend greens"]
```

- Single-line button: `inline-flex items-center gap-1 max-w-full truncate`.
- Click toggles `showCreateForm` (existing logic). When expanded, the
  Name + Category mini-form renders as a **second grid row that spans
  all 7 columns** (`col-span-7`) directly below the data row, visually
  attached. This replaces today's separate `mt-2 grid-cols-1 sm:grid-cols-3`
  block, which lives outside the row's grid and looks orphaned.
- The mini-form keeps its current fields and copy.

**Unchecked rows** (`!isCommitted`) keep today's `opacity-50` on the
whole `<li>` — unchanged from current behavior. (Badges-stay-bright
was considered but cut: CSS opacity cascades through the parent
compositing layer, so the only ways to deliver it would be to drop the
parent opacity and explicitly dim each child cell, or use a non-opacity
treatment. Not worth the complexity for the marginal UX gain; revisit
if review-with-many-unchecks becomes a real workflow.)

## Field details

- **Unit display**: read `row.unit`, render `unit === "count" ? "ea" : unit`
  in the input's value. On change, write the user's literal input back.
  The stored unit string is unchanged for the commit payload — this is
  presentation only.
- **Quantity, Location, Expires, Price**: same controls, same logic.
  Just slot into the new column widths.

## Mobile (`< md`)

No changes. The current `grid-cols-[auto_1fr_auto_auto]` layout in
`RowEditor`, the existing wrapping behavior, and the existing
`Create "<name>"` button rendering all stay. The new shared template
only applies under `md:`.

## Files touched

- `client/src/components/AddFromReceiptModal.tsx` — the only file. Modal
  shell width, the new sticky header element, the shared grid template
  on `RowEditor`, the consolidated Item cell, and the unit display
  helper all live here.

## Out of scope (explicitly)

- No changes to `parseReceipt` / `commitReceipt` / `CommitItemEdit`.
- No changes to row sort order, grouping, or visibility logic.
- No new bulk-action UI.
- No API or schema work.
- No mobile redesign.
