-- AlterTable
ALTER TABLE "market_categories" ADD COLUMN     "color" TEXT;

-- AlterTable
ALTER TABLE "markets" ADD COLUMN     "headliner" BOOLEAN NOT NULL DEFAULT false;
