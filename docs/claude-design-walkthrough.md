# Claude Design Walkthrough — AgenticMealPlanner

A practical guide for redesigning the UI using Claude Design (Anthropic Labs, research preview). Prompts below are tailored to the current state of this repo: React 18 + Vite + TypeScript + Tailwind 4, eight pages, no centralized design tokens.

---

## 1. About Claude Design (quick orientation)

Claude Design lives inside claude.ai — it is **not** a separate app. Open claude.ai in the browser, sign in with a Pro, Max, Team, or Enterprise account, and click the **palette icon** in the left-hand navigation sidebar.

The UI has two panes:

- **Left: chat.** You describe what you want.
- **Right: canvas.** Claude renders the design live. You can click any element on the canvas to leave an inline comment, edit text directly, or use the per-element sliders Claude generates (spacing, color, radius, etc.) to nudge things in real time.

When a design is ready, click **"Hand off to Claude Code"** — Claude Design packages a handoff bundle (design spec + tokens + component notes) that Claude Code can turn into actual code against this repo.

Powered by Claude Opus 4.7 with vision, so you can also drop in reference screenshots (HelloFresh, Notion, Linear, Airtable, whatever inspires you).

---

## 2. Recommended workflow for this project

The order matters. Do not jump to page designs first — build the system, then apply it.

1. **Context kickoff** (one prompt). Prime Claude Design with what the app is, who it serves, the stack, and the constraints.
2. **Design system** (one prompt). Lock down tokens, type scale, radius, shadows, iconography, and base components (button, input, card, badge, tabs). Everything else inherits from this.
3. **Hero component: MealCard.** This shows up on every page. Nail it first — it sets the emotional tone.
4. **Page-by-page redesign**, highest-impact first: Dashboard → Planner → Recipes → RecipeDetail → Pantry → Shopping → Chat → RecipeImport.
5. **Layout / navigation pass.** Sidebar, top bar, responsive behavior.
6. **Handoff to Claude Code** with the bundle + instructions pointing at `client/src/`.

Each step below is a copy-paste prompt. Edit the bracketed `[like this]` spots.

---

## 3. Prompt 1 — Context kickoff

Paste this first, in a fresh Claude Design conversation:

> I'm redesigning a self-hosted meal-planning web app called **AgenticMealPlanner**. It replaces HelloFresh for two roommates. The goal is warm, appetizing, and calm — people use it on Sunday to plan their week and then glance at it on weeknights before cooking. It is not enterprise SaaS; it should feel like a well-loved recipe box, not a dashboard.
>
> **Tech constraints (do not break these):**
> - React 18 + Vite + TypeScript
> - Tailwind CSS v4 (utility classes only — no styled-components, no CSS-in-JS)
> - Lucide React for icons
> - Must be responsive down to ~375px wide; primary target is desktop 1440px
> - No component library (no MUI / shadcn); everything hand-built with Tailwind
>
> **Aesthetic direction:** warm neutrals with a confident accent. Think "farmers market meets Notion" — generous whitespace, soft shadows, rounded corners (12–16px), food photography front and center, pill-shaped tags, quiet typography. Avoid: corporate blue, heavy gradients, glassmorphism, neon.
>
> **Pages that exist:** Dashboard, Recipes (library), RecipeDetail, RecipeImport, Planner (weekly grid), Pantry, ShoppingList, Chat (AI assistant).
>
> **Core object:** a "Meal" — has a photo, name, tags (e.g. "Batch Prep", "Cook Fresh", "30 min", "High Protein"), prep/cook time, serving count, calories, and ingredient list.
>
> Before you design anything, ask me up to 5 clarifying questions about mood, color, or priorities.

Let it ask questions — answer them, then move on.

---

## 4. Prompt 2 — Design system

> Based on what we just discussed, generate a complete design system on the canvas. I need:
>
> 1. **Color tokens** as Tailwind v4 CSS custom properties (e.g. `--color-surface`, `--color-surface-muted`, `--color-ink`, `--color-ink-muted`, `--color-accent`, `--color-accent-hover`, `--color-success`, `--color-warning`, `--color-danger`, plus a "batch prep" and "cook fresh" semantic pair). Show each swatch with hex + token name. Include light and dark mode pairs.
> 2. **Type scale** — display, h1, h2, h3, body, small, caption. Specify font family (suggest one warm sans-serif + one optional display/serif for recipe titles), weights, sizes in rem, and line heights. Show a sample of each.
> 3. **Radius scale** — sm, md, lg, xl, pill. Show examples.
> 4. **Shadow scale** — xs, sm, md, lg. Soft, not punchy.
> 5. **Spacing rhythm** — confirm the 4px base scale and call out the 3–4 most common paddings/gaps I should reuse.
> 6. **Base components (rendered, not just described):** Button (primary, secondary, ghost, destructive, icon-only), Input, Select, Textarea, Checkbox, Tabs, Badge/Tag, Toast, empty state, loading skeleton. All states: default, hover, focus, disabled.
>
> Output the tokens in a form I can paste into `client/src/index.css` under `@theme`.

