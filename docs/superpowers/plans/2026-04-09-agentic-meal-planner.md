# Agentic Meal Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted meal planning web app that replaces Hello Fresh — managing recipes, meal prep scheduling, pantry tracking, grocery lists, and Google Calendar integration with an AI assistant powered by Claude CLI.

**Architecture:** React/Vite SPA talks to an Express REST API backed by Postgres via Prisma. AI features (recipe parsing, meal plan generation, chat) shell out to `claude -p`. Google Calendar API handles meal event syncing. No auth — Tailscale provides access control.

**Tech Stack:** React 18, Vite, Tailwind CSS, React Router, Node.js, Express, Prisma, Postgres, Claude CLI (`claude -p`), Google Calendar API, Multer (file uploads), Zod (validation)

**Spec:** `docs/superpowers/specs/2026-04-09-agentic-meal-planner-design.md`

---

## File Structure

```
AgenticMealPlanner/
├── client/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css
│       ├── api/
│       │   ├── client.ts              # Fetch wrapper with base URL
│       │   ├── meals.ts               # Meal CRUD + import API calls
│       │   ├── ingredients.ts         # Ingredient API calls
│       │   ├── pantry.ts              # Pantry API calls
│       │   ├── plans.ts               # Weekly plan + planned meals API calls
│       │   ├── shopping.ts            # Shopping list API calls
│       │   ├── chat.ts                # Chat API calls
│       │   └── calendar.ts            # Calendar auth + sync API calls
│       ├── components/
│       │   ├── Layout.tsx             # App shell: sidebar nav + main content area
│       │   ├── MealCard.tsx           # Hello Fresh-style meal card (used in library + planner)
│       │   ├── MealForm.tsx           # Form for editing parsed/manual meal data
│       │   ├── PantryItemRow.tsx      # Single pantry item with qty, location, actions
│       │   ├── ShoppingItemRow.tsx    # Single shopping list item with checkbox
│       │   ├── PlanDayColumn.tsx      # One day column in the weekly planner grid
│       │   ├── ChatMessage.tsx        # Single chat message bubble
│       │   └── FileUpload.tsx         # Drag-and-drop file upload for PDFs/photos
│       ├── pages/
│       │   ├── Dashboard.tsx          # Today's meals, quick actions, nutrition summary
│       │   ├── Recipes.tsx            # Recipe library with search/filter + import button
│       │   ├── RecipeDetail.tsx       # Single recipe view with full details
│       │   ├── RecipeImport.tsx       # Upload PDF/photo, review parsed result, save
│       │   ├── Planner.tsx            # Weekly meal planner — drag/swap meals, confirm plan
│       │   ├── Pantry.tsx             # Pantry inventory with add/edit/remove
│       │   ├── ShoppingList.tsx       # Generated shopping list with checkboxes
│       │   └── Chat.tsx               # Chat interface for AI assistant
│       └── hooks/
│           └── useApi.ts              # Generic fetch hook with loading/error states
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                   # Express app entry point, middleware, route mounting
│       ├── routes/
│       │   ├── meals.ts               # GET/POST/PUT/DELETE /api/meals, POST /api/meals/import
│       │   ├── ingredients.ts         # GET/POST /api/ingredients
│       │   ├── pantry.ts              # GET/POST/PUT/DELETE /api/pantry
│       │   ├── plans.ts               # GET/POST/PUT /api/plans, nested planned-meals CRUD
│       │   ├── shopping.ts            # GET/POST /api/shopping (generate + retrieve)
│       │   ├── chat.ts                # POST /api/chat
│       │   └── calendar.ts            # GET /api/calendar/auth, POST /api/calendar/sync
│       ├── services/
│       │   ├── mealService.ts         # Meal CRUD logic, ingredient association
│       │   ├── pantryService.ts       # Pantry CRUD, auto-deduct on cook
│       │   ├── plannerService.ts      # Plan CRUD, planned meal management
│       │   ├── shoppingService.ts     # Diff planned ingredients vs pantry → buy list
│       │   ├── calendarService.ts     # Google Calendar OAuth2 + event CRUD
│       │   └── chatService.ts         # Orchestrates chat — routes intents to services
│       ├── claude/
│       │   ├── cli.ts                 # Shells out to `claude -p`, returns parsed JSON
│       │   ├── recipeParser.ts        # Prompt + validation for recipe PDF/image parsing
│       │   ├── mealPlanner.ts         # Prompt + validation for weekly plan generation
│       │   └── chatAgent.ts           # Prompt + validation for chat responses
│       ├── middleware/
│       │   ├── upload.ts              # Multer config for PDF/image uploads
│       │   └── validate.ts            # Zod validation middleware
│       └── prisma/
│           ├── schema.prisma          # Full database schema
│           └── seed.ts                # Optional seed data (sample ingredients)
├── docker-compose.yml                 # Postgres service config
├── package.json                       # Root workspace config
├── .gitignore
└── docs/
```

---

## Task 1: Project Scaffolding & Tooling

**Files:**
- Create: `package.json` (root workspace)
- Create: `.gitignore`
- Create: `docker-compose.yml`
- Create: `server/package.json`, `server/tsconfig.json`
- Create: `client/package.json`, `client/vite.config.ts`, `client/tsconfig.json`, `client/tailwind.config.js`, `client/postcss.config.js`, `client/index.html`

- [ ] **Step 1: Initialize git repo**

```bash
cd /c/Users/Michael\ Greene/Desktop/Projects/AgenticMealPlanner
git init
```

- [ ] **Step 2: Create root package.json with workspaces**

```json
{
  "name": "agentic-meal-planner",
  "private": true,
  "workspaces": ["client", "server"],
  "scripts": {
    "dev": "concurrently \"npm run dev:server\" \"npm run dev:client\"",
    "dev:server": "npm run dev --workspace=server",
    "dev:client": "npm run dev --workspace=client"
  },
  "devDependencies": {
    "concurrently": "^9.1.2"
  }
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
dist/
.env
*.log
.DS_Store
```

- [ ] **Step 4: Create docker-compose.yml**

This references the existing Postgres container. If the user already has Postgres running in Docker, they can skip this or adjust the port. This provides a standalone config for this project's DB.

```yaml
services:
  db:
    image: postgres:16
    container_name: mealplanner-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: mealplanner
      POSTGRES_PASSWORD: mealplanner
      POSTGRES_DB: mealplanner
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

Port 5433 on host to avoid conflicts with any existing Postgres on 5432.

- [ ] **Step 5: Scaffold server package**

```bash
mkdir -p server/src/{routes,services,claude,middleware,prisma}
```

`server/package.json`:
```json
{
  "name": "server",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "db:migrate": "prisma migrate dev",
    "db:push": "prisma db push",
    "db:seed": "tsx src/prisma/seed.ts",
    "test": "vitest"
  },
  "dependencies": {
    "@prisma/client": "^6.6.0",
    "cors": "^2.8.5",
    "express": "^5.1.0",
    "multer": "^2.0.1",
    "zod": "^3.24.4",
    "googleapis": "^148.0.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.2",
    "@types/multer": "^1.4.12",
    "prisma": "^6.6.0",
    "tsx": "^4.19.4",
    "typescript": "^5.8.3",
    "vitest": "^3.1.1"
  }
}
```

`server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Scaffold client package**

```bash
mkdir -p client/src/{api,components,pages,hooks}
```

Initialize with Vite + React + TypeScript:
```bash
cd client
npm create vite@latest . -- --template react-ts
```

Then add Tailwind:
```bash
npm install -D tailwindcss @tailwindcss/vite
```

`client/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
```

`client/src/index.css`:
```css
@import "tailwindcss";
```

- [ ] **Step 7: Install all dependencies**

```bash
cd /c/Users/Michael\ Greene/Desktop/Projects/AgenticMealPlanner
npm install
```

- [ ] **Step 8: Verify both dev servers start**

```bash
# Terminal 1 — start Postgres
docker compose up -d

# Terminal 2 — start dev
npm run dev
```

Verify: server starts on port 3001, client starts on port 5173.

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "chore: scaffold project with React/Vite client and Express server"
```

---

## Task 2: Database Schema & Prisma Setup

**Files:**
- Create: `server/src/prisma/schema.prisma`
- Create: `server/.env`

- [ ] **Step 1: Create .env for Prisma**

`server/.env`:
```
DATABASE_URL="postgresql://mealplanner:mealplanner@localhost:5433/mealplanner?schema=public"
```

- [ ] **Step 2: Write Prisma schema**

`server/src/prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum MealType {
  batch_prep
  cook_fresh
}

enum MealSource {
  hello_fresh
  manual
}

enum PantryLocation {
  fridge
  freezer
  pantry
}

enum PlanStatus {
  draft
  active
  completed
}

enum PlannedMealStatus {
  planned
  cooked
  skipped
  swapped
}

enum DayOfWeek {
  monday
  tuesday
  wednesday
  thursday
  friday
  saturday
  sunday
}

enum MealSlot {
  breakfast
  lunch
  dinner
}

enum IngredientCategory {
  produce
  protein
  dairy
  pantry_staple
  grain
  spice
  condiment
  frozen
  other
}

model Meal {
  id          Int       @id @default(autoincrement())
  name        String
  description String?
  source      MealSource @default(manual)
  sourceUrl   String?    @map("source_url")
  mealType    MealType   @map("meal_type")
  servings    Int        @default(2)
  prepTime    Int?       @map("prep_time")
  cookTime    Int?       @map("cook_time")
  tags        String[]   @default([])
  instructions Json      @default("[]")
  imageUrl    String?    @map("image_url")

  // Nutrition (per original serving)
  calories    Int?
  proteinG    Float?     @map("protein_g")
  carbsG      Float?     @map("carbs_g")
  fatG        Float?     @map("fat_g")
  fiberG      Float?     @map("fiber_g")
  sodiumMg    Float?     @map("sodium_mg")

  createdAt   DateTime   @default(now()) @map("created_at")
  updatedAt   DateTime   @updatedAt @map("updated_at")

  ingredients  MealIngredient[]
  plannedMeals PlannedMeal[]

  @@map("meals")
}

model Ingredient {
  id          Int                @id @default(autoincrement())
  name        String             @unique
  category    IngredientCategory @default(other)
  defaultUnit String             @default("count") @map("default_unit")

  mealIngredients MealIngredient[]
  pantryItems     PantryItem[]
  shoppingItems   ShoppingItem[]

  @@map("ingredients")
}

model MealIngredient {
  id           Int     @id @default(autoincrement())
  mealId       Int     @map("meal_id")
  ingredientId Int     @map("ingredient_id")
  quantity     Float
  unit         String
  preparation  String?

  meal       Meal       @relation(fields: [mealId], references: [id], onDelete: Cascade)
  ingredient Ingredient @relation(fields: [ingredientId], references: [id])

  @@unique([mealId, ingredientId])
  @@map("meal_ingredients")
}

model PantryItem {
  id             Int            @id @default(autoincrement())
  ingredientId   Int            @map("ingredient_id")
  quantity       Float
  unit           String
  location       PantryLocation @default(pantry)
  expirationDate DateTime?      @map("expiration_date")

  ingredient Ingredient @relation(fields: [ingredientId], references: [id])

  @@map("pantry_items")
}

model WeeklyPlan {
  id            Int        @id @default(autoincrement())
  weekStartDate DateTime   @map("week_start_date") @db.Date
  status        PlanStatus @default(draft)
  createdAt     DateTime   @default(now()) @map("created_at")
  updatedAt     DateTime   @updatedAt @map("updated_at")

  plannedMeals PlannedMeal[]
  shoppingItems ShoppingItem[]

  @@map("weekly_plans")
}

model PlannedMeal {
  id       Int               @id @default(autoincrement())
  planId   Int               @map("plan_id")
  mealId   Int               @map("meal_id")
  day      DayOfWeek
  mealSlot MealSlot          @map("meal_slot")
  servings Int               @default(2)
  isPrep   Boolean           @default(false) @map("is_prep")
  status   PlannedMealStatus @default(planned)

  calendarEventId String? @map("calendar_event_id")

  plan WeeklyPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  meal Meal       @relation(fields: [mealId], references: [id])

  @@map("planned_meals")
}

model ShoppingItem {
  id             Int     @id @default(autoincrement())
  planId         Int     @map("plan_id")
  ingredientId   Int     @map("ingredient_id")
  quantityNeeded Float   @map("quantity_needed")
  quantityOnHand Float   @map("quantity_on_hand") @default(0)
  quantityToBuy  Float   @map("quantity_to_buy")
  checked        Boolean @default(false)

  plan       WeeklyPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  ingredient Ingredient @relation(fields: [ingredientId], references: [id])

  @@unique([planId, ingredientId])
  @@map("shopping_items")
}
```

- [ ] **Step 3: Run initial migration**

```bash
cd server
npx prisma migrate dev --name init
```

Expected: Migration created, all tables generated.

- [ ] **Step 4: Verify database tables exist**

```bash
npx prisma studio
```

Open in browser, verify all tables are visible and empty.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add Prisma schema with all data models"
```

---

