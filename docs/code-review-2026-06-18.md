# Whole-App Code Review — Agentic Meal Planner

**Date:** 2026-06-18
**Branch reviewed:** `master` @ `409d3db`
**Method:** Five parallel reviewers covering (1) the AI/agent layer, (2) REST routes & services, (3) the data layer & jobs, (4) the React client, and (5) cross-cutting concerns (build/config/tests/docs/deps). Findings deduplicated across reviewers and ordered by impact.

## Summary

The app is **well-architected** — clean separation of pure logic from I/O, honest docs, a strong test-DB safety guard, and genuinely good unit-conversion / pantry-deduction / recipe-versioning logic. The items below are where it's weakest.

### Verified SDK facts (corrects two uncertain reviewer claims)

The app uses **`@anthropic-ai/claude-agent-sdk` `query()`** (v0.2.140), *not* the Messages API. Therefore:

- **Prompt caching:** the "add `cache_control`" suggestion **does not apply** — this SDK does caching internally and exposes no breakpoints. The real cost lever is bounding the replayed history.
- **Abort:** genuinely fixable — `query()` exposes interrupt/abort, so the SSE-disconnect and one-shot timeout leaks are valid and actionable.
- **Model pinning:** valid — neither call sets `model`. Correct current IDs: `claude-opus-4-8` (agent / OCR), `claude-haiku-4-5` (cheap rescue passes).

---

## 🔴 CRITICAL — fix first

### C1. Migration dropped nearly every foreign-key index and never restored them
`server/prisma/migrations/20260508215536_pantry_overhaul/migration.sql:34-77`
The migration drops ~14 indexes (FKs on `planned_meals` (`plan_id`, `meal_id`), `shopping_items` (`ingredient_id`), `meal_ingredients` (`ingredient_id`), `receipt_items` (`receipt_id`, `ingredient_id`), plus the composite `planned_meals(plan_id, day, meal_slot)` lookup) and recreates only two pantry indexes. `schema.prisma` confirms the rest were never re-added. Every FK join and cascade delete is now a sequential scan.
**Fix:** re-add the `@@index` declarations in `schema.prisma` for every FK column lacking one, plus the composite lookup index, and generate a new migration. *Highest value-to-effort item in the review.*

### C2. Shopping-list aggregation ignores units entirely
`server/src/services/shoppingService.ts:38-62` (pantry pull at `:135`)
Sums recipe-unit quantities and subtracts raw pantry-batch quantities keyed only by `ingredientId`, with **no `convert()`**. "2 cups flour" against a "1 kg" batch computes `2 − 1000 = buy 0`; "1 lb" + "200 g" sum to `201`. This is the core shopping math and it is unit-blind.
**Fix:** convert every meal-ingredient quantity and every pantry-batch quantity to the ingredient's default unit before aggregating, mirroring `pantryAggregation.aggregateCards`; track a `partial`/unconvertible flag rather than silently mis-summing.

### C3. Path traversal via uploaded filename
`server/src/middleware/upload.ts:11` (also `:33`, `:45`)
`filename` = `${Date.now()}-${file.originalname}` with `originalname` verbatim; multer does not sanitize, so a crafted name (`../../...`) escapes `uploadDir` on the initial write.
**Fix:** derive the stored name from a random token + a server-validated extension only, e.g. `` `${Date.now()}-${randomUUID()}${path.extname(file.originalname).toLowerCase()}` ``.

### C4. Destructive agent tools have no code-level confirmation gate
`server/src/agent/runner.ts:133-134`
The agent runs with `permissionMode: "bypassPermissions"` + `allowDangerouslySkipPermissions: true`, disabling every SDK guardrail. The "destructive actions are confirmed" contract is enforced **only by a sentence in the system prompt** (`prompt.ts:22`). `delete_pantry_batch` (irreversible `prisma.delete`), `remove_planned_meal`, `archive_meal`, `generate_full_week` execute the instant the model calls them — a prompt injection or misread "yes" mutates with no code-level gate.
**Fix:** gate the irreversible tools behind a server-validated `confirmed: true` arg, or use the SDK's permission callback to intercept the destructive tool names. At minimum, gate `hardDeleteBatch`.

---

## 🟠 HIGH

### Recurring across reviewers (strongest signals)

