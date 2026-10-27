-- DropIndex
DROP INDEX "sse_members_email_key";

-- AlterTable
ALTER TABLE "sse_members" ADD COLUMN     "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "is_owner" BOOLEAN,
ADD COLUMN     "profile_fetched_at" TIMESTAMP(3),
ADD COLUMN     "removed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sse_officers" ADD COLUMN     "end_date" TIMESTAMP(3),
ADD COLUMN     "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "position_id" INTEGER,
ADD COLUMN     "removed_at" TIMESTAMP(3),
ADD COLUMN     "start_date" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "sse_mentors" (
    "sse_mentor_id" INTEGER NOT NULL,
    "member_id" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "expiration_date" TIMESTAMP(3),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "sse_mentors_pkey" PRIMARY KEY ("sse_mentor_id")
);

-- CreateTable
CREATE TABLE "sse_memberships" (
    "sse_membership_id" INTEGER NOT NULL,
    "member_id" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "date_given" TIMESTAMP(3) NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "sse_memberships_pkey" PRIMARY KEY ("sse_membership_id")
);

-- CreateIndex
CREATE INDEX "sse_mentors_member_id_idx" ON "sse_mentors"("member_id");

-- CreateIndex
CREATE INDEX "sse_memberships_member_id_idx" ON "sse_memberships"("member_id");

-- CreateIndex
CREATE INDEX "sse_members_email_idx" ON "sse_members"("email");

-- AddForeignKey
ALTER TABLE "sse_mentors" ADD CONSTRAINT "sse_mentors_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "sse_members"("sse_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sse_memberships" ADD CONSTRAINT "sse_memberships_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "sse_members"("sse_user_id") ON DELETE CASCADE ON UPDATE CASCADE;