## Task 3: Express Server Setup & Health Check

**Files:**
- Create: `server/src/index.ts`
- Test: Manual curl test

- [ ] **Step 1: Write the Express server entry point**

`server/src/index.ts`:
```ts
import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
```

- [ ] **Step 2: Start server and verify health endpoint**

```bash
cd server && npm run dev
```

In another terminal:
```bash
curl http://localhost:3001/api/health
```

Expected: `{"status":"ok","timestamp":"..."}`

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: add Express server with health check endpoint"
```

---

## Task 4: Ingredient CRUD API

**Files:**
- Create: `server/src/routes/ingredients.ts`
- Test: `server/src/routes/ingredients.test.ts`

- [ ] **Step 1: Write failing tests for ingredient routes**

`server/src/routes/ingredients.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../index.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

beforeEach(async () => {
  await prisma.ingredient.deleteMany();
});

describe("GET /api/ingredients", () => {
  it("returns empty array when no ingredients exist", async () => {
    const res = await request(app).get("/api/ingredients");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns all ingredients", async () => {
    await prisma.ingredient.create({
      data: { name: "Chicken Breast", category: "protein", defaultUnit: "lb" },
    });
    const res = await request(app).get("/api/ingredients");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Chicken Breast");
  });
});

describe("POST /api/ingredients", () => {
  it("creates a new ingredient", async () => {
    const res = await request(app)
      .post("/api/ingredients")
      .send({ name: "Garlic", category: "produce", defaultUnit: "cloves" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Garlic");
    expect(res.body.category).toBe("produce");
  });

  it("rejects duplicate ingredient names", async () => {
    await prisma.ingredient.create({
      data: { name: "Salt", category: "spice", defaultUnit: "tsp" },
    });
    const res = await request(app)
      .post("/api/ingredients")
      .send({ name: "Salt", category: "spice", defaultUnit: "tsp" });
    expect(res.status).toBe(409);
  });
});
```

Add `supertest` to dev deps:
```bash
cd server && npm install -D supertest @types/supertest
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npx vitest run src/routes/ingredients.test.ts
```

Expected: FAIL — routes not defined yet.

- [ ] **Step 3: Implement ingredient routes**

`server/src/routes/ingredients.ts`:
```ts
import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

router.get("/", async (_req, res) => {
  const ingredients = await prisma.ingredient.findMany({
    orderBy: { name: "asc" },
  });
  res.json(ingredients);
});

router.post("/", async (req, res) => {
  const { name, category, defaultUnit } = req.body;
  try {
    const ingredient = await prisma.ingredient.create({
      data: { name, category, defaultUnit },
    });
    res.status(201).json(ingredient);
  } catch (err: any) {
    if (err.code === "P2002") {
      res.status(409).json({ error: "Ingredient already exists" });
      return;
    }
    throw err;
  }
});

export default router;
```

Mount in `server/src/index.ts` — add before `app.listen`:
```ts
import ingredientRoutes from "./routes/ingredients.js";
app.use("/api/ingredients", ingredientRoutes);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && npx vitest run src/routes/ingredients.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add ingredient CRUD API with tests"
```

---

## Task 5: Meal CRUD API

**Files:**
- Create: `server/src/services/mealService.ts`
- Create: `server/src/routes/meals.ts`
- Test: `server/src/routes/meals.test.ts`

- [ ] **Step 1: Write failing tests for meal routes**

`server/src/routes/meals.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../index.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

beforeEach(async () => {
  await prisma.mealIngredient.deleteMany();
  await prisma.meal.deleteMany();
  await prisma.ingredient.deleteMany();
});

describe("POST /api/meals", () => {
  it("creates a meal with ingredients", async () => {
    const garlic = await prisma.ingredient.create({
      data: { name: "Garlic", category: "produce", defaultUnit: "cloves" },
    });

    const res = await request(app)
      .post("/api/meals")
      .send({
        name: "Garlic Chicken",
        mealType: "cook_fresh",
        servings: 2,
        prepTime: 10,
        cookTime: 25,
        tags: ["chicken", "quick"],
        instructions: ["Season chicken", "Cook in pan with garlic"],
        calories: 450,
        proteinG: 35,
        carbsG: 10,
        fatG: 20,
        ingredients: [
          { ingredientId: garlic.id, quantity: 4, unit: "cloves", preparation: "minced" },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Garlic Chicken");
    expect(res.body.ingredients).toHaveLength(1);
    expect(res.body.ingredients[0].ingredient.name).toBe("Garlic");
  });
});

describe("GET /api/meals", () => {
  it("returns all meals with ingredients", async () => {
    await prisma.meal.create({
      data: {
        name: "Test Meal",
        mealType: "batch_prep",
        servings: 4,
        instructions: ["Step 1"],
      },
    });

    const res = await request(app).get("/api/meals");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Test Meal");
  });
});

describe("GET /api/meals/:id", () => {
  it("returns a single meal with all details", async () => {
    const meal = await prisma.meal.create({
      data: {
        name: "Detail Meal",
        mealType: "cook_fresh",
        servings: 2,
        instructions: ["Do stuff"],
      },
    });

    const res = await request(app).get(`/api/meals/${meal.id}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Detail Meal");
  });

  it("returns 404 for non-existent meal", async () => {
    const res = await request(app).get("/api/meals/99999");
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/meals/:id", () => {
  it("updates meal fields", async () => {
    const meal = await prisma.meal.create({
      data: {
        name: "Old Name",
        mealType: "cook_fresh",
        servings: 2,
        instructions: ["Step 1"],
      },
    });

    const res = await request(app)
      .put(`/api/meals/${meal.id}`)
      .send({ name: "New Name", servings: 4 });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("New Name");
    expect(res.body.servings).toBe(4);
  });
});

describe("DELETE /api/meals/:id", () => {
  it("deletes a meal", async () => {
    const meal = await prisma.meal.create({
      data: {
        name: "To Delete",
        mealType: "cook_fresh",
        servings: 2,
        instructions: ["Step 1"],
      },
    });

    const res = await request(app).delete(`/api/meals/${meal.id}`);
    expect(res.status).toBe(204);

    const check = await prisma.meal.findUnique({ where: { id: meal.id } });
    expect(check).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npx vitest run src/routes/meals.test.ts
```

Expected: FAIL — routes not defined.

- [ ] **Step 3: Implement meal service**

`server/src/services/mealService.ts`:
```ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const mealWithIngredients = {
  ingredients: {
    include: { ingredient: true },
  },
};

export async function getAllMeals() {
  return prisma.meal.findMany({
    include: mealWithIngredients,
    orderBy: { name: "asc" },
  });
}

export async function getMealById(id: number) {
  return prisma.meal.findUnique({
    where: { id },
    include: mealWithIngredients,
  });
}

interface IngredientInput {
  ingredientId: number;
  quantity: number;
  unit: string;
  preparation?: string;
}

interface CreateMealInput {
  name: string;
  description?: string;
  source?: "hello_fresh" | "manual";
  sourceUrl?: string;
  mealType: "batch_prep" | "cook_fresh";
  servings: number;
  prepTime?: number;
  cookTime?: number;
  tags?: string[];
  instructions: string[];
  imageUrl?: string;
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  fiberG?: number;
  sodiumMg?: number;
  ingredients?: IngredientInput[];
}

export async function createMeal(data: CreateMealInput) {
  const { ingredients, instructions, ...mealData } = data;

  return prisma.meal.create({
    data: {
      ...mealData,
      instructions: JSON.stringify(instructions),
      ingredients: ingredients
        ? {
            create: ingredients.map((ing) => ({
              ingredientId: ing.ingredientId,
              quantity: ing.quantity,
              unit: ing.unit,
              preparation: ing.preparation,
            })),
          }
        : undefined,
    },
    include: mealWithIngredients,
  });
}

export async function updateMeal(id: number, data: Partial<CreateMealInput>) {
  const { ingredients, instructions, ...mealData } = data;

  const updateData: any = { ...mealData };
  if (instructions) {
    updateData.instructions = JSON.stringify(instructions);
  }

  if (ingredients) {
    await prisma.mealIngredient.deleteMany({ where: { mealId: id } });
    await prisma.mealIngredient.createMany({
      data: ingredients.map((ing) => ({
        mealId: id,
        ingredientId: ing.ingredientId,
        quantity: ing.quantity,
        unit: ing.unit,
        preparation: ing.preparation,
      })),
    });
  }

  return prisma.meal.update({
    where: { id },
    data: updateData,
    include: mealWithIngredients,
  });
}

export async function deleteMeal(id: number) {
  return prisma.meal.delete({ where: { id } });
}
```

- [ ] **Step 4: Implement meal routes**

`server/src/routes/meals.ts`:
```ts
import { Router } from "express";
import * as mealService from "../services/mealService.js";

const router = Router();

router.get("/", async (_req, res) => {
  const meals = await mealService.getAllMeals();
  res.json(meals);
});

router.get("/:id", async (req, res) => {
  const meal = await mealService.getMealById(Number(req.params.id));
  if (!meal) {
    res.status(404).json({ error: "Meal not found" });
    return;
  }
  res.json(meal);
});

router.post("/", async (req, res) => {
  const meal = await mealService.createMeal(req.body);
  res.status(201).json(meal);
});

router.put("/:id", async (req, res) => {
  const meal = await mealService.updateMeal(Number(req.params.id), req.body);
  res.json(meal);
});

router.delete("/:id", async (req, res) => {
  await mealService.deleteMeal(Number(req.params.id));
  res.status(204).send();
});

export default router;
```

Mount in `server/src/index.ts`:
```ts
import mealRoutes from "./routes/meals.js";
app.use("/api/meals", mealRoutes);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd server && npx vitest run src/routes/meals.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: add meal CRUD API with ingredient associations and tests"
```

---

## Task 6: Pantry CRUD API

**Files:**
- Create: `server/src/services/pantryService.ts`
- Create: `server/src/routes/pantry.ts`
- Test: `server/src/routes/pantry.test.ts`

- [ ] **Step 1: Write failing tests for pantry routes**

`server/src/routes/pantry.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../index.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

let chickenId: number;

beforeEach(async () => {
  await prisma.pantryItem.deleteMany();
  await prisma.ingredient.deleteMany();
  const chicken = await prisma.ingredient.create({
    data: { name: "Chicken Breast", category: "protein", defaultUnit: "lb" },
  });
  chickenId = chicken.id;
});

describe("GET /api/pantry", () => {
  it("returns pantry items with ingredient details", async () => {
    await prisma.pantryItem.create({
      data: { ingredientId: chickenId, quantity: 2, unit: "lb", location: "fridge" },
    });

    const res = await request(app).get("/api/pantry");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].ingredient.name).toBe("Chicken Breast");
  });
});

describe("POST /api/pantry", () => {
  it("adds an item to the pantry", async () => {
    const res = await request(app)
      .post("/api/pantry")
      .send({ ingredientId: chickenId, quantity: 3, unit: "lb", location: "freezer" });

    expect(res.status).toBe(201);
    expect(res.body.quantity).toBe(3);
    expect(res.body.location).toBe("freezer");
  });
});

describe("PUT /api/pantry/:id", () => {
  it("updates quantity and location", async () => {
    const item = await prisma.pantryItem.create({
      data: { ingredientId: chickenId, quantity: 2, unit: "lb", location: "fridge" },
    });

    const res = await request(app)
      .put(`/api/pantry/${item.id}`)
      .send({ quantity: 1, location: "fridge" });

    expect(res.status).toBe(200);
    expect(res.body.quantity).toBe(1);
  });
});

describe("DELETE /api/pantry/:id", () => {
  it("removes an item from pantry", async () => {
    const item = await prisma.pantryItem.create({
      data: { ingredientId: chickenId, quantity: 2, unit: "lb", location: "fridge" },
    });

    const res = await request(app).delete(`/api/pantry/${item.id}`);
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npx vitest run src/routes/pantry.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement pantry service**

`server/src/services/pantryService.ts`:
```ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function getAllPantryItems() {
  return prisma.pantryItem.findMany({
    include: { ingredient: true },
    orderBy: { ingredient: { name: "asc" } },
  });
}

export async function addPantryItem(data: {
  ingredientId: number;
  quantity: number;
  unit: string;
  location: "fridge" | "freezer" | "pantry";
  expirationDate?: string;
}) {
  return prisma.pantryItem.create({
    data: {
      ingredientId: data.ingredientId,
      quantity: data.quantity,
      unit: data.unit,
      location: data.location,
      expirationDate: data.expirationDate ? new Date(data.expirationDate) : undefined,
    },
    include: { ingredient: true },
  });
}

export async function updatePantryItem(id: number, data: { quantity?: number; location?: "fridge" | "freezer" | "pantry" }) {
  return prisma.pantryItem.update({
    where: { id },
    data,
    include: { ingredient: true },
  });
}

export async function deletePantryItem(id: number) {
  return prisma.pantryItem.delete({ where: { id } });
}

export async function deductIngredientsForMeal(mealId: number, servingMultiplier: number) {
  const mealIngredients = await prisma.mealIngredient.findMany({
    where: { mealId },
  });

  for (const mi of mealIngredients) {
    const needed = mi.quantity * servingMultiplier;
    const pantryItems = await prisma.pantryItem.findMany({
      where: { ingredientId: mi.ingredientId },
      orderBy: { expirationDate: "asc" },
    });

    let remaining = needed;
    for (const item of pantryItems) {
      if (remaining <= 0) break;
      if (item.quantity <= remaining) {
        remaining -= item.quantity;
        await prisma.pantryItem.delete({ where: { id: item.id } });
      } else {
        await prisma.pantryItem.update({
          where: { id: item.id },
          data: { quantity: item.quantity - remaining },
        });
        remaining = 0;
      }
    }
  }
}
```

- [ ] **Step 4: Implement pantry routes**

`server/src/routes/pantry.ts`:
```ts
import { Router } from "express";
import * as pantryService from "../services/pantryService.js";

const router = Router();

router.get("/", async (_req, res) => {
  const items = await pantryService.getAllPantryItems();
  res.json(items);
});

router.post("/", async (req, res) => {
  const item = await pantryService.addPantryItem(req.body);
  res.status(201).json(item);
});

router.put("/:id", async (req, res) => {
  const item = await pantryService.updatePantryItem(Number(req.params.id), req.body);
  res.json(item);
});

router.delete("/:id", async (req, res) => {
  await pantryService.deletePantryItem(Number(req.params.id));
  res.status(204).send();
});

export default router;
```

Mount in `server/src/index.ts`:
```ts
import pantryRoutes from "./routes/pantry.js";
app.use("/api/pantry", pantryRoutes);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd server && npx vitest run src/routes/pantry.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: add pantry CRUD API with auto-deduct logic and tests"
```

---

## Task 7: Weekly Plan & Planned Meals API

**Files:**
- Create: `server/src/services/plannerService.ts`
- Create: `server/src/routes/plans.ts`
- Test: `server/src/routes/plans.test.ts`

- [ ] **Step 1: Write failing tests for plan routes**

`server/src/routes/plans.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../index.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

let mealId: number;

beforeEach(async () => {
  await prisma.plannedMeal.deleteMany();
  await prisma.weeklyPlan.deleteMany();
  await prisma.mealIngredient.deleteMany();
  await prisma.meal.deleteMany();

  const meal = await prisma.meal.create({
    data: { name: "Test Meal", mealType: "cook_fresh", servings: 2, instructions: ["Cook it"] },
  });
  mealId = meal.id;
});

describe("POST /api/plans", () => {
  it("creates a weekly plan", async () => {
    const res = await request(app)
      .post("/api/plans")
      .send({ weekStartDate: "2026-04-13" });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
  });
});

describe("GET /api/plans", () => {
  it("returns all plans", async () => {
    await prisma.weeklyPlan.create({
      data: { weekStartDate: new Date("2026-04-13") },
    });

    const res = await request(app).get("/api/plans");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe("POST /api/plans/:id/meals", () => {
  it("adds a meal to the plan", async () => {
    const plan = await prisma.weeklyPlan.create({
      data: { weekStartDate: new Date("2026-04-13") },
    });

    const res = await request(app)
      .post(`/api/plans/${plan.id}/meals`)
      .send({
        mealId,
        day: "monday",
        mealSlot: "dinner",
        servings: 2,
        isPrep: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.day).toBe("monday");
    expect(res.body.meal.name).toBe("Test Meal");
  });
});

describe("PUT /api/plans/:planId/meals/:mealId", () => {
  it("updates a planned meal status to cooked", async () => {
    const plan = await prisma.weeklyPlan.create({
      data: { weekStartDate: new Date("2026-04-13") },
    });
    const pm = await prisma.plannedMeal.create({
      data: { planId: plan.id, mealId, day: "monday", mealSlot: "dinner", servings: 2 },
    });

    const res = await request(app)
      .put(`/api/plans/${plan.id}/meals/${pm.id}`)
      .send({ status: "cooked" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cooked");
  });
});

describe("PUT /api/plans/:id", () => {
  it("activates a plan", async () => {
    const plan = await prisma.weeklyPlan.create({
      data: { weekStartDate: new Date("2026-04-13") },
    });

    const res = await request(app)
      .put(`/api/plans/${plan.id}`)
      .send({ status: "active" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npx vitest run src/routes/plans.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement planner service**

`server/src/services/plannerService.ts`:
```ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const planWithMeals = {
  plannedMeals: {
    include: { meal: { include: { ingredients: { include: { ingredient: true } } } } },
    orderBy: [{ day: "asc" as const }, { mealSlot: "asc" as const }],
  },
};

export async function getAllPlans() {
  return prisma.weeklyPlan.findMany({
    include: planWithMeals,
    orderBy: { weekStartDate: "desc" },
  });
}

export async function getPlanById(id: number) {
  return prisma.weeklyPlan.findUnique({
    where: { id },
    include: planWithMeals,
  });
}

export async function createPlan(weekStartDate: string) {
  return prisma.weeklyPlan.create({
    data: { weekStartDate: new Date(weekStartDate) },
    include: planWithMeals,
  });
}

export async function updatePlan(id: number, data: { status?: string }) {
  return prisma.weeklyPlan.update({
    where: { id },
    data,
    include: planWithMeals,
  });
}

export async function addPlannedMeal(planId: number, data: {
  mealId: number;
  day: string;
  mealSlot: string;
  servings: number;
  isPrep: boolean;
}) {
  return prisma.plannedMeal.create({
    data: { planId, ...data } as any,
    include: { meal: { include: { ingredients: { include: { ingredient: true } } } } },
  });
}

export async function updatePlannedMeal(id: number, data: {
  status?: string;
  mealId?: number;
  servings?: number;
  isPrep?: boolean;
}) {
  return prisma.plannedMeal.update({
    where: { id },
    data: data as any,
    include: { meal: { include: { ingredients: { include: { ingredient: true } } } } },
  });
}

export async function removePlannedMeal(id: number) {
  return prisma.plannedMeal.delete({ where: { id } });
}
```

- [ ] **Step 4: Implement plan routes**

`server/src/routes/plans.ts`:
```ts
import { Router } from "express";
import * as plannerService from "../services/plannerService.js";
import { deductIngredientsForMeal } from "../services/pantryService.js";

const router = Router();

router.get("/", async (_req, res) => {
  const plans = await plannerService.getAllPlans();
  res.json(plans);
});

router.get("/:id", async (req, res) => {
  const plan = await plannerService.getPlanById(Number(req.params.id));
  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }
  res.json(plan);
});

router.post("/", async (req, res) => {
  const plan = await plannerService.createPlan(req.body.weekStartDate);
  res.status(201).json(plan);
});

router.put("/:id", async (req, res) => {
  const plan = await plannerService.updatePlan(Number(req.params.id), req.body);
  res.json(plan);
});

router.post("/:id/meals", async (req, res) => {
  const planned = await plannerService.addPlannedMeal(Number(req.params.id), req.body);
  res.status(201).json(planned);
});

router.put("/:planId/meals/:mealId", async (req, res) => {
  const updated = await plannerService.updatePlannedMeal(Number(req.params.mealId), req.body);

  // Auto-deduct pantry when marking as cooked
  if (req.body.status === "cooked") {
    const servingMultiplier = updated.servings / updated.meal.servings;
    await deductIngredientsForMeal(updated.mealId, servingMultiplier);
  }

  res.json(updated);
});

router.delete("/:planId/meals/:mealId", async (req, res) => {
  await plannerService.removePlannedMeal(Number(req.params.mealId));
  res.status(204).send();
});

export default router;
```

Mount in `server/src/index.ts`:
```ts
import planRoutes from "./routes/plans.js";
app.use("/api/plans", planRoutes);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd server && npx vitest run src/routes/plans.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: add weekly plan and planned meals API with auto-deduct on cook"
```

---

## Task 8: Shopping List Generation API

**Files:**
- Create: `server/src/services/shoppingService.ts`
- Create: `server/src/routes/shopping.ts`
- Test: `server/src/routes/shopping.test.ts`

- [ ] **Step 1: Write failing tests**

`server/src/routes/shopping.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../index.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

beforeEach(async () => {
  await prisma.shoppingItem.deleteMany();
  await prisma.plannedMeal.deleteMany();
  await prisma.weeklyPlan.deleteMany();
  await prisma.pantryItem.deleteMany();
  await prisma.mealIngredient.deleteMany();
  await prisma.meal.deleteMany();
  await prisma.ingredient.deleteMany();
});

describe("POST /api/shopping/generate/:planId", () => {
  it("generates a shopping list from plan, subtracting pantry", async () => {
    const garlic = await prisma.ingredient.create({
      data: { name: "Garlic", category: "produce", defaultUnit: "cloves" },
    });
    const chicken = await prisma.ingredient.create({
      data: { name: "Chicken", category: "protein", defaultUnit: "lb" },
    });

    const meal = await prisma.meal.create({
      data: {
        name: "Garlic Chicken",
        mealType: "cook_fresh",
        servings: 2,
        instructions: ["Cook"],
        ingredients: {
          create: [
            { ingredientId: garlic.id, quantity: 4, unit: "cloves" },
            { ingredientId: chicken.id, quantity: 1, unit: "lb" },
          ],
        },
      },
    });

    // Have some garlic in pantry already
    await prisma.pantryItem.create({
      data: { ingredientId: garlic.id, quantity: 2, unit: "cloves", location: "pantry" },
    });

    const plan = await prisma.weeklyPlan.create({
      data: {
        weekStartDate: new Date("2026-04-13"),
        plannedMeals: {
          create: [{ mealId: meal.id, day: "monday", mealSlot: "dinner", servings: 2 }],
        },
      },
    });

    const res = await request(app).post(`/api/shopping/generate/${plan.id}`);
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);

    const garlicItem = res.body.find((i: any) => i.ingredient.name === "Garlic");
    expect(garlicItem.quantityNeeded).toBe(4);
    expect(garlicItem.quantityOnHand).toBe(2);
    expect(garlicItem.quantityToBuy).toBe(2);

    const chickenItem = res.body.find((i: any) => i.ingredient.name === "Chicken");
    expect(chickenItem.quantityToBuy).toBe(1);
  });
});

describe("GET /api/shopping/:planId", () => {
  it("returns the shopping list for a plan", async () => {
    const plan = await prisma.weeklyPlan.create({
      data: { weekStartDate: new Date("2026-04-13") },
    });

    const res = await request(app).get(`/api/shopping/${plan.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npx vitest run src/routes/shopping.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement shopping service**

`server/src/services/shoppingService.ts`:
```ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function generateShoppingList(planId: number) {
  // Clear existing list for this plan
  await prisma.shoppingItem.deleteMany({ where: { planId } });

  // Get all planned meals with their ingredients
  const plannedMeals = await prisma.plannedMeal.findMany({
    where: { planId, status: { in: ["planned", "cooked"] } },
    include: { meal: { include: { ingredients: true } } },
  });

  // Aggregate needed quantities per ingredient
  const needed = new Map<number, { quantity: number; unit: string }>();

  for (const pm of plannedMeals) {
    const scaleFactor = pm.servings / pm.meal.servings;
    for (const mi of pm.meal.ingredients) {
      const existing = needed.get(mi.ingredientId);
      const qty = mi.quantity * scaleFactor;
      if (existing) {
        existing.quantity += qty;
      } else {
        needed.set(mi.ingredientId, { quantity: qty, unit: mi.unit });
      }
    }
  }

  // Get pantry quantities
  const pantryItems = await prisma.pantryItem.findMany();
  const onHand = new Map<number, number>();
  for (const item of pantryItems) {
    onHand.set(item.ingredientId, (onHand.get(item.ingredientId) || 0) + item.quantity);
  }

  // Create shopping items
  const items = [];
  for (const [ingredientId, { quantity, unit }] of needed) {
    const qtyOnHand = onHand.get(ingredientId) || 0;
    const qtyToBuy = Math.max(0, quantity - qtyOnHand);

    items.push({
      planId,
      ingredientId,
      quantityNeeded: quantity,
      quantityOnHand: qtyOnHand,
      quantityToBuy: qtyToBuy,
    });
  }

  await prisma.shoppingItem.createMany({ data: items });

  return prisma.shoppingItem.findMany({
    where: { planId },
    include: { ingredient: true },
    orderBy: { ingredient: { category: "asc" } },
  });
}

export async function getShoppingList(planId: number) {
  return prisma.shoppingItem.findMany({
    where: { planId },
    include: { ingredient: true },
    orderBy: { ingredient: { category: "asc" } },
  });
}

export async function toggleShoppingItem(id: number, checked: boolean) {
  return prisma.shoppingItem.update({
    where: { id },
    data: { checked },
    include: { ingredient: true },
  });
}
```

- [ ] **Step 4: Implement shopping routes**

`server/src/routes/shopping.ts`:
```ts
import { Router } from "express";
import * as shoppingService from "../services/shoppingService.js";

const router = Router();

router.post("/generate/:planId", async (req, res) => {
  const items = await shoppingService.generateShoppingList(Number(req.params.planId));
  res.status(201).json(items);
});

router.get("/:planId", async (req, res) => {
  const items = await shoppingService.getShoppingList(Number(req.params.planId));
  res.json(items);
});

router.put("/item/:id", async (req, res) => {
  const item = await shoppingService.toggleShoppingItem(Number(req.params.id), req.body.checked);
  res.json(item);
});

export default router;
```

Mount in `server/src/index.ts`:
```ts
import shoppingRoutes from "./routes/shopping.js";
app.use("/api/shopping", shoppingRoutes);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd server && npx vitest run src/routes/shopping.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: add shopping list generation with pantry subtraction and tests"
```

---

## Task 9: Claude CLI Integration Layer

**Files:**
- Create: `server/src/claude/cli.ts`
- Create: `server/src/claude/recipeParser.ts`
- Create: `server/src/claude/mealPlanner.ts`
- Create: `server/src/claude/chatAgent.ts`
- Test: `server/src/claude/cli.test.ts`

- [ ] **Step 1: Write failing test for Claude CLI wrapper**

`server/src/claude/cli.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { callClaude } from "./cli.js";
import { execFile } from "child_process";

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

describe("callClaude", () => {
  it("calls claude -p with the given prompt and returns stdout", async () => {
    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, { stdout: '{"name":"Test Meal"}', stderr: "" });
      return {} as any;
    });

    const result = await callClaude("Parse this recipe");
    expect(result).toBe('{"name":"Test Meal"}');
    expect(mockExecFile).toHaveBeenCalledWith(
      "claude",
      ["-p", "Parse this recipe"],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("throws on non-zero exit", async () => {
    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(new Error("Command failed"), { stdout: "", stderr: "error" });
      return {} as any;
    });

    await expect(callClaude("bad prompt")).rejects.toThrow("Command failed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npx vitest run src/claude/cli.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement Claude CLI wrapper**

`server/src/claude/cli.ts`:
```ts
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function callClaude(prompt: string, options?: { timeout?: number }): Promise<string> {
  const timeout = options?.timeout || 120_000; // 2 min default

  const { stdout } = await execFileAsync("claude", ["-p", prompt], {
    timeout,
    maxBuffer: 1024 * 1024 * 10, // 10MB
  });

  return stdout.trim();
}
```

- [ ] **Step 4: Implement recipe parser**

`server/src/claude/recipeParser.ts`:
```ts
import { callClaude } from "./cli.js";
import { readFile } from "fs/promises";
import path from "path";

interface ParsedRecipe {
  name: string;
  description: string;
  mealType: "batch_prep" | "cook_fresh";
  servings: number;
  prepTime: number | null;
  cookTime: number | null;
  tags: string[];
  instructions: string[];
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
  ingredients: {
    name: string;
    quantity: number;
    unit: string;
    category: string;
    preparation: string | null;
  }[];
}

export async function parseRecipeFromFile(filePath: string): Promise<ParsedRecipe> {
  const ext = path.extname(filePath).toLowerCase();
  const fileContent = await readFile(filePath);
  const base64 = fileContent.toString("base64");

  const mediaType = ext === ".pdf" ? "application/pdf"
    : ext === ".png" ? "image/png"
    : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
    : "application/octet-stream";

  const prompt = `You are a recipe parser. You will receive a Hello Fresh recipe card (as a ${mediaType} file encoded in base64). Extract all recipe information and return ONLY valid JSON matching this exact schema — no markdown, no explanation:

{
  "name": "string",
  "description": "string (1-2 sentence summary)",
  "mealType": "cook_fresh",
  "servings": number,
  "prepTime": number_or_null (minutes),
  "cookTime": number_or_null (minutes),
  "tags": ["string"],
  "instructions": ["step 1 text", "step 2 text"],
  "calories": number_or_null,
  "proteinG": number_or_null,
  "carbsG": number_or_null,
  "fatG": number_or_null,
  "fiberG": number_or_null,
  "sodiumMg": number_or_null,
  "ingredients": [
    {
      "name": "string (lowercase, singular)",
      "quantity": number,
      "unit": "string",
      "category": "produce|protein|dairy|pantry_staple|grain|spice|condiment|frozen|other",
      "preparation": "string_or_null (e.g. diced, minced)"
    }
  ]
}

For tags, include protein type, cuisine, and any relevant descriptors (quick, vegetarian, etc).

Base64 file content:
${base64}`;

  const raw = await callClaude(prompt, { timeout: 180_000 });

  // Extract JSON from response (claude may wrap in markdown code blocks)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to extract JSON from Claude response");
  }

  const parsed: ParsedRecipe = JSON.parse(jsonMatch[0]);
  return parsed;
}
```

- [ ] **Step 5: Implement meal planner AI**

`server/src/claude/mealPlanner.ts`:
```ts
import { callClaude } from "./cli.js";

interface MealSummary {
  id: number;
  name: string;
  mealType: string;
  tags: string[];
  servings: number;
  calories: number | null;
}

interface PantryOverview {
  name: string;
  quantity: number;
  unit: string;
}

interface SuggestedPlan {
  meals: {
    mealId: number;
    day: string;
    mealSlot: string;
    servings: number;
    isPrep: boolean;
  }[];
}

export async function generateWeeklyPlan(
  meals: MealSummary[],
  pantry: PantryOverview[],
  recentMealIds: number[],
): Promise<SuggestedPlan> {
  const prompt = `You are a meal planning assistant. Generate a weekly meal plan (Monday-Sunday) for 2 people.

Rules:
- Pick 2-3 batch_prep meals for Sunday prep that cover lunches/dinners through the week
- Pick 2-3 cook_fresh meals for dinners that are cooked that evening
- Avoid meals used recently: ${JSON.stringify(recentMealIds)}
- Prefer meals that use ingredients already in the pantry
- Balance nutrition and variety across the week
- Each day should have lunch and dinner planned

Available meals:
${JSON.stringify(meals, null, 2)}

Current pantry:
${JSON.stringify(pantry, null, 2)}

Return ONLY valid JSON:
{
  "meals": [
    {
      "mealId": number,
      "day": "monday|tuesday|wednesday|thursday|friday|saturday|sunday",
      "mealSlot": "lunch|dinner",
      "servings": number,
      "isPrep": boolean
    }
  ]
}`;

  const raw = await callClaude(prompt, { timeout: 180_000 });
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to extract JSON from Claude response");
  }

  return JSON.parse(jsonMatch[0]);
}
```

- [ ] **Step 6: Implement chat agent**

`server/src/claude/chatAgent.ts`:
```ts
import { callClaude } from "./cli.js";

interface ChatContext {
  meals: { id: number; name: string; tags: string[]; mealType: string }[];
  pantry: { name: string; quantity: number; unit: string }[];
  currentPlan: {
    id: number;
    meals: { id: number; mealName: string; day: string; mealSlot: string; servings: number; status: string }[];
  } | null;
}

interface ChatResponse {
  message: string;
  actions: {
    type: "swap_meal" | "skip_meal" | "scale_servings" | "add_meal" | "update_pantry" | "none";
    params: Record<string, any>;
  }[];
}

export async function chat(userMessage: string, context: ChatContext): Promise<ChatResponse> {
  const prompt = `You are a helpful meal planning assistant. The user manages their weekly meals through this app.

Current state:
- Recipe library: ${JSON.stringify(context.meals)}
- Pantry: ${JSON.stringify(context.pantry)}
- This week's plan: ${JSON.stringify(context.currentPlan)}

User message: "${userMessage}"

Respond with ONLY valid JSON:
{
  "message": "Your friendly response to the user",
  "actions": [
    {
      "type": "swap_meal|skip_meal|scale_servings|add_meal|update_pantry|none",
      "params": { ... relevant params ... }
    }
  ]
}

Action param schemas:
- swap_meal: { "plannedMealId": number, "newMealId": number, "day": string, "mealSlot": string }
- skip_meal: { "plannedMealId": number }
- scale_servings: { "plannedMealId": number, "newServings": number }
- add_meal: { "mealId": number, "day": string, "mealSlot": string, "servings": number }
- update_pantry: { "ingredientName": string, "quantity": number, "unit": string, "action": "set|remove" }
- none: {} (just a conversational response)

Be concise and helpful.`;

  const raw = await callClaude(prompt, { timeout: 120_000 });
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to extract JSON from Claude response");
  }

  return JSON.parse(jsonMatch[0]);
}
```

- [ ] **Step 7: Run CLI test to verify it passes**

```bash
cd server && npx vitest run src/claude/cli.test.ts
```

Expected: PASS (mocked).

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "feat: add Claude CLI integration layer with recipe parser, meal planner, and chat agent"
```

---

## Task 10: Recipe Import Route (PDF/Photo Upload)

**Files:**
- Create: `server/src/middleware/upload.ts`
- Modify: `server/src/routes/meals.ts` — add POST `/api/meals/import`

- [ ] **Step 1: Implement upload middleware**

`server/src/middleware/upload.ts`:
```ts
import multer from "multer";
import path from "path";
import { mkdirSync } from "fs";

const uploadDir = path.join(process.cwd(), "uploads");
mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".png", ".jpg", ".jpeg", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not supported. Use PDF, PNG, JPG, or WEBP.`));
    }
  },
});
```

- [ ] **Step 2: Add import route to meals.ts**

Add to the bottom of `server/src/routes/meals.ts`:
```ts
import { upload } from "../middleware/upload.js";
import { parseRecipeFromFile } from "../claude/recipeParser.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

router.post("/import", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  try {
    const parsed = await parseRecipeFromFile(req.file.path);

    // Upsert ingredients and collect IDs
    const ingredientMap = new Map<string, number>();
    for (const ing of parsed.ingredients) {
      const ingredient = await prisma.ingredient.upsert({
        where: { name: ing.name },
        update: {},
        create: {
          name: ing.name,
          category: ing.category as any,
          defaultUnit: ing.unit,
        },
      });
      ingredientMap.set(ing.name, ingredient.id);
    }

    res.json({
      parsed,
      ingredientMap: Object.fromEntries(ingredientMap),
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to parse recipe", details: err.message });
  }
});
```

This returns the parsed data for user review. The frontend will show it in a form, and the user confirms → triggers the existing `POST /api/meals` to save.

- [ ] **Step 3: Add "uploads" to .gitignore**

Append `uploads/` to `.gitignore`.

- [ ] **Step 4: Test manually with a sample PDF**

```bash
curl -X POST http://localhost:3001/api/meals/import \
  -F "file=@/path/to/sample-recipe.pdf"
```

Expected: JSON response with parsed recipe data.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add recipe import endpoint with PDF/photo upload and Claude parsing"
```

---

## Task 11: Chat & AI Plan Generation Routes

**Files:**
- Create: `server/src/services/chatService.ts`
- Create: `server/src/routes/chat.ts`
- Modify: `server/src/routes/plans.ts` — add POST `/api/plans/:id/generate`

- [ ] **Step 1: Implement chat service**

`server/src/services/chatService.ts`:
```ts
import { PrismaClient } from "@prisma/client";
import { chat, ChatResponse } from "../claude/chatAgent.js";
import * as plannerService from "./plannerService.js";
import * as pantryService from "./pantryService.js";

const prisma = new PrismaClient();

export async function handleChatMessage(message: string): Promise<ChatResponse & { applied: boolean[] }> {
  // Build context
  const meals = await prisma.meal.findMany({
    select: { id: true, name: true, tags: true, mealType: true },
  });
  const pantryItems = await prisma.pantryItem.findMany({
    include: { ingredient: true },
  });
  const pantry = pantryItems.map((p) => ({
    name: p.ingredient.name,
    quantity: p.quantity,
    unit: p.unit,
  }));

  const activePlan = await prisma.weeklyPlan.findFirst({
    where: { status: "active" },
    include: {
      plannedMeals: { include: { meal: true } },
    },
    orderBy: { weekStartDate: "desc" },
  });

  const currentPlan = activePlan
    ? {
        id: activePlan.id,
        meals: activePlan.plannedMeals.map((pm) => ({
          id: pm.id,
          mealName: pm.meal.name,
          day: pm.day,
          mealSlot: pm.mealSlot,
          servings: pm.servings,
          status: pm.status,
        })),
      }
    : null;

  const response = await chat(message, { meals, pantry, currentPlan });

  // Execute actions
  const applied: boolean[] = [];
  for (const action of response.actions) {
    try {
      switch (action.type) {
        case "swap_meal":
          await plannerService.updatePlannedMeal(action.params.plannedMealId, {
            mealId: action.params.newMealId,
          });
          applied.push(true);
          break;
        case "skip_meal":
          await plannerService.updatePlannedMeal(action.params.plannedMealId, {
            status: "skipped",
          });
          applied.push(true);
          break;
        case "scale_servings":
          await plannerService.updatePlannedMeal(action.params.plannedMealId, {
            servings: action.params.newServings,
          });
          applied.push(true);
          break;
        case "none":
          applied.push(true);
          break;
        default:
          applied.push(false);
      }
    } catch {
      applied.push(false);
    }
  }

  return { ...response, applied };
}
```

- [ ] **Step 2: Implement chat route**

`server/src/routes/chat.ts`:
```ts
import { Router } from "express";
import { handleChatMessage } from "../services/chatService.js";

const router = Router();

router.post("/", async (req, res) => {
  const { message } = req.body;
  if (!message) {
    res.status(400).json({ error: "Message is required" });
    return;
  }

  try {
    const response = await handleChatMessage(message);
    res.json(response);
  } catch (err: any) {
    res.status(500).json({ error: "Chat failed", details: err.message });
  }
});

export default router;
```

Mount in `server/src/index.ts`:
```ts
import chatRoutes from "./routes/chat.js";
app.use("/api/chat", chatRoutes);
```

- [ ] **Step 3: Add AI plan generation endpoint**

Add to `server/src/routes/plans.ts`:
```ts
import { generateWeeklyPlan } from "../claude/mealPlanner.js";

router.post("/:id/generate", async (req, res) => {
  const planId = Number(req.params.id);
  const plan = await plannerService.getPlanById(planId);
  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }

  // Get all meals for AI context
  const allMeals = await prisma.meal.findMany({
    select: { id: true, name: true, mealType: true, tags: true, servings: true, calories: true },
  });

  // Get pantry overview
  const pantryItems = await prisma.pantryItem.findMany({
    include: { ingredient: true },
  });
  const pantry = pantryItems.map((p) => ({
    name: p.ingredient.name,
    quantity: p.quantity,
    unit: p.unit,
  }));

  // Get recently used meal IDs (last 2 weeks)
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const recentPlans = await prisma.plannedMeal.findMany({
    where: { plan: { weekStartDate: { gte: twoWeeksAgo } } },
    select: { mealId: true },
  });
  const recentMealIds = [...new Set(recentPlans.map((p) => p.mealId))];

  try {
    const suggested = await generateWeeklyPlan(allMeals, pantry, recentMealIds);

    // Add suggested meals to the plan
    for (const meal of suggested.meals) {
      await plannerService.addPlannedMeal(planId, {
        mealId: meal.mealId,
        day: meal.day,
        mealSlot: meal.mealSlot,
        servings: meal.servings,
        isPrep: meal.isPrep,
      });
    }

    const updatedPlan = await plannerService.getPlanById(planId);
    res.json(updatedPlan);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to generate plan", details: err.message });
  }
});
```

Add `PrismaClient` import at top of plans.ts if not already there:
```ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
```

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: add chat endpoint and AI-powered weekly plan generation"
```

---

## Task 12: Google Calendar Integration

**Files:**
- Create: `server/src/services/calendarService.ts`
- Create: `server/src/routes/calendar.ts`

- [ ] **Step 1: Implement calendar service**

`server/src/services/calendarService.ts`:
```ts
import { google } from "googleapis";
import { readFile, writeFile } from "fs/promises";
import path from "path";

const TOKEN_PATH = path.join(process.cwd(), "calendar-tokens.json");

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || "http://localhost:3001/api/calendar/callback",
  );
}

export function getAuthUrl() {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar.events"],
  });
}

export async function handleCallback(code: string) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  await writeFile(TOKEN_PATH, JSON.stringify(tokens));
  return tokens;
}

async function getAuthenticatedClient() {
  const client = getOAuth2Client();
  const tokenData = await readFile(TOKEN_PATH, "utf-8");
  client.setCredentials(JSON.parse(tokenData));
  return client;
}

interface MealEvent {
  summary: string;
  description: string;
  date: string; // YYYY-MM-DD
  mealSlot: string;
}

export async function createMealEvent(event: MealEvent): Promise<string> {
  const auth = await getAuthenticatedClient();
  const calendar = google.calendar({ version: "v3", auth });

  // Lunch at 12:00, dinner at 18:00
  const hour = event.mealSlot === "lunch" ? 12 : event.mealSlot === "breakfast" ? 8 : 18;

  const start = new Date(`${event.date}T${String(hour).padStart(2, "0")}:00:00`);
  const end = new Date(start.getTime() + 60 * 60 * 1000); // 1 hour

  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: event.summary,
      description: event.description,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    },
  });

  return res.data.id!;
}

export async function updateMealEvent(eventId: string, event: Partial<MealEvent>) {
  const auth = await getAuthenticatedClient();
  const calendar = google.calendar({ version: "v3", auth });

  const updateData: any = {};
  if (event.summary) updateData.summary = event.summary;
  if (event.description) updateData.description = event.description;

  await calendar.events.patch({
    calendarId: "primary",
    eventId,
    requestBody: updateData,
  });
}

export async function deleteMealEvent(eventId: string) {
  const auth = await getAuthenticatedClient();
  const calendar = google.calendar({ version: "v3", auth });

  await calendar.events.delete({
    calendarId: "primary",
    eventId,
  });
}
```

- [ ] **Step 2: Implement calendar routes**

`server/src/routes/calendar.ts`:
```ts
import { Router } from "express";
import * as calendarService from "../services/calendarService.js";
import * as plannerService from "../services/plannerService.js";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

// Step 1: Redirect user to Google OAuth
router.get("/auth", (_req, res) => {
  const url = calendarService.getAuthUrl();
  res.redirect(url);
});

// Step 2: Handle OAuth callback
router.get("/callback", async (req, res) => {
  const code = req.query.code as string;
  await calendarService.handleCallback(code);
  res.send("Calendar connected! You can close this tab.");
});

// Sync a confirmed plan to Google Calendar
router.post("/sync/:planId", async (req, res) => {
  const plan = await plannerService.getPlanById(Number(req.params.planId));
  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }

  const weekStart = new Date(plan.weekStartDate);
  const dayOffsets: Record<string, number> = {
    monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
    friday: 4, saturday: 5, sunday: 6,
  };

  const results = [];
  for (const pm of plan.plannedMeals) {
    const dayOffset = dayOffsets[pm.day] ?? 0;
    const mealDate = new Date(weekStart);
    mealDate.setDate(mealDate.getDate() + dayOffset);
    const dateStr = mealDate.toISOString().split("T")[0];

    const prepNote = pm.isPrep ? " [Meal Prep]" : "";
    const eventId = await calendarService.createMealEvent({
      summary: `${pm.meal.name}${prepNote}`,
      description: `${pm.servings} servings | ${pm.mealSlot}`,
      date: dateStr,
      mealSlot: pm.mealSlot,
    });

    // Store calendar event ID on planned meal for future updates
    await prisma.plannedMeal.update({
      where: { id: pm.id },
      data: { calendarEventId: eventId },
    });

    results.push({ plannedMealId: pm.id, eventId });
  }

  res.json({ synced: results.length, events: results });
});

export default router;
```

Mount in `server/src/index.ts`:
```ts
import calendarRoutes from "./routes/calendar.js";
app.use("/api/calendar", calendarRoutes);
```

- [ ] **Step 3: Add Google OAuth env vars to .env**

Append to `server/.env`:
```
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3001/api/calendar/callback
```

Add `calendar-tokens.json` to `.gitignore`.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: add Google Calendar integration with OAuth2 and meal event syncing"
```

---

## Task 13: Frontend — App Shell, Routing, and API Client

**Files:**
- Create: `client/src/App.tsx`
- Create: `client/src/main.tsx`
- Create: `client/src/api/client.ts`
- Create: `client/src/hooks/useApi.ts`
- Create: `client/src/components/Layout.tsx`

- [ ] **Step 1: Implement API client**

`client/src/api/client.ts`:
```ts
const BASE = "/api";

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}
```

- [ ] **Step 2: Implement useApi hook**

`client/src/hooks/useApi.ts`:
```ts
import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api/client";

export function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<T>(path)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
```

- [ ] **Step 3: Implement Layout component**

`client/src/components/Layout.tsx`:
```tsx
import { NavLink, Outlet } from "react-router-dom";

const navItems = [
  { to: "/", label: "Dashboard", icon: "🏠" },
  { to: "/recipes", label: "Recipes", icon: "📖" },
  { to: "/planner", label: "Planner", icon: "📅" },
  { to: "/pantry", label: "Pantry", icon: "🥫" },
  { to: "/shopping", label: "Shopping", icon: "🛒" },
  { to: "/chat", label: "Chat", icon: "💬" },
];

export default function Layout() {
  return (
    <div className="flex h-screen bg-gray-50">
      <nav className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-bold text-gray-900">Meal Planner</h1>
        </div>
        <div className="flex-1 p-2 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`
              }
            >
              <span>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Set up App.tsx with routes**

`client/src/App.tsx`:
```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Recipes from "./pages/Recipes";
import RecipeDetail from "./pages/RecipeDetail";
import RecipeImport from "./pages/RecipeImport";
import Planner from "./pages/Planner";
import Pantry from "./pages/Pantry";
import ShoppingList from "./pages/ShoppingList";
import Chat from "./pages/Chat";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/recipes" element={<Recipes />} />
          <Route path="/recipes/:id" element={<RecipeDetail />} />
          <Route path="/recipes/import" element={<RecipeImport />} />
          <Route path="/planner" element={<Planner />} />
          <Route path="/pantry" element={<Pantry />} />
          <Route path="/shopping" element={<ShoppingList />} />
          <Route path="/chat" element={<Chat />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 5: Create placeholder pages**

Create each page file with a minimal placeholder so the app compiles. Each will be fleshed out in subsequent tasks.

`client/src/pages/Dashboard.tsx`:
```tsx
export default function Dashboard() {
  return <div><h2 className="text-2xl font-bold">Dashboard</h2><p className="text-gray-500 mt-2">Today's meals will appear here.</p></div>;
}
```

`client/src/pages/Recipes.tsx`:
```tsx
export default function Recipes() {
  return <div><h2 className="text-2xl font-bold">Recipes</h2></div>;
}
```

`client/src/pages/RecipeDetail.tsx`:
```tsx
export default function RecipeDetail() {
  return <div><h2 className="text-2xl font-bold">Recipe Detail</h2></div>;
}
```

`client/src/pages/RecipeImport.tsx`:
```tsx
export default function RecipeImport() {
  return <div><h2 className="text-2xl font-bold">Import Recipe</h2></div>;
}
```

`client/src/pages/Planner.tsx`:
```tsx
export default function Planner() {
  return <div><h2 className="text-2xl font-bold">Weekly Planner</h2></div>;
}
```

`client/src/pages/Pantry.tsx`:
```tsx
export default function Pantry() {
  return <div><h2 className="text-2xl font-bold">Pantry</h2></div>;
}
```

`client/src/pages/ShoppingList.tsx`:
```tsx
export default function ShoppingList() {
  return <div><h2 className="text-2xl font-bold">Shopping List</h2></div>;
}
```

`client/src/pages/Chat.tsx`:
```tsx
export default function Chat() {
  return <div><h2 className="text-2xl font-bold">Chat</h2></div>;
}
```

- [ ] **Step 6: Install react-router-dom**

```bash
cd client && npm install react-router-dom
```

- [ ] **Step 7: Verify app compiles and renders**

```bash
npm run dev:client
```

Open http://localhost:5173 — should see sidebar nav with all pages navigable.

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "feat: add frontend app shell with routing, layout, and API client"
```

---

## Task 14: Frontend — Recipe Library & Import Pages

**Files:**
- Create: `client/src/api/meals.ts`
- Create: `client/src/components/MealCard.tsx`
- Create: `client/src/components/FileUpload.tsx`
- Create: `client/src/components/MealForm.tsx`
- Modify: `client/src/pages/Recipes.tsx`
- Modify: `client/src/pages/RecipeDetail.tsx`
- Modify: `client/src/pages/RecipeImport.tsx`

- [ ] **Step 1: Implement meals API client**

`client/src/api/meals.ts`:
```ts
import { apiFetch } from "./client";

export interface Ingredient {
  id: number;
  name: string;
  category: string;
  defaultUnit: string;
}

export interface MealIngredient {
  id: number;
  quantity: number;
  unit: string;
  preparation: string | null;
  ingredient: Ingredient;
}

export interface Meal {
  id: number;
  name: string;
  description: string | null;
  source: string;
  mealType: string;
  servings: number;
  prepTime: number | null;
  cookTime: number | null;
  tags: string[];
  instructions: string;
  imageUrl: string | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
  ingredients: MealIngredient[];
}

export const getMeals = () => apiFetch<Meal[]>("/meals");
export const getMeal = (id: number) => apiFetch<Meal>(`/meals/${id}`);
export const createMeal = (data: any) =>
  apiFetch<Meal>("/meals", { method: "POST", body: JSON.stringify(data) });
export const updateMeal = (id: number, data: any) =>
  apiFetch<Meal>(`/meals/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteMeal = (id: number) =>
  apiFetch<void>(`/meals/${id}`, { method: "DELETE" });

export async function importRecipe(file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/meals/import", { method: "POST", body: form });
  if (!res.ok) throw new Error("Import failed");
  return res.json();
}
```

- [ ] **Step 2: Implement MealCard component**

`client/src/components/MealCard.tsx`:
```tsx
import { Link } from "react-router-dom";
import type { Meal } from "../api/meals";

export default function MealCard({ meal }: { meal: Meal }) {
  return (
    <Link
      to={`/recipes/${meal.id}`}
      className="block bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
    >
      {meal.imageUrl && (
        <img src={meal.imageUrl} alt={meal.name} className="w-full h-40 object-cover" />
      )}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            meal.mealType === "batch_prep"
              ? "bg-purple-100 text-purple-700"
              : "bg-green-100 text-green-700"
          }`}>
            {meal.mealType === "batch_prep" ? "Batch Prep" : "Cook Fresh"}
          </span>
        </div>
        <h3 className="font-semibold text-gray-900">{meal.name}</h3>
        {meal.description && (
          <p className="text-sm text-gray-500 mt-1 line-clamp-2">{meal.description}</p>
        )}
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
          <span>{meal.servings} servings</span>
          {meal.prepTime && <span>{meal.prepTime}m prep</span>}
          {meal.cookTime && <span>{meal.cookTime}m cook</span>}
          {meal.calories && <span>{meal.calories} cal</span>}
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {meal.tags.map((tag) => (
            <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 3: Implement FileUpload component**

`client/src/components/FileUpload.tsx`:
```tsx
import { useCallback, useState } from "react";

interface Props {
  onFile: (file: File) => void;
  accept: string;
}

export default function FileUpload({ onFile, accept }: Props) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
        dragging ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-gray-400"
      }`}
    >
      <p className="text-gray-500 text-sm">Drag & drop a recipe PDF or photo here</p>
      <p className="text-gray-400 text-xs mt-1">or click to browse</p>
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
    </label>
  );
}
```

- [ ] **Step 4: Implement MealForm component**

`client/src/components/MealForm.tsx`:
```tsx
import { useState } from "react";

interface Props {
  initialData?: any;
  onSubmit: (data: any) => void;
  submitLabel?: string;
}

export default function MealForm({ initialData, onSubmit, submitLabel = "Save" }: Props) {
  const [form, setForm] = useState(
    initialData || {
      name: "",
      description: "",
      mealType: "cook_fresh",
      servings: 2,
      prepTime: null,
      cookTime: null,
      tags: [],
      instructions: [],
      calories: null,
      proteinG: null,
      carbsG: null,
      fatG: null,
      ingredients: [],
    },
  );

  const update = (field: string, value: any) => setForm({ ...form, [field]: value });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}
      className="space-y-4 max-w-2xl"
    >
      <div>
        <label className="block text-sm font-medium text-gray-700">Name</label>
        <input
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Description</label>
        <textarea
          value={form.description || ""}
          onChange={(e) => update("description", e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          rows={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Meal Type</label>
          <select
            value={form.mealType}
            onChange={(e) => update("mealType", e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="cook_fresh">Cook Fresh</option>
            <option value="batch_prep">Batch Prep</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Servings</label>
          <input
            type="number"
            value={form.servings}
            onChange={(e) => update("servings", Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            min={1}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Prep Time (min)</label>
          <input
            type="number"
            value={form.prepTime || ""}
            onChange={(e) => update("prepTime", e.target.value ? Number(e.target.value) : null)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Cook Time (min)</label>
          <input
            type="number"
            value={form.cookTime || ""}
            onChange={(e) => update("cookTime", e.target.value ? Number(e.target.value) : null)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Calories</label>
          <input
            type="number"
            value={form.calories || ""}
            onChange={(e) => update("calories", e.target.value ? Number(e.target.value) : null)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Protein (g)</label>
          <input
            type="number"
            value={form.proteinG || ""}
            onChange={(e) => update("proteinG", e.target.value ? Number(e.target.value) : null)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Carbs (g)</label>
          <input
            type="number"
            value={form.carbsG || ""}
            onChange={(e) => update("carbsG", e.target.value ? Number(e.target.value) : null)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Fat (g)</label>
          <input
            type="number"
            value={form.fatG || ""}
            onChange={(e) => update("fatG", e.target.value ? Number(e.target.value) : null)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Tags (comma separated)</label>
        <input
          value={(form.tags || []).join(", ")}
          onChange={(e) => update("tags", e.target.value.split(",").map((t: string) => t.trim()).filter(Boolean))}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          placeholder="chicken, quick, italian"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Instructions (one per line)</label>
        <textarea
          value={(form.instructions || []).join("\n")}
          onChange={(e) => update("instructions", e.target.value.split("\n").filter(Boolean))}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          rows={6}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Ingredients</label>
        {(form.ingredients || []).map((ing: any, i: number) => (
          <div key={i} className="flex gap-2 mb-2 items-center text-sm">
            <span className="text-gray-700">{ing.quantity} {ing.unit} {ing.name || ing.ingredient?.name} {ing.preparation ? `(${ing.preparation})` : ""}</span>
          </div>
        ))}
      </div>

      <button
        type="submit"
        className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
      >
        {submitLabel}
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Build out Recipes page**

Replace `client/src/pages/Recipes.tsx`:
```tsx
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getMeals, type Meal } from "../api/meals";
import MealCard from "../components/MealCard";

export default function Recipes() {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    getMeals().then(setMeals);
  }, []);

  const filtered = meals.filter((m) => {
    const matchesSearch = m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));
    const matchesFilter = filter === "all" || m.mealType === filter;
    return matchesSearch && matchesFilter;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Recipes</h2>
        <Link
          to="/recipes/import"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          Import Recipe
        </Link>
      </div>

      <div className="flex gap-3 mb-6">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search recipes or tags..."
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="all">All Types</option>
          <option value="batch_prep">Batch Prep</option>
          <option value="cook_fresh">Cook Fresh</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-gray-500 text-center py-12">
          No recipes yet. Import your first Hello Fresh recipe!
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((meal) => (
            <MealCard key={meal.id} meal={meal} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Build out RecipeImport page**

Replace `client/src/pages/RecipeImport.tsx`:
```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import FileUpload from "../components/FileUpload";
import MealForm from "../components/MealForm";
import { importRecipe, createMeal } from "../api/meals";

export default function RecipeImport() {
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<any>(null);
  const [ingredientMap, setIngredientMap] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleFile = async (file: File) => {
    setParsing(true);
    setError(null);
    try {
      const result = await importRecipe(file);
      setParsed(result.parsed);
      setIngredientMap(result.ingredientMap);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setParsing(false);
    }
  };

  const handleSave = async (formData: any) => {
    const mealData = {
      ...formData,
      source: "hello_fresh",
      ingredients: formData.ingredients?.map((ing: any) => ({
        ingredientId: ingredientMap[ing.name],
        quantity: ing.quantity,
        unit: ing.unit,
        preparation: ing.preparation,
      })),
    };
    await createMeal(mealData);
    navigate("/recipes");
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Import Recipe</h2>

      {!parsed && !parsing && (
        <FileUpload onFile={handleFile} accept=".pdf,.png,.jpg,.jpeg,.webp" />
      )}

      {parsing && (
        <div className="text-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-500">Parsing recipe with AI... this may take a moment.</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-4">
          {error}
        </div>
      )}

      {parsed && (
        <div>
          <p className="text-sm text-gray-500 mb-4">Review the parsed recipe and make corrections before saving.</p>
          <MealForm initialData={parsed} onSubmit={handleSave} submitLabel="Save to Library" />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Build out RecipeDetail page**

Replace `client/src/pages/RecipeDetail.tsx`:
```tsx
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getMeal, deleteMeal, type Meal } from "../api/meals";

export default function RecipeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meal, setMeal] = useState<Meal | null>(null);

  useEffect(() => {
    getMeal(Number(id)).then(setMeal);
  }, [id]);

  if (!meal) return <p className="text-gray-400">Loading...</p>;

  const instructions = typeof meal.instructions === "string"
    ? JSON.parse(meal.instructions)
    : meal.instructions;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">{meal.name}</h2>
        <button
          onClick={async () => { await deleteMeal(meal.id); navigate("/recipes"); }}
          className="text-red-600 text-sm hover:underline"
        >
          Delete
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          meal.mealType === "batch_prep" ? "bg-purple-100 text-purple-700" : "bg-green-100 text-green-700"
        }`}>
          {meal.mealType === "batch_prep" ? "Batch Prep" : "Cook Fresh"}
        </span>
        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{meal.servings} servings</span>
        {meal.prepTime && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{meal.prepTime}m prep</span>}
        {meal.cookTime && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{meal.cookTime}m cook</span>}
      </div>

      {meal.description && <p className="text-gray-600 mb-6">{meal.description}</p>}

      {meal.calories && (
        <div className="grid grid-cols-4 gap-4 mb-6 bg-gray-50 rounded-lg p-4">
          <div className="text-center">
            <p className="text-lg font-bold text-gray-900">{meal.calories}</p>
            <p className="text-xs text-gray-500">Calories</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-gray-900">{meal.proteinG}g</p>
            <p className="text-xs text-gray-500">Protein</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-gray-900">{meal.carbsG}g</p>
            <p className="text-xs text-gray-500">Carbs</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-gray-900">{meal.fatG}g</p>
            <p className="text-xs text-gray-500">Fat</p>
          </div>
        </div>
      )}

      <h3 className="font-semibold text-gray-900 mb-3">Ingredients</h3>
      <ul className="space-y-1 mb-6">
        {meal.ingredients.map((mi) => (
          <li key={mi.id} className="text-sm text-gray-700">
            {mi.quantity} {mi.unit} {mi.ingredient.name}
            {mi.preparation && <span className="text-gray-400"> ({mi.preparation})</span>}
          </li>
        ))}
      </ul>

      <h3 className="font-semibold text-gray-900 mb-3">Instructions</h3>
      <ol className="space-y-2">
        {(Array.isArray(instructions) ? instructions : []).map((step: string, i: number) => (
          <li key={i} className="text-sm text-gray-700 flex gap-3">
            <span className="font-medium text-gray-400 shrink-0">{i + 1}.</span>
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}
```

- [ ] **Step 8: Verify recipes pages work end-to-end**

Start both dev servers. Navigate to /recipes — should see empty state. Navigate to /recipes/import — should see file upload area.

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "feat: add recipe library, detail, and import pages with meal cards"
```

---

## Task 15: Frontend — Weekly Planner Page

**Files:**
- Create: `client/src/api/plans.ts`
- Create: `client/src/components/PlanDayColumn.tsx`
- Modify: `client/src/pages/Planner.tsx`

- [ ] **Step 1: Implement plans API client**

`client/src/api/plans.ts`:
```ts
import { apiFetch } from "./client";
import type { Meal } from "./meals";

export interface PlannedMeal {
  id: number;
  mealId: number;
  day: string;
  mealSlot: string;
  servings: number;
  isPrep: boolean;
  status: string;
  meal: Meal;
}

export interface WeeklyPlan {
  id: number;
  weekStartDate: string;
  status: string;
  plannedMeals: PlannedMeal[];
}

export const getPlans = () => apiFetch<WeeklyPlan[]>("/plans");
export const getPlan = (id: number) => apiFetch<WeeklyPlan>(`/plans/${id}`);
export const createPlan = (weekStartDate: string) =>
  apiFetch<WeeklyPlan>("/plans", { method: "POST", body: JSON.stringify({ weekStartDate }) });
export const updatePlan = (id: number, data: any) =>
  apiFetch<WeeklyPlan>(`/plans/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const generatePlan = (id: number) =>
  apiFetch<WeeklyPlan>(`/plans/${id}/generate`, { method: "POST" });
export const addPlannedMeal = (planId: number, data: any) =>
  apiFetch<PlannedMeal>(`/plans/${planId}/meals`, { method: "POST", body: JSON.stringify(data) });
export const updatePlannedMeal = (planId: number, mealId: number, data: any) =>
  apiFetch<PlannedMeal>(`/plans/${planId}/meals/${mealId}`, { method: "PUT", body: JSON.stringify(data) });
export const removePlannedMeal = (planId: number, mealId: number) =>
  apiFetch<void>(`/plans/${planId}/meals/${mealId}`, { method: "DELETE" });
```

- [ ] **Step 2: Implement PlanDayColumn component**

`client/src/components/PlanDayColumn.tsx`:
```tsx
import type { PlannedMeal } from "../api/plans";

interface Props {
  day: string;
  meals: PlannedMeal[];
  onMarkCooked: (id: number) => void;
  onSkip: (id: number) => void;
}

const slotOrder = ["breakfast", "lunch", "dinner"];

export default function PlanDayColumn({ day, meals, onMarkCooked, onSkip }: Props) {
  const sorted = [...meals].sort(
    (a, b) => slotOrder.indexOf(a.mealSlot) - slotOrder.indexOf(b.mealSlot),
  );

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 min-w-[180px]">
      <h3 className="font-semibold text-gray-900 capitalize mb-3">{day}</h3>
      {sorted.length === 0 ? (
        <p className="text-xs text-gray-400">No meals planned</p>
      ) : (
        <div className="space-y-3">
          {sorted.map((pm) => (
            <div
              key={pm.id}
              className={`rounded-lg p-3 text-sm ${
                pm.status === "cooked" ? "bg-green-50 border border-green-200" :
                pm.status === "skipped" ? "bg-gray-50 border border-gray-200 opacity-50" :
                "bg-blue-50 border border-blue-200"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-500 uppercase">{pm.mealSlot}</span>
                {pm.isPrep && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">Prep</span>}
              </div>
              <p className="font-medium text-gray-900">{pm.meal.name}</p>
              <p className="text-xs text-gray-400">{pm.servings} servings</p>
              {pm.status === "planned" && (
                <div className="flex gap-2 mt-2">
                  <button onClick={() => onMarkCooked(pm.id)} className="text-xs text-green-600 hover:underline">Cooked</button>
                  <button onClick={() => onSkip(pm.id)} className="text-xs text-gray-400 hover:underline">Skip</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build out Planner page**

Replace `client/src/pages/Planner.tsx`:
```tsx
import { useState, useEffect } from "react";
import {
  getPlans, createPlan, generatePlan, updatePlan,
  updatePlannedMeal, type WeeklyPlan,
} from "../api/plans";
import PlanDayColumn from "../components/PlanDayColumn";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function getNextMonday(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().split("T")[0];
}

export default function Planner() {
  const [plans, setPlans] = useState<WeeklyPlan[]>([]);
  const [activePlan, setActivePlan] = useState<WeeklyPlan | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    getPlans().then((p) => {
      setPlans(p);
      const active = p.find((pl) => pl.status === "active" || pl.status === "draft");
      if (active) setActivePlan(active);
    });
  }, []);

  const handleNewPlan = async () => {
    const plan = await createPlan(getNextMonday());
    setActivePlan(plan);
    setPlans((prev) => [plan, ...prev]);
  };

  const handleGenerate = async () => {
    if (!activePlan) return;
    setGenerating(true);
    try {
      const updated = await generatePlan(activePlan.id);
      setActivePlan(updated);
    } finally {
      setGenerating(false);
    }
  };

  const handleActivate = async () => {
    if (!activePlan) return;
    const updated = await updatePlan(activePlan.id, { status: "active" });
    setActivePlan(updated);
  };

  const handleMarkCooked = async (plannedMealId: number) => {
    if (!activePlan) return;
    await updatePlannedMeal(activePlan.id, plannedMealId, { status: "cooked" });
    const plans = await getPlans();
    const updated = plans.find((p) => p.id === activePlan.id);
    if (updated) setActivePlan(updated);
  };

  const handleSkip = async (plannedMealId: number) => {
    if (!activePlan) return;
    await updatePlannedMeal(activePlan.id, plannedMealId, { status: "skipped" });
    const plans = await getPlans();
    const updated = plans.find((p) => p.id === activePlan.id);
    if (updated) setActivePlan(updated);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Weekly Planner</h2>
        <div className="flex gap-2">
          {!activePlan && (
            <button onClick={handleNewPlan} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
              Plan This Week
            </button>
          )}
          {activePlan?.status === "draft" && (
            <>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
              >
                {generating ? "Generating..." : "Auto-Generate"}
              </button>
              <button onClick={handleActivate} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700">
                Confirm Plan
              </button>
            </>
          )}
        </div>
      </div>

      {!activePlan ? (
        <p className="text-gray-500 text-center py-12">No active plan. Create one to get started!</p>
      ) : (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${
              activePlan.status === "draft" ? "bg-yellow-100 text-yellow-700" :
              activePlan.status === "active" ? "bg-green-100 text-green-700" :
              "bg-gray-100 text-gray-600"
            }`}>
              {activePlan.status}
            </span>
            <span className="text-sm text-gray-500">
              Week of {new Date(activePlan.weekStartDate).toLocaleDateString()}
            </span>
          </div>

          <div className="grid grid-cols-7 gap-3 overflow-x-auto">
            {DAYS.map((day) => (
              <PlanDayColumn
                key={day}
                day={day}
                meals={activePlan.plannedMeals.filter((m) => m.day === day)}
                onMarkCooked={handleMarkCooked}
                onSkip={handleSkip}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify planner page renders**

Navigate to /planner — should see empty state with "Plan This Week" button.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add weekly planner page with AI generation and day columns"
```

---

## Task 16: Frontend — Pantry Page

**Files:**
- Create: `client/src/api/pantry.ts`
- Create: `client/src/api/ingredients.ts`
- Create: `client/src/components/PantryItemRow.tsx`
- Modify: `client/src/pages/Pantry.tsx`

- [ ] **Step 1: Implement pantry and ingredient API clients**

`client/src/api/ingredients.ts`:
```ts
import { apiFetch } from "./client";

export interface Ingredient {
  id: number;
  name: string;
  category: string;
  defaultUnit: string;
}

export const getIngredients = () => apiFetch<Ingredient[]>("/ingredients");
export const createIngredient = (data: { name: string; category: string; defaultUnit: string }) =>
  apiFetch<Ingredient>("/ingredients", { method: "POST", body: JSON.stringify(data) });
```

`client/src/api/pantry.ts`:
```ts
import { apiFetch } from "./client";
import type { Ingredient } from "./ingredients";

export interface PantryItem {
  id: number;
  ingredientId: number;
  quantity: number;
  unit: string;
  location: string;
  expirationDate: string | null;
  ingredient: Ingredient;
}

export const getPantry = () => apiFetch<PantryItem[]>("/pantry");
export const addPantryItem = (data: any) =>
  apiFetch<PantryItem>("/pantry", { method: "POST", body: JSON.stringify(data) });
export const updatePantryItem = (id: number, data: any) =>
  apiFetch<PantryItem>(`/pantry/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deletePantryItem = (id: number) =>
  apiFetch<void>(`/pantry/${id}`, { method: "DELETE" });
```

- [ ] **Step 2: Implement PantryItemRow component**

`client/src/components/PantryItemRow.tsx`:
```tsx
import { useState } from "react";
import type { PantryItem } from "../api/pantry";

interface Props {
  item: PantryItem;
  onUpdate: (id: number, data: any) => void;
  onDelete: (id: number) => void;
}

export default function PantryItemRow({ item, onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(item.quantity);

  const locationColors: Record<string, string> = {
    fridge: "bg-blue-100 text-blue-700",
    freezer: "bg-cyan-100 text-cyan-700",
    pantry: "bg-amber-100 text-amber-700",
  };

  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100">
      <div className="flex items-center gap-3">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${locationColors[item.location] || "bg-gray-100 text-gray-600"}`}>
          {item.location}
        </span>
        <span className="text-sm font-medium text-gray-900">{item.ingredient.name}</span>
      </div>
      <div className="flex items-center gap-3">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
              min={0}
              step={0.1}
            />
            <button
              onClick={() => { onUpdate(item.id, { quantity: qty }); setEditing(false); }}
              className="text-xs text-blue-600 hover:underline"
            >Save</button>
            <button onClick={() => setEditing(false)} className="text-xs text-gray-400 hover:underline">Cancel</button>
          </div>
        ) : (
          <>
            <span className="text-sm text-gray-600">{item.quantity} {item.unit}</span>
            <button onClick={() => setEditing(true)} className="text-xs text-blue-600 hover:underline">Edit</button>
            <button onClick={() => onDelete(item.id)} className="text-xs text-red-500 hover:underline">Remove</button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build out Pantry page**

Replace `client/src/pages/Pantry.tsx`:
```tsx
import { useState, useEffect } from "react";
import { getPantry, addPantryItem, updatePantryItem, deletePantryItem, type PantryItem } from "../api/pantry";
import { getIngredients, type Ingredient } from "../api/ingredients";
import PantryItemRow from "../components/PantryItemRow";

export default function Pantry() {
  const [items, setItems] = useState<PantryItem[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newItem, setNewItem] = useState({ ingredientId: 0, quantity: 1, unit: "", location: "pantry" });

  const load = () => {
    getPantry().then(setItems);
    getIngredients().then(setIngredients);
  };

  useEffect(load, []);

  const handleAdd = async () => {
    if (!newItem.ingredientId) return;
    const ing = ingredients.find((i) => i.id === newItem.ingredientId);
    await addPantryItem({ ...newItem, unit: newItem.unit || ing?.defaultUnit || "count" });
    setShowAdd(false);
    setNewItem({ ingredientId: 0, quantity: 1, unit: "", location: "pantry" });
    load();
  };

  const grouped = {
    fridge: items.filter((i) => i.location === "fridge"),
    freezer: items.filter((i) => i.location === "freezer"),
    pantry: items.filter((i) => i.location === "pantry"),
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Pantry</h2>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          Add Item
        </button>
      </div>

      {showAdd && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Ingredient</label>
            <select
              value={newItem.ingredientId}
              onChange={(e) => setNewItem({ ...newItem, ingredientId: Number(e.target.value) })}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value={0}>Select...</option>
              {ingredients.map((ing) => (
                <option key={ing.id} value={ing.id}>{ing.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Quantity</label>
            <input
              type="number"
              value={newItem.quantity}
              onChange={(e) => setNewItem({ ...newItem, quantity: Number(e.target.value) })}
              className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              min={0}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Location</label>
            <select
              value={newItem.location}
              onChange={(e) => setNewItem({ ...newItem, location: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="fridge">Fridge</option>
              <option value="freezer">Freezer</option>
              <option value="pantry">Pantry</option>
            </select>
          </div>
          <button onClick={handleAdd} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700">
            Add
          </button>
        </div>
      )}

      {Object.entries(grouped).map(([location, locationItems]) => (
        <div key={location} className="mb-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 capitalize">{location}</h3>
          {locationItems.length === 0 ? (
            <p className="text-xs text-gray-400">Nothing here</p>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 px-4">
              {locationItems.map((item) => (
                <PantryItemRow
                  key={item.id}
                  item={item}
                  onUpdate={async (id, data) => { await updatePantryItem(id, data); load(); }}
                  onDelete={async (id) => { await deletePantryItem(id); load(); }}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Verify pantry page works**

Navigate to /pantry — should see grouped sections (fridge/freezer/pantry) with add button.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add pantry page with grouped locations, add/edit/remove items"
```

---

## Task 17: Frontend — Shopping List Page

**Files:**
- Create: `client/src/api/shopping.ts`
- Create: `client/src/components/ShoppingItemRow.tsx`
- Modify: `client/src/pages/ShoppingList.tsx`

- [ ] **Step 1: Implement shopping API client**

`client/src/api/shopping.ts`:
```ts
import { apiFetch } from "./client";
import type { Ingredient } from "./ingredients";

export interface ShoppingItem {
  id: number;
  quantityNeeded: number;
  quantityOnHand: number;
  quantityToBuy: number;
  checked: boolean;
  ingredient: Ingredient;
}

export const getShoppingList = (planId: number) =>
  apiFetch<ShoppingItem[]>(`/shopping/${planId}`);
export const generateShoppingList = (planId: number) =>
  apiFetch<ShoppingItem[]>(`/shopping/generate/${planId}`, { method: "POST" });
export const toggleItem = (id: number, checked: boolean) =>
  apiFetch<ShoppingItem>(`/shopping/item/${id}`, { method: "PUT", body: JSON.stringify({ checked }) });
```

- [ ] **Step 2: Implement ShoppingItemRow component**

`client/src/components/ShoppingItemRow.tsx`:
```tsx
import type { ShoppingItem } from "../api/shopping";

interface Props {
  item: ShoppingItem;
  onToggle: (id: number, checked: boolean) => void;
}

export default function ShoppingItemRow({ item, onToggle }: Props) {
  return (
    <div
      className={`flex items-center justify-between py-3 border-b border-gray-100 ${item.checked ? "opacity-50" : ""}`}
    >
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={item.checked}
          onChange={() => onToggle(item.id, !item.checked)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600"
        />
        <span className={`text-sm ${item.checked ? "line-through text-gray-400" : "text-gray-900"}`}>
          {item.ingredient.name}
        </span>
        <span className="text-xs text-gray-400">{item.ingredient.category}</span>
      </div>
      <div className="text-sm text-gray-600">
        <span className="font-medium">{item.quantityToBuy}</span>
        <span className="text-gray-400"> {item.ingredient.defaultUnit}</span>
        {item.quantityOnHand > 0 && (
          <span className="text-xs text-gray-400 ml-2">(have {item.quantityOnHand})</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build out ShoppingList page**

Replace `client/src/pages/ShoppingList.tsx`:
```tsx
import { useState, useEffect } from "react";
import { getPlans, type WeeklyPlan } from "../api/plans";
import { getShoppingList, generateShoppingList, toggleItem, type ShoppingItem } from "../api/shopping";
import ShoppingItemRow from "../components/ShoppingItemRow";

export default function ShoppingList() {
  const [activePlan, setActivePlan] = useState<WeeklyPlan | null>(null);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    getPlans().then((plans) => {
      const active = plans.find((p) => p.status === "active");
      if (active) {
        setActivePlan(active);
        getShoppingList(active.id).then(setItems);
      }
    });
  }, []);

  const handleGenerate = async () => {
    if (!activePlan) return;
    setGenerating(true);
    try {
      const list = await generateShoppingList(activePlan.id);
      setItems(list);
    } finally {
      setGenerating(false);
    }
  };

  const handleToggle = async (id: number, checked: boolean) => {
    await toggleItem(id, checked);
    if (activePlan) {
      const updated = await getShoppingList(activePlan.id);
      setItems(updated);
    }
  };

  const unchecked = items.filter((i) => !i.checked && i.quantityToBuy > 0);
  const checked = items.filter((i) => i.checked);
  const alreadyHave = items.filter((i) => !i.checked && i.quantityToBuy === 0);

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Shopping List</h2>
        {activePlan && (
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {generating ? "Generating..." : items.length ? "Regenerate" : "Generate List"}
          </button>
        )}
      </div>

      {!activePlan && (
        <p className="text-gray-500 text-center py-12">No active meal plan. Create one in the Planner first.</p>
      )}

      {unchecked.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 px-4 mb-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide py-3">To Buy</h3>
          {unchecked.map((item) => (
            <ShoppingItemRow key={item.id} item={item} onToggle={handleToggle} />
          ))}
        </div>
      )}

      {alreadyHave.length > 0 && (
        <div className="bg-green-50 rounded-xl border border-green-200 px-4 mb-6">
          <h3 className="text-sm font-semibold text-green-600 uppercase tracking-wide py-3">Already Have</h3>
          {alreadyHave.map((item) => (
            <ShoppingItemRow key={item.id} item={item} onToggle={handleToggle} />
          ))}
        </div>
      )}

      {checked.length > 0 && (
        <div className="opacity-60 bg-white rounded-xl border border-gray-200 px-4">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide py-3">Done</h3>
          {checked.map((item) => (
            <ShoppingItemRow key={item.id} item={item} onToggle={handleToggle} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify shopping list page works**

Navigate to /shopping — should show "No active meal plan" or generate button if a plan exists.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add shopping list page with generate, toggle, and grouped display"
```

---

## Task 18: Frontend — Chat Page

**Files:**
- Create: `client/src/api/chat.ts`
- Create: `client/src/components/ChatMessage.tsx`
- Modify: `client/src/pages/Chat.tsx`

- [ ] **Step 1: Implement chat API client**

`client/src/api/chat.ts`:
```ts
export interface ChatAction {
  type: string;
  params: Record<string, any>;
}

export interface ChatResponse {
  message: string;
  actions: ChatAction[];
  applied: boolean[];
}

export async function sendMessage(message: string): Promise<ChatResponse> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error("Chat failed");
  return res.json();
}
```

- [ ] **Step 2: Implement ChatMessage component**

`client/src/components/ChatMessage.tsx`:
```tsx
interface Props {
  role: "user" | "assistant";
  content: string;
  actions?: { type: string; applied: boolean }[];
}

export default function ChatMessage({ role, content, actions }: Props) {
  return (
    <div className={`flex ${role === "user" ? "justify-end" : "justify-start"} mb-4`}>
      <div className={`max-w-[75%] rounded-2xl px-4 py-3 ${
        role === "user"
          ? "bg-blue-600 text-white"
          : "bg-white border border-gray-200 text-gray-900"
      }`}>
        <p className="text-sm whitespace-pre-wrap">{content}</p>
        {actions && actions.length > 0 && actions[0].type !== "none" && (
          <div className="mt-2 pt-2 border-t border-gray-100">
            {actions.map((a, i) => (
              <span key={i} className={`text-xs ${a.applied ? "text-green-600" : "text-red-500"}`}>
                {a.applied ? "Applied" : "Failed"}: {a.type}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build out Chat page**

Replace `client/src/pages/Chat.tsx`:
```tsx
import { useState, useRef, useEffect } from "react";
import { sendMessage, type ChatResponse } from "../api/chat";
import ChatMessage from "../components/ChatMessage";

interface Message {
  role: "user" | "assistant";
  content: string;
  actions?: { type: string; applied: boolean }[];
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hey! I'm your meal planning assistant. Ask me to swap meals, update your plan, check what's in the fridge, or anything else." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    try {
      const res: ChatResponse = await sendMessage(userMsg);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.message,
          actions: res.actions.map((a, i) => ({ type: a.type, applied: res.applied[i] })),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, something went wrong. Try again?" },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">Chat</h2>

      <div className="flex-1 overflow-y-auto mb-4 pr-2">
        {messages.map((msg, i) => (
          <ChatMessage key={i} {...msg} />
        ))}
        {loading && (
          <div className="flex justify-start mb-4">
            <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }} />
                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="e.g. Swap Tuesday dinner for something with chicken..."
          className="flex-1 rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={loading}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="bg-blue-600 text-white px-6 py-3 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify chat page works**

Navigate to /chat — should see welcome message and input field.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add chat page with AI assistant messaging interface"
```

---

## Task 19: Frontend — Dashboard Page

**Files:**
- Modify: `client/src/pages/Dashboard.tsx`

- [ ] **Step 1: Build out Dashboard page**

Replace `client/src/pages/Dashboard.tsx`:
```tsx
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getPlans, updatePlannedMeal, type WeeklyPlan, type PlannedMeal } from "../api/plans";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function getTodaysMeals(plan: WeeklyPlan): PlannedMeal[] {
  const today = DAYS[new Date().getDay()];
  return plan.plannedMeals.filter((m) => m.day === today);
}

function getWeekNutrition(plan: WeeklyPlan) {
  let calories = 0, protein = 0, carbs = 0, fat = 0;
  for (const pm of plan.plannedMeals) {
    if (pm.status === "skipped") continue;
    const scale = pm.servings / pm.meal.servings;
    calories += (pm.meal.calories || 0) * scale;
    protein += (pm.meal.proteinG || 0) * scale;
    carbs += (pm.meal.carbsG || 0) * scale;
    fat += (pm.meal.fatG || 0) * scale;
  }
  return { calories: Math.round(calories), protein: Math.round(protein), carbs: Math.round(carbs), fat: Math.round(fat) };
}

export default function Dashboard() {
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);

  const load = () => {
    getPlans().then((plans) => {
      const active = plans.find((p) => p.status === "active");
      if (active) setPlan(active);
    });
  };

  useEffect(load, []);

  const todaysMeals = plan ? getTodaysMeals(plan) : [];
  const nutrition = plan ? getWeekNutrition(plan) : null;

  const handleCooked = async (pm: PlannedMeal) => {
    if (!plan) return;
    await updatePlannedMeal(plan.id, pm.id, { status: "cooked" });
    load();
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h2>

      {!plan ? (
        <div className="text-center py-12">
          <p className="text-gray-500 mb-4">No active meal plan this week.</p>
          <Link to="/planner" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
            Plan This Week
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Today's Meals</h3>
            {todaysMeals.length === 0 ? (
              <p className="text-gray-500 text-sm">Nothing planned for today.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {todaysMeals.map((pm) => (
                  <div key={pm.id} className={`bg-white rounded-xl border p-4 ${
                    pm.status === "cooked" ? "border-green-200 bg-green-50" : "border-gray-200"
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-gray-500 uppercase">{pm.mealSlot}</span>
                      {pm.isPrep && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">From Prep</span>}
                    </div>
                    <h4 className="font-semibold text-gray-900">{pm.meal.name}</h4>
                    <p className="text-sm text-gray-500 mt-1">{pm.servings} servings</p>
                    {pm.meal.calories && (
                      <p className="text-xs text-gray-400 mt-1">{pm.meal.calories} cal per serving</p>
                    )}
                    {pm.status === "planned" && (
                      <button
                        onClick={() => handleCooked(pm)}
                        className="mt-3 text-sm text-green-600 font-medium hover:underline"
                      >
                        Mark as Cooked
                      </button>
                    )}
                    {pm.status === "cooked" && (
                      <span className="mt-3 text-sm text-green-600 font-medium block">Cooked!</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {nutrition && (
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-3">This Week's Nutrition</h3>
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900">{nutrition.calories}</p>
                  <p className="text-xs text-gray-500">Total Calories</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900">{nutrition.protein}g</p>
                  <p className="text-xs text-gray-500">Protein</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900">{nutrition.carbs}g</p>
                  <p className="text-xs text-gray-500">Carbs</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900">{nutrition.fat}g</p>
                  <p className="text-xs text-gray-500">Fat</p>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <Link to="/planner" className="text-sm text-blue-600 hover:underline">View Full Plan</Link>
            <Link to="/shopping" className="text-sm text-blue-600 hover:underline">Shopping List</Link>
            <Link to="/chat" className="text-sm text-blue-600 hover:underline">Chat with Assistant</Link>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify dashboard works**

Navigate to / — should show today's meals if a plan is active, or prompt to create one.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: add dashboard with today's meals, nutrition summary, and quick links"
```

---

## Task 20: Calendar Sync from Planner & Final Wiring

**Files:**
- Modify: `client/src/pages/Planner.tsx` — add calendar sync button
- Create: `client/src/api/calendar.ts`

- [ ] **Step 1: Implement calendar API client**

`client/src/api/calendar.ts`:
```ts
import { apiFetch } from "./client";

export const syncCalendar = (planId: number) =>
  apiFetch<{ synced: number }>(`/calendar/sync/${planId}`, { method: "POST" });
```

- [ ] **Step 2: Add calendar sync to Planner page**

Add import at top of `client/src/pages/Planner.tsx`:
```ts
import { syncCalendar } from "../api/calendar";
```

Add state:
```ts
const [syncing, setSyncing] = useState(false);
```

Add handler:
```ts
const handleSyncCalendar = async () => {
  if (!activePlan) return;
  setSyncing(true);
  try {
    await syncCalendar(activePlan.id);
  } finally {
    setSyncing(false);
  }
};
```

Add button next to "Confirm Plan" button (inside the `activePlan?.status === "draft"` block), and also add a sync button when status is "active":
```tsx
{activePlan?.status === "active" && (
  <button
    onClick={handleSyncCalendar}
    disabled={syncing}
    className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
  >
    {syncing ? "Syncing..." : "Sync to Calendar"}
  </button>
)}
```

- [ ] **Step 3: Verify calendar auth flow works**

1. Set up Google Cloud OAuth credentials and add to `server/.env`
2. Navigate to http://localhost:3001/api/calendar/auth — should redirect to Google
3. After auth, tokens saved — sync button on planner should create calendar events

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: add calendar sync button to planner and wire up Google Calendar auth"
```

---

## Task 21: Seed Data & End-to-End Verification

**Files:**
- Create: `server/src/prisma/seed.ts`

- [ ] **Step 1: Write seed script with sample ingredients**

`server/src/prisma/seed.ts`:
```ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const commonIngredients = [
  { name: "chicken breast", category: "protein" as const, defaultUnit: "lb" },
  { name: "ground beef", category: "protein" as const, defaultUnit: "lb" },
  { name: "salmon", category: "protein" as const, defaultUnit: "oz" },
  { name: "garlic", category: "produce" as const, defaultUnit: "cloves" },
  { name: "onion", category: "produce" as const, defaultUnit: "count" },
  { name: "bell pepper", category: "produce" as const, defaultUnit: "count" },
  { name: "broccoli", category: "produce" as const, defaultUnit: "cups" },
  { name: "rice", category: "grain" as const, defaultUnit: "cups" },
  { name: "pasta", category: "grain" as const, defaultUnit: "oz" },
  { name: "olive oil", category: "pantry_staple" as const, defaultUnit: "tbsp" },
  { name: "salt", category: "spice" as const, defaultUnit: "tsp" },
  { name: "black pepper", category: "spice" as const, defaultUnit: "tsp" },
  { name: "soy sauce", category: "condiment" as const, defaultUnit: "tbsp" },
  { name: "butter", category: "dairy" as const, defaultUnit: "tbsp" },
  { name: "milk", category: "dairy" as const, defaultUnit: "cups" },
  { name: "cheddar cheese", category: "dairy" as const, defaultUnit: "cups" },
  { name: "eggs", category: "protein" as const, defaultUnit: "count" },
  { name: "tomato", category: "produce" as const, defaultUnit: "count" },
  { name: "spinach", category: "produce" as const, defaultUnit: "cups" },
  { name: "lemon", category: "produce" as const, defaultUnit: "count" },
];

async function main() {
  console.log("Seeding common ingredients...");
  for (const ing of commonIngredients) {
    await prisma.ingredient.upsert({
      where: { name: ing.name },
      update: {},
      create: ing,
    });
  }
  console.log(`Seeded ${commonIngredients.length} ingredients.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
```

- [ ] **Step 2: Run seed**

```bash
cd server && npm run db:seed
```

Expected: "Seeded 20 ingredients."

- [ ] **Step 3: End-to-end smoke test**

Run through the full flow:
1. `npm run dev` — both servers start
2. Navigate to /recipes/import — upload a Hello Fresh PDF
3. Review parsed recipe, save
4. Navigate to /pantry — add some items
5. Navigate to /planner — create plan, auto-generate, confirm
6. Navigate to /shopping — generate list, verify pantry subtraction
7. Navigate to /chat — "What's for dinner tonight?"
8. Dashboard — verify today's meals show up

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: add seed data with common ingredients and verify end-to-end flow"
```