#### H1. ~10 separate `new PrismaClient()` instances
`pantryBatchService.ts:3`, `shoppingService.ts:5`, `plannerService.ts:3`, `pantryService.ts:5`, `receiptService.ts:9`, `mealService.ts:8`, routes `plans.ts:9`, `ingredients.ts:5`, `meals.ts:9`, `calendar.ts:7`, and `jobs/purgeConsumedBatches.ts:3`
A shared singleton exists at `lib/prisma.ts` but is used by only one file (`ingredientResolve.ts`). Every other module opens its own connection pool → exhausts Postgres `max_connections` under load and defeats hot-reload caching in dev.
**Fix:** import `prisma` from `lib/prisma.js` everywhere; delete the local instantiations.

#### H2. No global Express error handler; routes leak stack traces
`server/src/index.ts` (no terminal `app.use((err, req, res, next) => …)` registered)
Routes rethrow on unexpected errors (`ingredients.ts:42/72/86`, `pantry.ts:54`, `shopping.ts:36/56/69`) or have no try/catch at all (`plans.ts`, most of `meals.ts`, `calendar.ts`). In Express 5 a rejected async handler hits the default error handler, which responds 500 **with the stack trace** when `NODE_ENV !== 'production'`, and produces inconsistent error shapes.
**Fix:** add a terminal error-handling middleware that logs, returns a sanitized `{ error }` JSON body with an appropriate status, and maps `PrismaClientKnownRequestError` codes (P2025/P2002) centrally.

#### H3. No input validation despite Zod in the stack
`plans.ts:26-37`, `meals.ts:32-52`, `ingredients.ts:31-44/75-79`; numeric params at `shopping.ts:8/19/24/41/61/74/79`, `plans.ts:17/31`
Write routes spread `req.body` straight into Prisma (`data as any`); `Number(req.params.id)` on a non-numeric segment yields `NaN`, passed into `where: { … : NaN }` → Prisma 500 instead of 400 (and `generateShoppingList(NaN)` runs a `deleteMany` first).
**Fix:** per-route Zod schemas (validate `weekStartDate`, `mealId`, `servings`, enums) + a shared `parseId` helper (`coerce.number().int().positive()`). `media.ts:16-17` is the correct template.

### Other HIGH

#### H4. Duplicate-ingredient casing bug
`server/src/services/ingredientResolve.ts:45-53`
`Ingredient.name` is `@unique`; every other writer lowercases, but this upsert uses the raw casing for both `where` and `create`. Importing "Olive Oil" when "olive oil" exists creates a second row — intermittent, silently fragments the catalog.
**Fix:** lowercase before the upsert (the alias-lookup path already does).

#### H5. Calendar sync off-by-one (timezone)
`server/src/routes/calendar.ts:32-39`
`mealDate.setDate(getDate()+offset)` mutates in local time, then `toISOString().split("T")[0]` reads the **UTC** date; west of UTC every synced event lands a day early. `createMealEvent` then re-parses local — a second TZ round-trip.
**Fix:** format with local getters, or anchor the whole computation in UTC. `receiptService.ts:104` (`weeklyWindow`) documents the correct pattern.

#### H6. Agent query not aborted on disconnect; one-shot timeout leaks
`runner.ts` / `chat.ts:60-77`; `sdkClient.ts:77-84`
On client disconnect the SSE loop `break`s but the `query()` generator keeps running to completion (and any in-flight DB mutations with it). The `Promise.race` timeout in `sdkClient` rejects but never cancels the underlying query.
**Fix:** wire `query()`'s abort/interrupt into `res.on("close")` and into the timeout branch.

#### H7. No env validation / no graceful shutdown; dotenv only loaded in tests
`server/src/index.ts:1-17,43-57`; `server/vitest.config.ts:2`
The prod entrypoint never imports `dotenv` and never checks `DATABASE_URL` — it boots, answers `/health` "ok", then 500s on first query. No SIGTERM/SIGINT handlers, no `server.close()`, no `prisma.$disconnect()`.
**Fix:** `import "dotenv/config"` at the top of `index.ts`; fail-fast on required env (`process.exit(1)`); register shutdown handlers that drain connections and disconnect Prisma.