When you like the system, screenshot it and keep it handy — you'll paste it at the top of later prompts.

---

## 5. Prompt 3 — MealCard (the hero component)

MealCard shows on Dashboard, Recipes, Planner, and in chat responses. Get it right and everything else gets easier.

> Using the design system we established, design the **MealCard** component. Three variants, all rendered side by side on the canvas:
>
> 1. **Large** — recipe library grid card (~320px wide). Big image on top (16:9), name, two-line description, a row of tags (e.g. "Batch Prep", "High Protein", "30 min"), nutrition chip (calories, protein), and a "View recipe" affordance.
> 2. **Compact** — planner grid cell (~200px wide). Smaller image, name, prep time, meal-type badge. Must work when stacked 7 across in a weekly planner.
> 3. **Mini** — chat-response / dashboard "tonight's dinner" card. Horizontal layout, 80px image on the left, title + one-line summary + two tag chips on the right.
>
> Show hover states and a "checked / cooked" state (subtle overlay or check icon). Also render the empty/skeleton state for each variant.
>
> Deliverable: each variant as a production-ready Tailwind component with class names I can drop into `client/src/components/MealCard.tsx`.

---

## 6. Prompt 4 — Dashboard

> Redesign the **Dashboard page** for AgenticMealPlanner. This is what users see first when they open the app on a weekday evening.
>
> **Must include:**
> - A "Tonight's dinner" hero section using the Mini MealCard at XL size, with a "Mark as cooked" CTA and a subtle "Swap" secondary action.
> - A "This week at a glance" strip — 7 Compact MealCards in a horizontal row; today is visually emphasized; past days are slightly dimmed.
> - A "Pantry running low" widget — max 4 items with a "View pantry" link.
> - A "Nutrition this week" summary — small, calm, not a giant chart. Think 3–4 stat chips (avg calories/day, protein, veg servings, estimated cost vs HelloFresh).
> - Quick actions: "Plan next week", "Import a recipe", "Open shopping list".
>
> Canvas: render the full 1440px-wide desktop layout, then a 375px mobile version stacked below. No sidebar in this mockup — just the main content area.

---

## 7. Prompt 5 — Planner (weekly grid)

> Design the **Planner page**. This is the Sunday-afternoon workhorse — users generate a week, drag meals around, swap things, and confirm.
>
> **Layout:**
> - Top: week selector (prev / current / next), "Generate plan" button, "Confirm & sync to calendar" primary CTA.
> - Main: a 7-column grid (Mon–Sun). Each day column shows slots for breakfast / lunch / dinner (toggleable — default show dinner only). Each slot is a Compact MealCard, or an empty "+ add meal" placeholder.
> - Right sidebar (collapsible): "Suggestions" — 5 meals Claude recommends, draggable into slots.
>
> **Interactions to show on the canvas:**
> - Dragging a MealCard (ghost state + target slot highlight).
> - Hovering a slot to reveal "swap / remove" icon actions.
> - An "AI is generating..." loading state across the whole grid.
> - Empty state (no plan yet) with a friendly "Generate my first week" illustration.
>
> Responsive: on mobile, collapse to a vertical list of days instead of a grid.

---

## 8. Prompt 6 — Recipes library

> Design the **Recipes page** — a searchable library of saved meals.
>
> Include: a sticky top bar with search input + filter chips (All / Batch Prep / Cook Fresh / Under 30 min / High Protein / Vegetarian), a sort dropdown (Recently added / Most cooked / Alphabetical), and a responsive grid of Large MealCards (3 cols desktop, 2 tablet, 1 mobile). Show the filter chips in both active and inactive states.
>
> Also show: empty state ("No recipes yet — import one from a PDF or photo"), filtered-no-results state, and loading skeleton grid.

---

## 9. Prompt 7 — RecipeDetail

> Design the **RecipeDetail page** — the "I'm about to cook this" view.
>
> Left column (2/3 width desktop): hero image (16:9), title, description, tags, quick-stats row (prep time, cook time, servings, calories), ingredients list with checkboxes (so the cook can tick them as they prep), and numbered instruction steps with generous line height.
> Right column (1/3 width): a "sticky" card with servings adjuster (+/- buttons that scale ingredient amounts), "Add to next week's plan" CTA, and "Edit / Delete" overflow menu.
>
> Mobile: stack everything. The servings adjuster becomes a bottom-docked bar.

---

## 10. Prompt 8 — RecipeImport

> Design the **RecipeImport flow**. The user uploads a HelloFresh PDF or a photo of a recipe card; Claude parses it; the user reviews and saves.
>
> Three steps on the canvas, as distinct mockups:
> 1. **Upload** — large drag-and-drop zone with secondary "browse files" button; supported formats listed; multi-file support.
> 2. **Parsing** — progress indicator with reassuring copy ("Reading your recipe... pulling ingredients... estimating nutrition"). Animated shimmer on the placeholder recipe card.
> 3. **Review & save** — a side-by-side: the original PDF/photo preview on the left, a fully editable parsed form on the right (title, tags, ingredients with quantity+unit+name as separate fields, instructions as a reorderable list, nutrition, time). "Save to library" primary + "Discard" secondary.

