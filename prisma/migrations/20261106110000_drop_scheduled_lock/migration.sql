-- Scheduled locks are gone: the close time does that job. A pending one becomes the close time when it is earlier.
UPDATE "markets" SET "close_at" = "lock_at"
WHERE "lock_at" IS NOT NULL AND "locked_at" IS NULL AND "status" = 'open' AND ("close_at" IS NULL OR "lock_at" < "close_at");

-- AlterTable
ALTER TABLE "markets" DROP COLUMN "lock_at";
