# Receipt Review Modal Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the receipt-review stage in `AddFromReceiptModal.tsx` as a real columnar table at `md+` (≥768px) with a sticky column header and a single shared CSS grid template, fixing today's misaligned per-row grids, truncated parsed names, and 4-line-wrapping "Create '<name>'" button. Mobile (`< md`) keeps today's layout untouched.

**Architecture:** Pure client-side, single-file refactor. Widen the modal shell from `max-w-[640px]` to `md:max-w-[1000px]`. Pull the row's grid template up to a constant; apply that same template to a new sticky header element and to `RowEditor` (replacing today's `sm:grid-cols-[...]` with `md:grid-cols-[...]`). Restructure `RowEditor` so the `<li>` itself is the grid container, allowing the create-form expansion to render as a `col-span-full` second grid row inside the same item rather than a separate `<div>` underneath. Display `count` units as `ea`. No state, prop, or API change.

**Tech Stack:** React 18, TypeScript, Tailwind v4. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-03-receipt-review-layout-design.md` — read first.

---

## File Structure

### Modify

- `client/src/components/AddFromReceiptModal.tsx` — the only file. Modal shell width, the new sticky header element, the shared grid template on `RowEditor`, the consolidated Item cell, the `<li>`-as-grid-container restructure, and the unit display helper all live here.

### No changes

- Server, Prisma, the receipts API, ingredient matching — none are touched. This is presentation only.
- `client/src/api/receipts.ts` — unchanged. The `ParseResult` and `CommitItemEdit` shapes are the contract; we don't bend them.
- `client/src/pages/Pantry.tsx` and any other component — unchanged.

---

## Pre-flight: create the worktree and branch

This feature branches from `master`. PR #4 (multi-week shopping) was the most recent merge.

- [ ] **Step 1: Fetch and create the worktree**

From `C:\Users\mlgbr\Desktop\Projects\AgenticMealPlanner`:

```bash
git fetch origin
git worktree add .worktrees/receipt-review-layout -b feature/receipt-review-layout origin/master
cd .worktrees/receipt-review-layout
```

- [ ] **Step 2: Install client deps**

```bash
cd client && npm install && cd ..
```

Expected: ~30s. Some moderate-severity audit warnings — benign.

- [ ] **Step 3: Verify baseline typecheck is clean**

```bash
cd client && npx tsc --noEmit && cd ..
```

Expected: zero errors. If it fails, you branched from the wrong base.

- [ ] **Step 4: Sanity-check the file you're about to edit**

```bash
wc -l client/src/components/AddFromReceiptModal.tsx
```

Expected: 491 lines (master tip after the receipt-tracking PR). If wildly different, re-confirm the base.

---

## Task 1: Widen the modal shell

**Files:**
- Modify: `client/src/components/AddFromReceiptModal.tsx`

**Why:** The smallest possible first change. Bumps the modal's max-width on `md+` to give the table room. Mobile is unaffected — the cap below `md` stays at the current 640px (and is bound by the viewport on real phones). Doing this first means subsequent layout changes have the canvas they need.

- [ ] **Step 1: Edit the modal container's class list**

Find the inner modal `<div>` (line ~67–71). Currently:

```tsx
<div
  onClick={(e) => e.stopPropagation()}
  className="bg-surface-1 rounded-[16px] w-full max-w-[640px] max-h-[88vh] flex flex-col overflow-hidden border border-line"
  style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
>
```

Change `max-w-[640px]` to `max-w-[640px] md:max-w-[1000px]`:

```tsx
<div
  onClick={(e) => e.stopPropagation()}
  className="bg-surface-1 rounded-[16px] w-full max-w-[640px] md:max-w-[1000px] max-h-[88vh] flex flex-col overflow-hidden border border-line"
  style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