---

## 11. Prompt 9 — Pantry

> Design the **Pantry page** — an inventory of what's in the kitchen.
>
> Layout: grouped by location (Fridge / Freezer / Dry goods / Spices), each group a collapsible section with a count badge. Each row shows item name, quantity + unit, expiration indicator (green / yellow / red dot), and row actions (edit, +/- quantity, delete).
> Top bar: search, "+ Add item" primary, and a "Scan receipt" secondary CTA (aspirational — render it but dim it with a "Coming soon" label).
> Empty state and "3 items expiring soon" warning banner.

---

## 12. Prompt 10 — ShoppingList

> Design the **ShoppingList page**. Auto-generated from the active plan minus pantry contents.
>
> Group items by grocery-store aisle (Produce / Protein / Dairy / Pantry / Frozen). Each row: checkbox, item name, quantity, and the meal(s) it's for shown as tiny tag(s). Checked items collapse to the bottom with strikethrough.
> Top: total item count, "X of Y collected" progress bar, "Print" and "Share" icon actions, "Regenerate list" secondary CTA.
> Mobile-first here — most people shop from their phone. Design the 375px version as the primary canvas, then show desktop.

---

## 13. Prompt 11 — Chat

> Design the **Chat page** — a natural-language assistant that can swap meals, adjust servings, answer "what can I make with what's in my fridge", etc.
>
> Message bubbles: user on the right (accent color), assistant on the left (surface-muted). Assistant messages can contain rich attachments: MealCards (Mini variant), inline action chips ("Swap this Wednesday ✓ Confirm / ✗ Cancel"), and small ingredient lists.
> Input area: sticky bottom composer with a plus menu (attach photo of pantry, attach recipe), multi-line text area, send button. Show a "thinking..." typing indicator and a subtle streaming-text state.
> Include suggested-prompt chips above the composer on an empty conversation ("Plan next week", "What's expiring soon?", "Swap Friday dinner").

---

## 14. Prompt 12 — Layout & navigation

> Design the **global app shell**: sidebar + main content area.
>
> Sidebar (desktop, 240px): app logo/name at top, nav items with Lucide icons (Dashboard, Recipes, Planner, Pantry, Shopping, Chat), active state treatment, a "This week" summary block at the bottom (dates + # meals planned), and a small user/settings row.
> Top bar (only on mobile, since desktop uses the sidebar): hamburger, page title, one contextual action.
> Mobile sidebar: slide-over drawer with the same nav items.
>
> Show the shell in both light and dark mode.

---

## 15. Prompt 13 — Handoff to Claude Code

Once the canvas looks right, hit **"Hand off to Claude Code"** and paste this as the handoff instruction:

> Apply this design system and these page designs to the existing React + Vite + Tailwind 4 codebase at `C:\Users\Michael Greene\Desktop\Projects\AgenticMealPlanner\client`.
>
> Concrete steps:
> 1. Write the color / radius / shadow / type tokens into `client/src/index.css` under a `@theme` block (Tailwind v4 syntax). Do not break existing class names — introduce the tokens alongside, then migrate.
> 2. Install `lucide-react` if not already installed.
> 3. Update components in this order, one PR-sized change at a time, so I can review each: `Layout.tsx`, `MealCard.tsx`, then pages in the order Dashboard → Planner → Recipes → RecipeDetail → Pantry → ShoppingList → Chat → RecipeImport.
> 4. For each component, keep the existing props and API shape. Only change the JSX + class names. Do not touch files under `client/src/api/` or `client/src/hooks/`.
> 5. After each component, run `npm run build` in `client/` to confirm it still compiles.
>
> Do not refactor the backend. Do not change routing. Do not add new dependencies beyond `lucide-react` without asking.

---

## 16. Tips that will save you time

Drop reference screenshots into the chat. HelloFresh, Notion, Linear, Airtable, Things 3 — visual references move the design faster than paragraphs of description.

Iterate on one variant, then clone. Get MealCard/Large perfect, then tell Claude Design "apply this same visual language to Compact and Mini."

Use inline comments on the canvas for surgical edits ("this badge is too loud", "tighten this spacing") rather than re-prompting the whole thing.

When something feels off but you can't articulate why, ask: "What three things would you change about this design if you had another pass?" Claude Design is good at self-critique.

Before the handoff, ask: "Export a token JSON and a Tailwind `@theme` block." You'll get clean, paste-ready config.

Keep a running "design decisions" note in this repo (e.g. `docs/design-decisions.md`) — accent color, radius scale, font choice — so future Claude Code sessions stay consistent with Claude Design's output.
