-- Migration 001: Initial schema
-- Meal planning app database setup

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE "MealType" AS ENUM (
  'batch_prep',
  'cook_fresh'
);

CREATE TYPE "MealSource" AS ENUM (
  'hello_fresh',
  'manual'
);

CREATE TYPE "PantryLocation" AS ENUM (
  'fridge',
  'freezer',
  'pantry'
);

CREATE TYPE "PlanStatus" AS ENUM (
  'draft',
  'active',
  'completed'
);

CREATE TYPE "PlannedMealStatus" AS ENUM (
  'planned',
  'cooked',
  'skipped',
  'swapped'
);

CREATE TYPE "DayOfWeek" AS ENUM (
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday'
);

CREATE TYPE "MealSlot" AS ENUM (
  'breakfast',
  'lunch',
  'dinner'
);

CREATE TYPE "IngredientCategory" AS ENUM (
  'produce',
  'protein',
  'dairy',
  'pantry_staple',
  'grain',
  'spice',
  'condiment',
  'frozen',
  'other'
);

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE "meals" (
  "id"           SERIAL        PRIMARY KEY,
  "name"         TEXT          NOT NULL,
  "description"  TEXT,
  "source"       "MealSource"  NOT NULL DEFAULT 'manual',
  "source_url"   TEXT,
  "meal_type"    "MealType"    NOT NULL,
  "servings"     INTEGER       NOT NULL DEFAULT 2,
  "prep_time"    INTEGER,
  "cook_time"    INTEGER,
  "tags"         TEXT[]        NOT NULL DEFAULT '{}',
  "instructions" JSONB         NOT NULL DEFAULT '[]',
  "image_url"    TEXT,

  -- Nutrition (per original serving)
  "calories"     INTEGER,
  "protein_g"    DOUBLE PRECISION,
  "carbs_g"      DOUBLE PRECISION,
  "fat_g"        DOUBLE PRECISION,
  "fiber_g"      DOUBLE PRECISION,
  "sodium_mg"    DOUBLE PRECISION,

  "created_at"   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updated_at"   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE "ingredients" (
  "id"           SERIAL               PRIMARY KEY,
  "name"         TEXT                 NOT NULL,
  "category"     "IngredientCategory" NOT NULL DEFAULT 'other',
  "default_unit" TEXT                 NOT NULL DEFAULT 'count',

  CONSTRAINT "ingredients_name_key" UNIQUE ("name")
);

CREATE TABLE "meal_ingredients" (
  "id"            SERIAL  PRIMARY KEY,
  "meal_id"       INTEGER NOT NULL,
  "ingredient_id" INTEGER NOT NULL,
  "quantity"      DOUBLE PRECISION NOT NULL,
  "unit"          TEXT    NOT NULL,
  "preparation"   TEXT,

  CONSTRAINT "meal_ingredients_meal_id_ingredient_id_key" UNIQUE ("meal_id", "ingredient_id"),
  CONSTRAINT "meal_ingredients_meal_id_fkey"
    FOREIGN KEY ("meal_id") REFERENCES "meals" ("id") ON DELETE CASCADE,
  CONSTRAINT "meal_ingredients_ingredient_id_fkey"
    FOREIGN KEY ("ingredient_id") REFERENCES "ingredients" ("id")
);

CREATE TABLE "pantry_items" (
  "id"              SERIAL           PRIMARY KEY,
  "ingredient_id"   INTEGER          NOT NULL,
  "quantity"        DOUBLE PRECISION NOT NULL,
  "unit"            TEXT             NOT NULL,
  "location"        "PantryLocation" NOT NULL DEFAULT 'pantry',
  "expiration_date" TIMESTAMPTZ,

  CONSTRAINT "pantry_items_ingredient_id_fkey"
    FOREIGN KEY ("ingredient_id") REFERENCES "ingredients" ("id")
);