>
```

- [ ] **Step 2: Typecheck**

```bash
cd client && npx tsc --noEmit && cd ..
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/AddFromReceiptModal.tsx
git commit -m "refactor(receipt-modal): widen shell to 1000px at md+"
```

---

## Task 2: Restructure `RowEditor` — `<li>` as the grid container, new shared template

**Files:**
- Modify: `client/src/components/AddFromReceiptModal.tsx`

**Why:** Today's `RowEditor` puts the grid on an inner `<div>`, with the create-form expansion rendered as a separate `<div>` below it. That's what makes columns drift across rows (each row computes its own `1fr` proportions independently) and what makes the create form feel disconnected. Moving the grid up to the `<li>` itself gives us:
1. A single grid template applied to every row, so columns line up exactly.
2. A natural place for the create-form expansion to live as a `col-span-full` second grid row inside the same item.

This task ships the structural change. Item-cell polish (Create button truncation, parsed-name visibility) lands in Task 3 so each commit stays small.

- [ ] **Step 1: Add a grid-template constant near the top of the file**

Just below the existing `CATEGORIES` constant (line ~199), add:

```tsx
// Shared grid template for the new desktop (md+) review table.
// Columns: ☐ · Item · Qty · Unit · Location · Expires · Price.
// At md (768px viewport) the modal is 728px usable, the fixed columns
// + gaps consume ~532px, and the Item column gets ~196px — tight but viable.
// At 1000px (md+ desktop cap) the Item column gets ~430px.
const RECEIPT_ROW_GRID =
  "md:grid md:grid-cols-[28px_minmax(0,1fr)_72px_72px_104px_136px_72px] md:items-center md:gap-2";
