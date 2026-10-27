-- sse_* is a mirror the next sync refills; emptying it lets the primary key and NOT NULL columns change safely.
DELETE FROM "sse_officers";
DELETE FROM "sse_members";

-- DropForeignKey
ALTER TABLE "sse_officers" DROP CONSTRAINT "sse_officers_member_id_fkey";

-- DropIndex
DROP INDEX "sse_members_sse_user_id_key";

-- AlterTable
ALTER TABLE "sse_members" DROP CONSTRAINT "sse_members_pkey",
DROP COLUMN "git_hub",
DROP COLUMN "id",
DROP COLUMN "image",
DROP COLUMN "linked_in",
DROP COLUMN "major",
ADD COLUMN     "coop_summary" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "git_hub_checked_at" TIMESTAMP(3),
ADD COLUMN     "git_hub_given" TEXT,
ADD COLUMN     "git_hub_id" INTEGER,
ADD COLUMN     "git_hub_valid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "graduation_term_code" TEXT,
ADD COLUMN     "image_checked_at" TIMESTAMP(3),
ADD COLUMN     "image_error" TEXT,
ADD COLUMN     "image_file" TEXT,
ADD COLUMN     "image_given" TEXT,
ADD COLUMN     "is_member" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "linked_in_given" TEXT,
ADD COLUMN     "linked_in_id" TEXT,
ADD COLUMN     "linked_in_valid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "major_given" TEXT,
ADD COLUMN     "membership_fetched_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "resolved_git_hub" TEXT,
ADD COLUMN     "resolved_linked_in" TEXT,
ADD CONSTRAINT "sse_members_pkey" PRIMARY KEY ("sse_user_id");

-- CreateTable
CREATE TABLE "sse_degrees" (
    "id" SERIAL NOT NULL,
    "member_id" INTEGER NOT NULL,
    "sort" INTEGER NOT NULL,
    "degree" TEXT NOT NULL,
    "major" TEXT,
    "given" TEXT NOT NULL,

    CONSTRAINT "sse_degrees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sse_degrees_member_id_sort_key" ON "sse_degrees"("member_id", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "sse_members_linked_in_id_key" ON "sse_members"("linked_in_id");

-- AddForeignKey
ALTER TABLE "sse_officers" ADD CONSTRAINT "sse_officers_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "sse_members"("sse_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sse_degrees" ADD CONSTRAINT "sse_degrees_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "sse_members"("sse_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

