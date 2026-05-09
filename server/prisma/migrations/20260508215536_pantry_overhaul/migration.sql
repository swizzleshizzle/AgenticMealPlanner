/*
  Warnings:

  - Added the required column `updated_at` to the `pantry_items` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "meal_ingredients" DROP CONSTRAINT "meal_ingredients_ingredient_id_fkey";

-- DropForeignKey
ALTER TABLE "meal_ingredients" DROP CONSTRAINT "meal_ingredients_meal_id_fkey";

-- DropForeignKey
ALTER TABLE "pantry_items" DROP CONSTRAINT "pantry_items_ingredient_id_fkey";

-- DropForeignKey
ALTER TABLE "planned_meals" DROP CONSTRAINT "planned_meals_meal_id_fkey";

-- DropForeignKey
ALTER TABLE "planned_meals" DROP CONSTRAINT "planned_meals_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "receipt_items" DROP CONSTRAINT "receipt_items_ingredient_id_fkey";

-- DropForeignKey
ALTER TABLE "receipt_items" DROP CONSTRAINT "receipt_items_receipt_id_fkey";

-- DropForeignKey
ALTER TABLE "shopping_items" DROP CONSTRAINT "shopping_items_ingredient_id_fkey";

-- DropForeignKey
ALTER TABLE "shopping_items" DROP CONSTRAINT "shopping_items_plan_id_fkey";

-- DropIndex
DROP INDEX "meal_ingredients_ingredient_id_idx";

-- DropIndex
DROP INDEX "meals_source_idx";

-- DropIndex
DROP INDEX "pantry_items_expiration_date_idx";

-- DropIndex
DROP INDEX "pantry_items_ingredient_id_idx";

-- DropIndex
DROP INDEX "pantry_items_location_idx";

-- DropIndex
DROP INDEX "planned_meals_meal_id_idx";

-- DropIndex
DROP INDEX "planned_meals_plan_day_slot_idx";

-- DropIndex
DROP INDEX "planned_meals_plan_id_idx";

-- DropIndex
DROP INDEX "receipt_items_ingredient_id_idx";

-- DropIndex
DROP INDEX "receipt_items_receipt_id_idx";

-- DropIndex
DROP INDEX "receipts_trip_date_idx";

-- DropIndex
DROP INDEX "shopping_items_checked_idx";

-- DropIndex
DROP INDEX "shopping_items_ingredient_id_idx";

-- DropIndex
DROP INDEX "weekly_plans_status_idx";

-- DropIndex
DROP INDEX "weekly_plans_week_start_date_idx";

-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN     "default_location" "PantryLocation",
ADD COLUMN     "density_g_per_ml" DOUBLE PRECISION,
ADD COLUMN     "grams_per_count" DOUBLE PRECISION,
ADD COLUMN     "is_one_off" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "low_stock_threshold" DOUBLE PRECISION,
ADD COLUMN     "low_stock_unit" TEXT,
ADD COLUMN     "shelf_life_freezer_days" INTEGER,
ADD COLUMN     "shelf_life_fridge_days" INTEGER,
ADD COLUMN     "shelf_life_pantry_days" INTEGER;

-- AlterTable
ALTER TABLE "meals" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "pantry_items" ADD COLUMN     "consumed_at" TIMESTAMP(3),
ADD COLUMN     "cost_at_purchase" DECIMAL(10,2),
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "purchase_date" TIMESTAMP(3),
ADD COLUMN     "receipt_item_id" INTEGER,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
ALTER COLUMN "expiration_date" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "weekly_plans" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "pantry_items_ingredient_id_location_consumed_at_idx" ON "pantry_items"("ingredient_id", "location", "consumed_at");

-- CreateIndex
CREATE INDEX "pantry_items_consumed_at_idx" ON "pantry_items"("consumed_at");

-- AddForeignKey
ALTER TABLE "meal_ingredients" ADD CONSTRAINT "meal_ingredients_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "meals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_ingredients" ADD CONSTRAINT "meal_ingredients_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_receipt_item_id_fkey" FOREIGN KEY ("receipt_item_id") REFERENCES "receipt_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_meals" ADD CONSTRAINT "planned_meals_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "weekly_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_meals" ADD CONSTRAINT "planned_meals_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "meals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "weekly_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
