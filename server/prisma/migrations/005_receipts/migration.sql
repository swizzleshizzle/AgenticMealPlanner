-- Migration 005: receipts + receipt_items for the Pantry add-from-receipt flow.

CREATE TYPE "ReceiptSource" AS ENUM ('paste', 'photo', 'pdf');

CREATE TABLE "receipts" (
  "id"          SERIAL PRIMARY KEY,
  "source"      "ReceiptSource" NOT NULL,
  "source_path" TEXT,
  "raw_text"    TEXT,
  "store"       TEXT NOT NULL,
  "trip_date"   DATE NOT NULL,
  "subtotal"    DECIMAL(10, 2),
  "tax"         DECIMAL(10, 2),
  "total"       DECIMAL(10, 2) NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL
);

CREATE INDEX "receipts_trip_date_idx" ON "receipts" ("trip_date");

CREATE TABLE "receipt_items" (
  "id"             SERIAL PRIMARY KEY,
  "receipt_id"     INTEGER NOT NULL REFERENCES "receipts"("id") ON DELETE CASCADE,
  "raw_name"       TEXT NOT NULL,
  "parsed_name"    TEXT NOT NULL,
  "ingredient_id"  INTEGER REFERENCES "ingredients"("id"),
  "quantity"       DECIMAL(10, 3) NOT NULL,
  "unit"           TEXT NOT NULL,
  "price"          DECIMAL(10, 2),
  "kind"           TEXT NOT NULL,
  "category_guess" "IngredientCategory",
  "location_guess" "PantryLocation",
  "is_committed"   BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX "receipt_items_receipt_id_idx" ON "receipt_items" ("receipt_id");
CREATE INDEX "receipt_items_ingredient_id_idx" ON "receipt_items" ("ingredient_id");
