# Agentic Meal Planner — Design Spec

## Overview

A lightweight, self-hosted web app for managing meals, meal prepping, pantry tracking, grocery planning, and weekly meal scheduling — replacing Hello Fresh with a smarter, cheaper system. Two roommates use it behind Tailscale on a local Windows/WSL server.

## Problem

Hello Fresh is expensive. The meals are good but the per-meal cost doesn't justify it long-term. We've built up a collection of meals we like and want to cook them ourselves, with a mix of batch meal prep and fresh-cooked dinners throughout the week. We need a system that keeps us on track because we tend to be lazy and forget to plan.

## Tech Stack

- **Frontend:** React 18, Vite, Tailwind CSS, React Router
- **Backend:** Node.js, Express, Prisma ORM
- **Database:** Postgres (existing Docker container)
- **AI:** Claude CLI (`claude -p`) via child process
- **Calendar:** Google Calendar API (OAuth2)
- **Auth:** None — Tailscale provides network-level access control
- **Hosting:** WSL systemd service, Tailscale for remote access

## Data Model

### Meals
- `id`, `name`, `description`, `source` (hello_fresh, manual), `source_url`
- `meal_type` — `batch_prep` | `cook_fresh`
- `servings` (original yield), `prep_time`, `cook_time`
- `tags` (e.g., chicken, quick, vegetarian)
- `instructions` — ordered JSON steps
- `image_url`

### Meal Nutrition (columns on Meals table, per original serving)
- `calories`, `protein_g`, `carbs_g`, `fat_g`, `fiber_g`, `sodium_mg`

### Ingredients (normalized)
- `id`, `name`, `category` (produce, protein, dairy, pantry_staple, etc.)
- `default_unit` (oz, cups, count, etc.)

### Meal_Ingredients (join table)
- `meal_id`, `ingredient_id`, `quantity`, `unit`, `preparation` (diced, minced, etc.)
- Scaling = multiply `quantity` by a factor

### Pantry
- `ingredient_id`, `quantity`, `unit`, `location` (fridge, freezer, pantry), `expiration_date` (optional)

### Weekly_Plan
- `id`, `week_start_date`, `status` (draft, active, completed)

### Planned_Meals
- `plan_id`, `meal_id`, `day` (mon-sun), `meal_slot` (lunch, dinner)
- `servings` (how many portions — drives scaling)
- `is_prep` (boolean — cooked on prep day or fresh that day)
- `status` (planned, cooked, skipped, swapped)

### Shopping_List
- `plan_id`, `ingredient_id`, `quantity_needed`, `quantity_on_hand`, `quantity_to_buy`
- `checked` (boolean)

## Architecture

### Frontend (React + Vite + Tailwind)
SPA with pages: Dashboard, Recipe Library, Weekly Planner, Pantry, Shopping List, Chat. Talks to backend via REST API.

### Backend (Node.js + Express + Prisma)
- REST API for all CRUD operations
- File upload endpoint for PDFs and photos
- Claude CLI integration layer — shells out to `claude -p` with structured prompts, parses JSON responses
- Google Calendar integration via OAuth2
- All AI responses validated before writing to DB

### AI Layer (via `claude -p`)
- **Recipe Parser** — takes a PDF or image, returns structured recipe JSON (name, ingredients, steps, nutrition, tags)
- **Meal Planner** — given recipe library, preferences, pantry state, and history, generates a draft weekly plan
- **Chat Assistant** — natural language for swaps, questions, adjustments
- **Shopping List Generator** — diffs planned ingredients against pantry to produce buy list

### Database
Postgres running in Docker on the local server.

## User Flows

### Sunday Planning
1. Recurring Google Calendar event reminds you to plan the week
2. Open the app → "Plan This Week"
3. AI auto-generates a draft plan based on: recipe library, recent meal history, pantry state, balance of batch-prep vs cook-fresh
4. Hello Fresh-style card layout — swap meals, adjust servings, mark prep vs fresh
5. Confirm → shopping list auto-generates (needed minus on-hand) → meal events push to Google Calendar

### Recipe Import
1. Upload a PDF or photo of a Hello Fresh recipe card
2. Backend sends to Claude via `claude -p`
3. AI extracts: name, ingredients (quantities/units), steps, nutrition, tags, prep/cook time
4. Review parsed result, correct if needed, save to library

### During the Week
1. Dashboard shows today's meal, what to pull from the fridge, prep notes
2. Mark meal as "cooked" → pantry auto-deducts ingredients
3. Skip/swap via chat or UI → AI suggests alternatives, updates plan, adjusts shopping list
4. Manually adjust pantry as needed

### Chat Examples
- "Swap Wednesday dinner for something with chicken"
- "We're eating out Friday, skip that meal"
- "What can I make with what's left in the fridge?"
- "Scale Sunday's meal prep to 6 servings instead of 4"

## Calendar Integration
- OAuth2 — each roommate connects their Google account once
- Confirmed plan creates calendar events per meal (day + slot)
- Events include: meal name, prep notes, batch-prep vs cook-fresh
- Swaps/skips update or remove calendar events automatically
- Recurring "Plan Your Week" event as the Sunday reminder

## Project Structure

```
AgenticMealPlanner/
├── client/              # React + Vite frontend
│   ├── src/
│   │   ├── components/
│   │   ├── pages/       # Dashboard, Planner, Recipes, Pantry, Shopping, Chat
│   │   ├── hooks/
│   │   └── api/
├── server/              # Express backend
│   ├── src/
│   │   ├── routes/
│   │   ├── services/    # planner, parser, pantry, shopping, calendar
│   │   ├── claude/      # Claude CLI integration
│   │   └── prisma/
├── docs/
└── docker-compose.yml
```

## Future Enhancements

- **Grocery delivery integration** — connect to Instacart/Walmart to place orders directly from the shopping list
- **Pantry photo scanning** — take a photo of fridge/pantry shelves and have AI detect what's on hand
- **URL/web recipe import** — paste a URL from any recipe site and auto-parse it
- **Mobile-native app** — if responsive web isn't cutting it
