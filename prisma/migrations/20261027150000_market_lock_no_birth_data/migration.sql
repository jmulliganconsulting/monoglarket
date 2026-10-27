-- AlterTable
ALTER TABLE "markets" ADD COLUMN     "lock_at" TIMESTAMP(3),
ADD COLUMN     "locked_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" DROP COLUMN "birth_day",
DROP COLUMN "birth_month",
DROP COLUMN "birth_year";

