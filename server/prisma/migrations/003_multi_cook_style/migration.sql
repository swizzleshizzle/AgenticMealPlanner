-- Migration 003: multi cook-style capability columns (stage 1)
-- Adds can_batch + can_fresh and backfills from the existing meal_type enum.
-- meal_type column is retained for rollback safety; stage 2 drops it.

ALTER TABLE "meals"
  ADD COLUMN "can_batch" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "can_fresh" BOOLEAN NOT NULL DEFAULT true;

UPDATE "meals"
SET can_batch = (meal_type = 'batch_prep'),
    can_fresh = (meal_type = 'cook_fresh');
