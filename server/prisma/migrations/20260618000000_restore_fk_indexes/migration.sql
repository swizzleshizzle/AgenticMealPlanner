-- Restore foreign-key / lookup indexes dropped by 20260508215536_pantry_overhaul
-- and never recreated, plus a partial unique enforcing one default variant
-- per recipe family. Index names follow Prisma's <table>_<cols>_idx convention
-- so schema.prisma and the database stay consistent.

-- meal_ingredients
CREATE INDEX IF NOT EXISTS "meal_ingredients_ingredient_id_idx" ON "meal_ingredients"("ingredient_id");

-- planned_meals
CREATE INDEX IF NOT EXISTS "planned_meals_plan_id_idx" ON "planned_meals"("plan_id");
CREATE INDEX IF NOT EXISTS "planned_meals_meal_id_idx" ON "planned_meals"("meal_id");
CREATE INDEX IF NOT EXISTS "planned_meals_plan_id_day_meal_slot_idx" ON "planned_meals"("plan_id", "day", "meal_slot");

-- shopping_items
CREATE INDEX IF NOT EXISTS "shopping_items_ingredient_id_idx" ON "shopping_items"("ingredient_id");

-- receipt_items
CREATE INDEX IF NOT EXISTS "receipt_items_receipt_id_idx" ON "receipt_items"("receipt_id");
CREATE INDEX IF NOT EXISTS "receipt_items_ingredient_id_idx" ON "receipt_items"("ingredient_id");

-- pantry_items: index the receipt_item_id FK added in the pantry overhaul
CREATE INDEX IF NOT EXISTS "pantry_items_receipt_item_id_idx" ON "pantry_items"("receipt_item_id");

-- Enforce one default, non-archived variant per recipe family (partial unique;
-- not expressible in schema.prisma, so kept as raw SQL).
-- NOTE: if a recipe family currently has >1 default non-archived row, this will
-- fail until the data is de-duplicated.
CREATE UNIQUE INDEX IF NOT EXISTS "meals_one_default_per_recipe_idx"
  ON "meals" ("recipe_id")
  WHERE "is_default" AND "archived_at" IS NULL;