#### H8. No CI, and the server build ships the test suite
`server/tsconfig.json` (no `exclude`); no `.github/workflows/`
`tsc` emits `src/__tests__/**` into `dist/` and couples a clean build to devDependencies. README tells contributors to run tests, but nothing enforces it.
**Fix:** add `"exclude": ["src/**/*.test.ts", "src/__tests__/**"]`; add a GitHub Actions workflow (`npm ci`, server build, both test suites against a Postgres service).

#### H9. Client accessibility gaps on central, recently-churned widgets
`IngredientCombobox.tsx:57-110`; modals `CookConfirmModal.tsx:190`, `AddFromReceiptModal.tsx:63`, planner modals
The combobox is a plain `div` of buttons — no `role="combobox/listbox/option"`, no `aria-expanded/activedescendant`, no Arrow/Enter keyboard nav (only Escape + click). Modals set `role`/`aria-modal` inconsistently and none trap Tab focus or restore focus to the trigger on close.
**Fix:** roving `aria-activedescendant` + ArrowUp/Down/Enter on the combobox; a shared focus-trap + `role="dialog" aria-modal` on all dialogs.

---

## 🟡 MEDIUM

- **Dev port mismatch.** Server defaults to `3001`; Vite proxies to `3100` (`vite.config.ts:11`). Documented, but align them so the default dev setup works without manual `.env` editing.
- **Pin the model.** `runner.ts`/`sdkClient.ts` set no `model` → silent behavior/cost drift across SDK upgrades. Use `claude-opus-4-8` (agent/OCR), `claude-haiku-4-5` (rescue pass).
- **Parsers `JSON.parse … as T` with no schema validation.** `receiptParser.ts:117`, `recipeParser.ts:82`, `mealPlanner.ts:79` — a malformed model response propagates into the DB. Add Zod `.parse()` (agent *tools* already validate; parsers should too).
- **Unbounded chat history** replayed as a flattened `Human:/Assistant:` transcript each turn (`runner.ts:111-116`) — grows token cost quadratically; mildly spoofable. This (not `cache_control`) is the real cost lever.
- **`extractJson` greedy-brace fallback** (`recipeParser.ts:99`, `receiptParser.ts:95-98`) can grab prose/second JSON block. Prefer the fenced match; brace-balance the fallback. Low-risk once C/Medium Zod validation lands.
- **Purge job** (`jobs/purgeConsumedBatches.ts`, `index.ts:49`): own PrismaClient (H1), no timezone pinned on the cron, no overlap guard, and **hard-deletes cost/purchase history** with no archive. Confirm consumed-batch cost data is disposable; otherwise summarize before deleting.
- **`selectBatchesToDrain` clamp + per-batch convert.** `pantryService.ts:108-122` can write a tiny negative `newQuantity` (no `Math.max(0, …)` clamp at `:119`); an unconvertible *later* batch aborts the whole line (`:226`) instead of being skipped, discarding drainable stock.
- **Receipt commit does file I/O inside the Prisma transaction** (`receiptService.ts:156-178`) — holds row locks during a multi-MB copy. `mealService.supersedeMeal:337` does it correctly (copy outside the txn).
- **Client unmount-safety.** `useApi.ts:9-22` and most page fetches `setState` after `await` with no `AbortController`; `ShoppingList` week-arrow clicks can land a stale week's items over a newer one. Standardize on an abortable fetch + `if (!signal.aborted)` guard.
- **`usePersistentState` writes on every change** (`usePersistentState.ts:19-21`) — for chat, re-serializes the whole growing message array on every SSE token. Debounce, or persist chat only on stream completion.
- **Fuse index rebuilt per keystroke** (`ingredientSearch.ts:13`, `IngredientCombobox.tsx:42-45`) — memoize the `Fuse` instance per `ingredients` array; `.search` per keystroke.
- **`is_default` allows multiple defaults per recipe family** (`schema.prisma:104`) — add a partial unique index (`CREATE UNIQUE INDEX ON meals (recipe_id) WHERE is_default AND archived_at IS NULL`).
- **`pdfExtraction` temp-file collision** (`pdfExtraction.ts:94/136`) — prefixes use `Date.now()` only; append `randomUUID()`.
- **`getRecentReceipts` limit** (`receipts.ts:45`) accepts 0/negative/`NaN` (`take: NaN` → 500). Clamp: `Math.max(1, Math.min(50, Number(limit) || 5))`.
- **Calendar OAuth callback** (`calendar.ts:19-23`) — `code` unvalidated; consent-denied redirect (`?error=…`) throws and leaks a stack (see H2). Validate `code`, wrap in try/catch.
- **No linter/formatter** (no ESLint/Prettier/pre-commit). Add with `lint`/`format` scripts wired into CI.
- **Dead dependency** `zod-to-json-schema` (`server/package.json:24`) — never imported. Remove.
- **No tests** for the LLM parsers, DB-backed service flows (`generateShoppingList`, `getPantryCards`, custom-item CRUD), `calendarService`, the SSE `/chat/stream` endpoint, or any React component (no `@testing-library/react`; client vitest uses `environment: "node"`). Pure logic is well-tested; the integration seams are not.

