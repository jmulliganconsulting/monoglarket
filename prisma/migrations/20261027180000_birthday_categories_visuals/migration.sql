-- AlterTable
ALTER TABLE "markets" ADD COLUMN     "category_id" INTEGER,
ADD COLUMN     "color_primary" TEXT,
ADD COLUMN     "color_secondary" TEXT,
ADD COLUMN     "image_file" TEXT;

-- AlterTable
ALTER TABLE "outcomes" ADD COLUMN     "color" TEXT,
ADD COLUMN     "image_file" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "birth_day" INTEGER,
ADD COLUMN     "birth_month" INTEGER,
ADD COLUMN     "birthday_removed_at" TIMESTAMP(3),
ADD COLUMN     "birthday_set_at" TIMESTAMP(3),
ADD COLUMN     "last_signed_in_at" TIMESTAMP(3),
ADD COLUMN     "summary_since" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "market_categories" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "market_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "market_categories_key_key" ON "market_categories"("key");

-- AddForeignKey
ALTER TABLE "markets" ADD CONSTRAINT "markets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "market_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