CREATE TABLE "weekly_plans" (
  "id"              SERIAL       PRIMARY KEY,
  "week_start_date" DATE         NOT NULL,
  "status"          "PlanStatus" NOT NULL DEFAULT 'draft',
  "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updated_at"      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE "planned_meals" (
  "id"                SERIAL              PRIMARY KEY,
  "plan_id"           INTEGER             NOT NULL,
  "meal_id"           INTEGER             NOT NULL,
  "day"               "DayOfWeek"         NOT NULL,
  "meal_slot"         "MealSlot"          NOT NULL,
  "servings"          INTEGER             NOT NULL DEFAULT 2,
  "is_prep"           BOOLEAN             NOT NULL DEFAULT FALSE,
  "status"            "PlannedMealStatus" NOT NULL DEFAULT 'planned',
  "calendar_event_id" TEXT,

  CONSTRAINT "planned_meals_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "weekly_plans" ("id") ON DELETE CASCADE,
  CONSTRAINT "planned_meals_meal_id_fkey"
    FOREIGN KEY ("meal_id") REFERENCES "meals" ("id")
);

CREATE TABLE "shopping_items" (
  "id"               SERIAL           PRIMARY KEY,
  "plan_id"          INTEGER          NOT NULL,
  "ingredient_id"    INTEGER          NOT NULL,
  "quantity_needed"  DOUBLE PRECISION NOT NULL,
  "quantity_on_hand" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "quantity_to_buy"  DOUBLE PRECISION NOT NULL,
  "checked"          BOOLEAN          NOT NULL DEFAULT FALSE,

  CONSTRAINT "shopping_items_plan_id_ingredient_id_key" UNIQUE ("plan_id", "ingredient_id"),
  CONSTRAINT "shopping_items_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "weekly_plans" ("id") ON DELETE CASCADE,
  CONSTRAINT "shopping_items_ingredient_id_fkey"
    FOREIGN KEY ("ingredient_id") REFERENCES "ingredients" ("id")
);

-- ============================================================
-- INDEXES
-- ============================================================

-- meals: look up by source and meal_type
CREATE INDEX "meals_source_idx"    ON "meals" ("source");
CREATE INDEX "meals_meal_type_idx" ON "meals" ("meal_type");

-- meal_ingredients: look up all ingredients for a meal (covered by unique constraint)
-- and all meals that use an ingredient
CREATE INDEX "meal_ingredients_ingredient_id_idx" ON "meal_ingredients" ("ingredient_id");

-- pantry_items: look up by ingredient and location
CREATE INDEX "pantry_items_ingredient_id_idx" ON "pantry_items" ("ingredient_id");
CREATE INDEX "pantry_items_location_idx"       ON "pantry_items" ("location");
CREATE INDEX "pantry_items_expiration_date_idx" ON "pantry_items" ("expiration_date");

-- weekly_plans: find plans by status and start date
CREATE INDEX "weekly_plans_status_idx"          ON "weekly_plans" ("status");
CREATE INDEX "weekly_plans_week_start_date_idx" ON "weekly_plans" ("week_start_date");

-- planned_meals: look up meals within a plan by day/slot
CREATE INDEX "planned_meals_plan_id_idx"        ON "planned_meals" ("plan_id");
CREATE INDEX "planned_meals_meal_id_idx"        ON "planned_meals" ("meal_id");
CREATE INDEX "planned_meals_plan_day_slot_idx"  ON "planned_meals" ("plan_id", "day", "meal_slot");

-- shopping_items: look up items by plan (covered by unique constraint)
-- and items by ingredient across plans
CREATE INDEX "shopping_items_ingredient_id_idx" ON "shopping_items" ("ingredient_id");
CREATE INDEX "shopping_items_checked_idx"       ON "shopping_items" ("plan_id", "checked");

-- ============================================================
-- updated_at TRIGGER (keeps updated_at current without Prisma middleware)
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "meals_updated_at"
  BEFORE UPDATE ON "meals"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER "weekly_plans_updated_at"
  BEFORE UPDATE ON "weekly_plans"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