---

## 🟢 LOW (selected)

- Dead `tool_result` branch in `runner.ts:155-163` (never fires).
- `binaryResolver.ts:25-46` caches a transient probe failure permanently for the process.
- Tool args flow into Prisma with `where: any` (`pantry.ts:20`, `recipes.ts:19`) and unbounded free-text — drop `any`, add `.max(N)` to free-text Zod fields.
- `/tmp` hardcoded debug-dump path in an empty `catch {}` (`recipeParser.ts:74-79`) — use `os.tmpdir()`, log on failure.
- Wide-open CORS (`index.ts:19`) + `0.0.0.0` bind — acceptable under the LAN/tailnet threat model, but doesn't default to the safer posture SECURITY.md recommends.
- Duplicate FEFO comparator (`pantryAggregation.ts:50-61` vs `pantryService.ts:96-103`) — extract one shared comparator so preview and actual deduction can't drift.
- `restoreBatch` can resurrect a 0-quantity batch (`pantryBatchService.ts:116-151`).
- Pantry/shopping/recipe quantities stored as `Float` (`schema.prisma:162,176,233-235`) while money correctly uses `Decimal` — float summation accumulates drift.
- `receipt_item_id` is `ON DELETE SET NULL` (`schema.prisma:189`) — deleting a receipt silently orphans batch provenance; confirm intent.
- README/SECURITY refer to `/api/chat` as SSE, but the SSE endpoint is `/api/chat/stream` (`/api/chat` is JSON).
- Cross-workspace dep drift: `fuse.js` `^7.4.2` (client) vs `^7.3.0` (server); `vitest` `^3.0.0` vs `^3.1.1`. Hoist shared dev tooling to root.

---

## ⚡ Quick wins (small diffs, real value)

Re-add FK indexes (C1) · path-traversal fix (C3) · `tsconfig` exclude (H8) · Prisma singleton swap (H1) · `parseId` helper + global error handler (H2/H3) · align the dev port · pin the model · delete the dead dep · remove the stray junk file in the repo root (`CUsersmlgbrAppDataLocalTempencoded_patch.txt`).

## Suggested sequencing

1. The four **CRITICAL** items.
2. The recurring **HIGH** trio: Prisma singleton (H1), global error handler (H2), input validation (H3).
3. Add **CI** (H8) so the rest can't regress.
4. Tests for pantry / shopping / parsers.
5. Accessibility + client polish (H9 + Medium client items).

---

## What's solid (no action needed)

- `lib/units.ts` — clean canonical-base conversion with correct cross-family bridging, well-tested.
- Pantry deduction (`selectBatchesToDrain`) — FEFO, `use_first` tags, partial drains, shortfalls all unit-tested.
- `mark_meal_cooked` correctly uses an interactive transaction and guards double-cook.
- Agent tool dispatch (`registry.ts`) — proper Zod `safeParse` + try/catch, structured `{output, isError}`.
- Money columns use `Decimal(10,2)`; sensible composite unique constraints; data-backfilling migrations backfill before tightening.
- Test-DB safety guard (`vitest.config.ts` + `_env.test.ts`) — fails loudly if pointed at a non-test DB.
- Client SSE abort logic (`ChatPanel.tsx:59-112`) and optimistic custom-shopping-item CRUD with rollback are careful and correct.
- README/SECURITY.md are accurate to the code, including the documented port mismatch and the no-auth threat model.
