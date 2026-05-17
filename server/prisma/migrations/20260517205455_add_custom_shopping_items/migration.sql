-- AlterTable
ALTER TABLE "pantry_items" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "custom_shopping_items" (
    "id" SERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "qty_text" TEXT,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_shopping_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custom_shopping_items_plan_id_idx" ON "custom_shopping_items"("plan_id");

-- AddForeignKey
ALTER TABLE "custom_shopping_items" ADD CONSTRAINT "custom_shopping_items_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "weekly_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
