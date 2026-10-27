-- AlterTable
ALTER TABLE "sse_members" ADD COLUMN     "git_hub_linked_id" TEXT,
ADD COLUMN     "git_hub_linked_login" TEXT,
ADD COLUMN     "git_hub_linked_via" TEXT;

-- AlterTable
ALTER TABLE "sse_officer_terms" ADD COLUMN     "from_dates" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "last_seen_at" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "sse_members_git_hub_linked_id_key" ON "sse_members"("git_hub_linked_id");

