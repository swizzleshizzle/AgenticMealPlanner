-- 1. Cook style enum + column with backfill from is_prep
CREATE TYPE "CookStyle" AS ENUM ('cook_fresh', 'batch_prep', 'leftovers');

ALTER TABLE planned_meals
  ADD COLUMN cook_style "CookStyle" NOT NULL DEFAULT 'cook_fresh';

UPDATE planned_meals
SET cook_style = CASE
  WHEN is_prep THEN 'batch_prep'::"CookStyle"
  ELSE 'cook_fresh'::"CookStyle"
END;

ALTER TABLE planned_meals DROP COLUMN is_prep;

-- 2. Week shift: every existing Monday-start plan moves back one day
UPDATE weekly_plans
SET week_start_date = week_start_date - INTERVAL '1 day';