```

(One short comment is allowed here — the column-budget math isn't obvious from reading the class list, and it's the kind of "why these widths?" question the next reader will have.)

- [ ] **Step 2: Replace `RowEditor`'s outer markup**

Find `RowEditor` (line ~377) and rewrite its return so the `<li>` is the grid container at `md+` while staying as today's stacked layout below `md`. Replace the entire `return (...)` body of `RowEditor` with:

```tsx
return (
  <li
    className={`rounded-[10px] border border-line-soft bg-surface-2 px-3 py-2 grid grid-cols-[auto_1fr_auto_auto] gap-2 items-center ${RECEIPT_ROW_GRID} ${!row.isCommitted ? "opacity-50" : ""}`}
  >
    <input
      type="checkbox"
      checked={row.isCommitted}
      disabled={disabled}
      onChange={(e) => onPatch({ isCommitted: e.target.checked })}
      className="w-4 h-4 accent-accent"
    />

    {/* Ingredient match cell */}
    <div className="min-w-0">
      {row.ingredientId != null ? (
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-[6px] text-[11.5px] font-medium shrink-0 ${
              row.matchConfidence === "low"
                ? "bg-warn-soft text-warn-ink border border-warn-line"
                : "bg-accent-soft text-accent-ink border border-accent-line"
            }`}
          >
            {row.matchedIngredientName ?? `#${row.ingredientId}`}
          </span>
          <span className="text-[11px] text-ink-3 truncate" title={row.parsedName}>
            {row.parsedName}
          </span>
        </div>
      ) : (
        <button
          onClick={() => onPatch({ showCreateForm: !row.showCreateForm })}
          disabled={disabled}
          className="inline-flex items-center gap-1 text-[12px] text-accent-ink hover:underline"
        >
          <Plus size={12} /> Create &ldquo;{row.parsedName}&rdquo;
        </button>
      )}
    </div>

    <input
      type="number"
      step="0.01"
      value={row.quantity}
      disabled={disabled || !row.isCommitted}
      onChange={(e) => onPatch({ quantity: Number(e.target.value) })}
      className="h-8 w-20 md:w-full rounded-[8px] border border-line bg-surface-1 px-2 text-[12.5px] text-ink-1 tabular-nums focus:outline-none focus:border-accent disabled:opacity-50"
    />
    <input
      type="text"
      value={row.unit}
      disabled={disabled || !row.isCommitted}
      onChange={(e) => onPatch({ unit: e.target.value })}
      className="h-8 w-20 md:w-full rounded-[8px] border border-line bg-surface-1 px-2 text-[12.5px] text-ink-1 focus:outline-none focus:border-accent disabled:opacity-50"
    />
    <select
      value={row.locationGuess ?? "pantry"}
      disabled={disabled || !row.isCommitted}
      onChange={(e) => onPatch({ locationGuess: e.target.value as any })}
      className="h-8 md:w-full rounded-[8px] border border-line bg-surface-1 px-2 text-[12.5px] text-ink-1 capitalize focus:outline-none focus:border-accent disabled:opacity-50"
    >
      {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
    </select>
    <input
      type="date"
      value={row.expirationDate ?? ""}
      disabled={disabled || !row.isCommitted}
      onChange={(e) => onPatch({ expirationDate: e.target.value || null })}
      className="h-8 md:w-full rounded-[8px] border border-line bg-surface-1 px-2 text-[12px] text-ink-1 focus:outline-none focus:border-accent disabled:opacity-50"
    />
    <span className="text-[12.5px] text-ink-2 tabular-nums w-16 md:w-full text-right">
      {row.price != null ? `$${row.price.toFixed(2)}` : "—"}
    </span>

    {row.showCreateForm && row.ingredientId == null && (
      <div className="col-span-full md:col-span-7 mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Field label="Name">
          <input
            value={row.parsedName}
            onChange={(e) => onPatch({ parsedName: e.target.value })}
            className="h-8 rounded-[8px] border border-line bg-surface-1 px-2 text-[12.5px] text-ink-1 focus:outline-none focus:border-accent"
          />
        </Field>
        <Field label="Category">
          <select
            value={row.categoryGuess ?? "other"}
            onChange={(e) => onPatch({ categoryGuess: e.target.value as any })}
            className="h-8 rounded-[8px] border border-line bg-surface-1 px-2 text-[12.5px] text-ink-1 focus:outline-none focus:border-accent"
          >
            {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
          </select>
        </Field>
        <div className="text-[11px] text-ink-3 self-end pb-1">
          On commit, a new ingredient will be created with these values + unit &ldquo;{row.unit}&rdquo;.
        </div>
      </div>
    )}
  </li>
);
```

Key differences from the previous version:
- The `<li>` is now the grid container. The inner `<div className="grid ...">` wrapper is gone.
- Mobile keeps `grid grid-cols-[auto_1fr_auto_auto] gap-2 items-center` — same shape as before, just promoted from the inner div to the `<li>`. Auto-flow places the 7 cell children across 2 rows below `md`, exactly like today.
- At `md+`, `RECEIPT_ROW_GRID` overrides with `md:grid-cols-[28px_minmax(0,1fr)_72px_72px_104px_136px_72px]`.
- Number/unit/price inputs keep their existing mobile widths (`w-20`, `w-16`) and add `md:w-full` so they fill the fixed grid columns at `md+`. The select and date inputs had no mobile width class today and gain `md:w-full` only at `md+`. Below `md`, every input renders exactly as it does today — no class is changed unconditionally.
- The create-form expansion is now a child of the `<li>`, with `col-span-full` (mobile auto-flow) and `md:col-span-7` (full width across the desktop grid). It still uses its own internal `grid-cols-1 sm:grid-cols-3` for the Name/Category/help layout — that's a separate, nested grid and stays as-is.
- The badge gets `shrink-0` so it doesn't compress when the parsed-name span fights for space.
- The matched-row's outer flex gets `min-w-0` so the inner `truncate` actually fires (Tailwind's `truncate` requires a constrained parent).
- `title={row.parsedName}` on the parsed-name span gives full text on hover when truncation does kick in.

- [ ] **Step 3: Typecheck**

```bash
cd client && npx tsc --noEmit && cd ..
```

Expected: clean.

- [ ] **Step 4: Build to confirm Tailwind picks up the new class strings**

```bash
cd client && npx vite build && cd ..
```

Expected: build succeeds. Tailwind v4 scans source files at build time, so a brand-new arbitrary class like `md:grid-cols-[28px_minmax(0,1fr)_72px_72px_104px_136px_72px]` must be present in source for the CSS to be emitted. `RECEIPT_ROW_GRID` lives as a string literal, which Tailwind's class extractor handles.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/AddFromReceiptModal.tsx
git commit -m "refactor(receipt-modal): promote row grid to <li>, share template at md+"
```

---

## Task 3: Item cell — truncate the Create button, polish the matched-row

**Files:**
- Modify: `client/src/components/AddFromReceiptModal.tsx`

**Why:** Task 2 left the Create button rendering as today (no truncation), so on long parsed names like "super blend greens" it'll still want to wrap. Now that the parent cell has a defined column width at `md+`, we can constrain the button itself. Same task tightens the matched-row so the badge + parsed-name combo behaves predictably under all column widths.

- [ ] **Step 1: Replace the Create button**

Inside `RowEditor`, find the `else` branch of the Item cell (the `<button>` rendering "Create '<name>'"). Replace it with:

```tsx
<button
  onClick={() => onPatch({ showCreateForm: !row.showCreateForm })}
  disabled={disabled}
  title={`Create "${row.parsedName}"`}
  className="flex items-center gap-1 max-w-full min-w-0 text-[12px] text-accent-ink hover:underline"
>
  <Plus size={12} className="shrink-0" />
  <span className="truncate">Create &ldquo;{row.parsedName}&rdquo;</span>
</button>
```

Changes:
- `inline-flex` → `flex` so it participates in the parent's grid sizing rather than shrinking to content (which is what lets the text overflow off the edge today).
- `max-w-full min-w-0` so the button never exceeds its grid cell.
- The `+` icon gets `shrink-0` so only the text truncates.
- The text moves into a child `<span>` with `truncate` so it overflows with an ellipsis instead of wrapping.
- A `title` attribute gives the full "Create '<name>'" affordance on hover.

- [ ] **Step 2: Typecheck**

```bash
cd client && npx tsc --noEmit && cd ..
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/AddFromReceiptModal.tsx
git commit -m "refactor(receipt-modal): truncate Create-button text instead of wrapping"
```

---

## Task 4: Add the sticky column header

**Files:**
- Modify: `client/src/components/AddFromReceiptModal.tsx`

**Why:** Without column labels, users have to infer what each input is by reading the values. With 26+ rows scrolling past, a sticky header keeps the orientation visible. Same shared grid template as the rows, so labels line up over their columns.

- [ ] **Step 1: Insert the sticky header above the rows list**

Inside `ReviewStage`, find the food-items block (line ~318–336). Currently:

```tsx
<div className="flex flex-col gap-2">
  <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">
    Food items ({committedFoodCount}/{foodRows.length} selected)
  </div>
  <ul className="flex flex-col gap-1.5">
    {foodRows.map((row) => (
      <RowEditor
        key={row.index}
        row={row}
        ingredients={ingredients}
        disabled={committing}
        onPatch={(patch) => updateRow(row.index, patch)}
      />
    ))}
    {foodRows.length === 0 && (
      <div className="text-[12px] text-ink-3 px-2 py-3">No food items detected.</div>
    )}
  </ul>
</div>
```

Replace with:

```tsx
<div className="flex flex-col gap-2">
  <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold">
    Food items ({committedFoodCount}/{foodRows.length} selected)
  </div>
  <div
    className={`hidden sticky top-0 z-10 bg-surface-1 border-b border-line-soft px-3 py-1.5 text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold ${RECEIPT_ROW_GRID}`}
  >
    <span aria-hidden />
    <span>Item</span>
    <span>Qty</span>
    <span>Unit</span>
    <span>Location</span>
    <span>Expires</span>
    <span className="text-right">Price</span>
  </div>
  <ul className="flex flex-col gap-1.5">
    {foodRows.map((row) => (
      <RowEditor
        key={row.index}
        row={row}
        ingredients={ingredients}
        disabled={committing}
        onPatch={(patch) => updateRow(row.index, patch)}
      />
    ))}
    {foodRows.length === 0 && (
      <div className="text-[12px] text-ink-3 px-2 py-3">No food items detected.</div>
    )}
  </ul>
</div>
```

Notes:
- `hidden` keeps the header element off the page below `md`. Because `RECEIPT_ROW_GRID` includes `md:grid`, that breakpoint flips it back on as a grid. Below `md` we already have today's `Food items (N/M selected)` strapline doing the orientation work, so no duplicate label is needed.
- `sticky top-0` works because the parent scroll container is the existing `flex-1 overflow-y-auto` wrapper around `ReviewStage`'s body. The Store/Trip/Total tiles and the strapline scroll away; only this row pins.
- `bg-surface-1` matches the modal's surface color so rows scrolling under it are fully occluded — no faint bleed-through.
- The first cell (`<span aria-hidden />`) is the placeholder over the checkbox column. It reserves the 28px slot without rendering visible text or being announced by screen readers.
- `px-3` matches the `<li>`'s `px-3` so the column edges line up over the row content; `py-1.5` is small enough to feel header-y rather than row-y.

- [ ] **Step 2: Typecheck**

```bash
cd client && npx tsc --noEmit && cd ..
```

Expected: clean.

- [ ] **Step 3: Build (confirms Tailwind emits the new sticky/hidden class combination cleanly)**

```bash
cd client && npx vite build && cd ..
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/AddFromReceiptModal.tsx
git commit -m "feat(receipt-modal): sticky column header on the review table"
```

---

## Task 5: Display `count` units as `ea`

**Files:**
- Modify: `client/src/components/AddFromReceiptModal.tsx`

**Why:** "count count count count" running down a column is visual noise when the parser is just saying "single units, no measurement." `ea` is the conventional grocer abbreviation and reads cleaner. Storage is unchanged — this is a presentation-only normalization.

- [ ] **Step 1: Add a tiny display helper next to the unit input**

Inside `RowEditor`, find the unit `<input>` (the one with `value={row.unit}`). Currently:

```tsx
<input
  type="text"
  value={row.unit}
  disabled={disabled || !row.isCommitted}
  onChange={(e) => onPatch({ unit: e.target.value })}
  className="h-8 w-full md:w-auto rounded-[8px] border border-line bg-surface-1 px-2 text-[12.5px] text-ink-1 focus:outline-none focus:border-accent disabled:opacity-50"
/>
```

Replace with:

```tsx
<input
  type="text"
  value={row.unit === "count" ? "ea" : row.unit}
  disabled={disabled || !row.isCommitted}
  onChange={(e) => onPatch({ unit: e.target.value })}
  className="h-8 w-full md:w-auto rounded-[8px] border border-line bg-surface-1 px-2 text-[12.5px] text-ink-1 focus:outline-none focus:border-accent disabled:opacity-50"
/>
```

The user's literal input is written back unchanged. Only the display value gets the `count → ea` normalization. If the user edits the field, whatever they type is what gets stored.

- [ ] **Step 2: Typecheck**

```bash
cd client && npx tsc --noEmit && cd ..
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/AddFromReceiptModal.tsx
git commit -m "refactor(receipt-modal): display 'count' units as 'ea'"
```

---

## Task 6: Manual verification across breakpoints

**Files:** none modified.

**Why:** TypeScript is happy and the build emits — but layout regressions only show in pixels. Eyes on the modal at three widths before opening the PR.

The dev server runs on the WSL host (`100.114.226.44` per `memory/dev_server.md`) since the local Windows box has no `.env`. SSH in, start the server, port-forward 5173 (Vite default) and 3000 (Express), and open the page in a real browser.

- [ ] **Step 1: Push the branch up so the WSL box can pull it**

```bash
git push -u origin feature/receipt-review-layout
```

- [ ] **Step 2: From WSL, pull the branch and start the dev servers**

```bash
ssh -p 2222 swizz@100.114.226.44
cd ~/projects/AgenticMealPlanner
git fetch origin
git switch feature/receipt-review-layout
cd client && npm install && cd ..
cd server && npm install && npx prisma generate && cd ..
# From the repo root, in two terminals (or with a process manager):
cd server && npm run dev   # Express on :3000
cd client && npm run dev   # Vite on :5173
```

If you have a Tailscale-routed dev URL set up, hit it directly. Otherwise port-forward 5173 over the SSH session and visit `http://localhost:5173`.

- [ ] **Step 3: Open the receipt review modal**

Navigate to Pantry → click **Add from receipt** → either drop a sample image or paste a real Walmart/Instacart order summary. You want to land in the review stage with ≥10 items, including at least one needs-create row (long name preferred — "super blend greens" is the canonical bad case) and at least one low-confidence match.

- [ ] **Step 4: Desktop (≥1000px viewport) checks**

Resize the browser to 1280px wide. Confirm:
- Modal is 1000px wide, centered.
- Sticky column header reads `Item · Qty · Unit · Location · Expires · Price` and stays pinned as you scroll the rows.
- All rows have visually identical column widths — no drift.
- The Item column is wide enough that parsed names like "lime, large fresh" are not truncated.
- The "Create '<name>'" row sits on a single line with text ellipsis when the name is long; hovering reveals the full title.
- Unit column reads `ea` for items the parser tagged as `count`.
- Toggling a row's checkbox dims the row but the badge color stays full-saturation.
- Clicking "Create '<name>'" expands the Name/Category mini-form below the same row, spanning all 7 columns, visually attached.

- [ ] **Step 5: Tablet portrait (≈768px viewport) checks**

Resize to 768px wide. Confirm:
- Modal width follows viewport (~768px). Table layout still active.
- Item column is tighter (~196px) but parsed names truncate gracefully with ellipsis instead of pushing other columns out of place.
- Sticky header still pins.

- [ ] **Step 6: Mobile (≤640px viewport) checks**

Resize to 414px (iPhone Pro size) and 375px (smaller iPhone). Confirm:
- Modal fills the viewport.
- Sticky column header is hidden — only the existing `Food items (N/M selected)` strapline shows.
- Each row uses the previous mobile auto-flow layout (☐/Item/Qty/Unit on one row, Loc/Date/Price on the next) — same as before this work.
- "Create '<name>'" row still works (no truncation needed at this width — text fits).
- The create-form expansion spans the full row width.

- [ ] **Step 7: Open the PR**

```bash
gh pr create --title "feat(receipt-modal): columnar review table at md+" --body "$(cat <<'EOF'
## Summary
- Widens the receipt-review modal to 1000px at `md+` and rebuilds the rows around a single shared CSS grid template, so columns actually line up
- Adds a sticky column header (`Item · Qty · Unit · Location · Expires · Price`) at `md+`
- Truncates the long-named "Create '<name>'" affordance instead of wrapping to four lines
- Displays `count` units as `ea`
- Mobile (`< md`) layout is unchanged

## Test plan
- [x] Typecheck (`npx tsc --noEmit`) clean
- [x] Build (`npx vite build`) clean
- [ ] Desktop (≥1000px): columns align across all rows, sticky header pins, parsed names not truncated, Create button truncates with ellipsis
- [ ] Tablet portrait (~768px): table active, rows degrade gracefully under the tighter Item column
- [ ] Mobile (~375–640px): unchanged from before this branch

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.

---

## Self-review notes (for the implementer)

- The grid template lives as one constant string (`RECEIPT_ROW_GRID`). If a future task adds or removes a column, you change *one* place and both the header and the rows update together. Don't inline the template back into the JSX "for clarity" — drift between the header and the rows is exactly what this constant prevents.
- `min-w-0` on the matched-row's flex container is non-obvious but load-bearing: Tailwind's `truncate` only triggers when the truncated element's parent is constrained. Without `min-w-0`, the parent flex item defaults to `min-content` and the parsed-name span grows past the cell. If you remove this and notice text leaking out of the Item column, that's why.
- The `<li>` carrying both mobile (`grid-cols-[auto_1fr_auto_auto]`) and desktop (`md:grid-cols-[...]`) templates relies on Tailwind's source order: the `md:` prefix wins at `md+` widths because it has higher specificity inside Tailwind's emitted CSS, not because of class-list order. Don't add a `lg:` override unless you actually want a third breakpoint.
- The sticky header uses `hidden md:grid` — `hidden` is a `display: none` class that the `md:grid` override beats. If the header shows on mobile after your edit, you've likely lost the `hidden` class.
