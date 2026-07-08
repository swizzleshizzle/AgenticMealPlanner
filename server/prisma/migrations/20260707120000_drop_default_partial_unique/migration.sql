-- Drop the partial-unique index added in 20260618000000_restore_fk_indexes.
--
-- It enforced "one default, non-archived meal per recipe family", but that
-- conflicts with the recipe-versioning transaction: supersedeMeal inserts the
-- new default version BEFORE demoting/archiving the old one, so two is_default
-- rows briefly exist for the same recipe_id within the transaction, which a
-- non-deferrable partial-unique index rejects (breaking create_recipe_version /
-- edit_recipe). Application logic already guarantees a single active default
-- per family, so the DB-level constraint is unnecessary and is removed here.
DROP INDEX IF EXISTS "meals_one_default_per_recipe_idx";
