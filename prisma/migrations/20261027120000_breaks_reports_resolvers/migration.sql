-- DropForeignKey
ALTER TABLE "resolution_proposals" DROP CONSTRAINT "resolution_proposals_proposer_id_fkey";

-- AlterTable
ALTER TABLE "markets" ADD COLUMN     "resolver_source" TEXT;

-- AlterTable
ALTER TABLE "resolution_proposals" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'member',
ALTER COLUMN "proposer_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "break_until" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "market_resolvers" (
    "id" SERIAL NOT NULL,
    "market_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "granted_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_resolvers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" SERIAL NOT NULL,
    "reporter_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "market_id" INTEGER,
    "subject_id" INTEGER,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "note" TEXT NOT NULL DEFAULT '',
    "handled_by" INTEGER,
    "handled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "market_resolvers_market_id_user_id_key" ON "market_resolvers"("market_id", "user_id");

-- CreateIndex
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");

-- AddForeignKey
ALTER TABLE "resolution_proposals" ADD CONSTRAINT "resolution_proposals_proposer_id_fkey" FOREIGN KEY ("proposer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_resolvers" ADD CONSTRAINT "market_resolvers_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_resolvers" ADD CONSTRAINT "market_resolvers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

