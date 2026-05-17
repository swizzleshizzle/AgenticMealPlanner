# Custom Shopping List Items — Design

**Date:** 2026-05-17
**Status:** Draft

## Problem

The shopping list is generated entirely from the week's planned meals minus pantry on-hand. Anything not tied to a recipe ingredient — toilet paper, paper towels, soap, batteries, ad-hoc groceries — has no place to live. Users have to keep a parallel list elsewhere, which defeats the purpose of having a single shopping surface for the week.

The shopping list never feeds the pantry in this app (pantry is populated via the receipt-parser workflow). So custom items can be a pure "things to remember" overlay, independent of the ingredient/pantry graph.

## Goals

- Add free-text items (name + optional quantity text) to the current week's shopping list.
- Custom items survive `Regenerate` — the critical user-trust property.
- Custom items appear in the same view as generated items so the user sees one unified list.
- Past weeks remain strictly read-only.

## Non-Goals

- Agent MCP tool to add custom items via chat (worth doing later, separate spec).
- Rolling unchecked items into next week.
- Inline edit of name/qty after creation (delete + re-add is fine for MVP).
- Categorization or sorting of custom items beyond `createdAt asc`.
- Auto-marking custom items "bought" from receipt parsing.
- Custom items in no-plan weeks (custom items hang off a `planId`).

## Data Model

New Prisma model `CustomShoppingItem`:

```prisma
model CustomShoppingItem {
  id         Int        @id @default(autoincrement())
  planId     Int        @map("plan_id")
  name       String
  qtyText    String?    @map("qty_text")
  checked    Boolean    @default(false)
  createdAt  DateTime   @default(now()) @map("created_at")

  plan       WeeklyPlan @relation(fields: [planId], references: [id], onDelete: Cascade)

  @@index([planId])
  @@map("custom_shopping_items")
}
```

Back-reference on `WeeklyPlan`:
```prisma
customShoppingItems CustomShoppingItem[]
```

### Invariants

- One row per (plan, user-typed entry). No uniqueness on name — duplicates are allowed; we don't second-guess.
- `name` is required, trimmed; length 1–200 after trim.
- `qtyText` is optional free text; length 0–50. No parsing — `"2 rolls"`, `"a bag"`, `""` are all valid.
- Cascade-delete with the plan.
- **Untouched by `generateShoppingList`.** The existing `prisma.shoppingItem.deleteMany` in `shoppingService.generateShoppingList` is not modified, so custom items are never wiped on regenerate.

### Why a separate table

Considered and rejected: extending `ShoppingItem` with a nullable `ingredientId`. Reasons to keep them separate:
- Every consumer (agent tools, `aggregateShoppingItems`, frontend) would have to handle polymorphic rows.
- The `@@unique([planId, ingredientId])` constraint and the `deleteMany`-on-regenerate flow would both need conditional logic.
- The "custom items never meet the pantry" boundary is cleaner in the schema than in code.

## API Surface

New routes on the existing `/shopping` router:

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/shopping/:planId/custom` | — | `CustomShoppingItem[]` ordered by `createdAt asc` |
| `POST` | `/shopping/:planId/custom` | `{ name, qtyText? }` | created row (201) |
| `PUT` | `/shopping/custom/:id` | `{ checked? , name?, qtyText? }` | updated row |
| `DELETE` | `/shopping/custom/:id` | — | `204 No Content` |

Service-layer functions in `shoppingService.ts`:
- `listCustomShoppingItems(planId)`
- `createCustomShoppingItem(planId, { name, qtyText? })`
- `updateCustomShoppingItem(id, { checked?, name?, qtyText? })`
- `deleteCustomShoppingItem(id)`

### Validation

- `name` is trimmed; empty after trim → 400.
- `name.length > 200` or `qtyText.length > 50` → 400.
- `checked` must be a boolean if present.
- No auth (single-user app, consistent with rest of `shopping.ts`).

### Why not extend `GET /shopping/:planId`

Keeping the generated and custom endpoints separate mirrors the data-model split and avoids coupling two independently-evolving concerns. The client makes both calls and merges.

## Frontend

### API client (`client/src/api/shopping.ts`)

Add types and four functions:

```ts
export interface CustomShoppingItem {
  id: number;
  planId: number;
  name: string;
  qtyText: string | null;
  checked: boolean;
  createdAt: string;
}

