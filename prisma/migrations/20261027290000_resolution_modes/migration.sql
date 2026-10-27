-- AlterTable
ALTER TABLE "markets" ADD COLUMN "resolution_mode" TEXT NOT NULL DEFAULT 'manual';

-- Markets that already have an automatic source keep the default behaviour: a moderator confirms.
UPDATE "markets" SET "resolution_mode" = 'auto_confirm' WHERE "resolver_source" IS NOT NULL;
