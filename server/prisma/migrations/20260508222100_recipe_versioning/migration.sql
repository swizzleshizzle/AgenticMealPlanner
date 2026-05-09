-- Recipe versioning, variants, archive
-- Adds recipe_id (family identifier), version_number (chain position),
-- parent_meal_id (supersede pointer), is_default (active variant flag),
-- archived_at (soft-archive). Backfills recipe_id = id so every existing
-- row becomes its own single-row family.

ALTER TABLE "meals"
  ADD COLUMN "recipe_id"      INTEGER,
  ADD COLUMN "version_number" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "parent_meal_id" INTEGER,
  ADD COLUMN "is_default"     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "archived_at"    TIMESTAMP(3);

UPDATE "meals" SET "recipe_id" = "id";

ALTER TABLE "meals"
  ALTER COLUMN "recipe_id" SET NOT NULL,
  ADD CONSTRAINT "meals_parent_meal_id_fkey"
    FOREIGN KEY ("parent_meal_id") REFERENCES "meals"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "meals_recipe_id_idx" ON "meals" ("recipe_id");
CREATE INDEX "meals_recipe_id_archived_at_is_default_idx"
  ON "meals" ("recipe_id", "archived_at", "is_default");
