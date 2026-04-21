-- Migration 004: drop meal_type column and enum (stage 2 of multi cook-style rollout).
-- Prerequisite: migration 003 has been applied and all consumers read/write
-- can_batch + can_fresh exclusively.

ALTER TABLE "meals" DROP COLUMN "meal_type";
DROP TYPE "MealType";