export const getCustomShoppingItems = (planId: number) => ...
export const createCustomShoppingItem = (planId: number, input: { name: string; qtyText?: string }) => ...
export const updateCustomShoppingItem = (id: number, patch: { checked?: boolean; name?: string; qtyText?: string }) => ...
export const deleteCustomShoppingItem = (id: number) => ...
```

### `ShoppingList.tsx` changes

- Fetch custom items alongside generated items: a second `useEffect` keyed on `viewedPlan?.id` calls `getCustomShoppingItems`.
- New state: `customItems: CustomShoppingItem[]`.
- The header chip count (`· N to buy`) sums unchecked generated to-buy items + unchecked custom items.
- New "Extras" sub-section rendered inside the existing "To buy" card, after the category groups. A new `CustomRow` component (sibling to `Row`, sharing the same Tailwind classes for visual parity) renders:
  - Checkbox (toggles via `updateCustomShoppingItem`).
  - Name + qty text.
  - Small × delete button visible on hover/tap (calls `deleteCustomShoppingItem`).
- Inline add row at the bottom of the Extras section:
  - Two text inputs (`Name`, `Qty`) plus a + button.
  - Enter in the Name field commits.
  - Empty name after trim → no-op (don't show an error, just nothing).
- Checked custom items appear in the existing "Done" section alongside checked generated items. Done is rendered by mapping over both arrays — `Row` for `ShoppingItem`, `CustomRow` (strikethrough variant, no × button) for `CustomShoppingItem` — so visually the two shapes interleave cleanly with no custom-vs-generated distinction.
- Past-week behavior: the existing `isPastWeek` gate hides the add row, hides × buttons, and disables checkbox toggles for custom items — same rules as generated items.

### No-list case

When a plan exists but `items.length === 0`, today the page renders `NoListCard` instead of any sections. Change: still render the "Extras" sub-section (so the user can add custom items before generating). `NoListCard` shrinks to a smaller nudge above Extras instead of replacing the whole list.

### Optimistic updates

Match the existing `toggleItem` pattern: update local state first, await the request, on rejection roll back state and log to console (no toast — current code doesn't use them).

## Error Handling

- Server errors bubble through the existing `apiFetch` wrapper.
- Client-side: on add/toggle/delete rejection, revert optimistic state. Don't surface a toast; the next interaction will re-fetch.
- Length-cap and empty-name validation is enforced on both client (disable + button when invalid) and server (400 on submit).

## Testing

### Server (Vitest, `server/src/__tests__/shoppingService.test.ts` extended)

- Create custom item — happy path, fields persist correctly.
- Empty/whitespace-only `name` → 400.
- Length caps (`name > 200`, `qtyText > 50`) → 400.
- **Regenerate preserves custom items** — set up a plan with both generated and custom items, call `generateShoppingList`, assert custom items still present. This is the load-bearing invariant.
- Cascade delete: deleting a `WeeklyPlan` deletes its `CustomShoppingItem`s.
- Toggle `checked` via PUT.
- Update `name` / `qtyText` via PUT.
- DELETE removes the row.

### Client

No new unit tests (matches the project's current testing style for `ShoppingList.tsx`).

### Manual smoke test

- Add "toilet paper" + "2 rolls" → appears in Extras.
- Hit Regenerate → custom item still there, generated items refreshed.
- Check custom item → moves to Done with strikethrough.
- Uncheck custom item → moves back to Extras.
- Delete custom item → gone from list.
- Navigate to last week → no add row, no × buttons, no toggling.
- Navigate to a future week with no plan → NoPlanCard, no Extras (consistent with non-goal).
- Navigate to a future week with a plan but no generated list → Extras is rendered, NoListCard appears above it as a nudge.

## Migration

Standard Prisma migration: `npx prisma migrate dev --name add_custom_shopping_items`. No data backfill needed (new table).

## Open Questions

None. Custom items in no-plan weeks is a deliberate future-work item, not an open question.
