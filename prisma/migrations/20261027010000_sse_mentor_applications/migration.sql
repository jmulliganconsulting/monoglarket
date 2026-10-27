-- AlterTable
ALTER TABLE "sse_members" ADD COLUMN     "discord_id" TEXT;

-- CreateTable
CREATE TABLE "sse_mentor_applications" (
    "sse_application_id" INTEGER NOT NULL,
    "member_id" INTEGER NOT NULL,
    "semester_id" INTEGER,
    "semester_name" TEXT,
    "status" TEXT,
    "discord_username" TEXT,
    "pronouns" TEXT,
    "major" TEXT,
    "year_level" TEXT,
    "courses_json" TEXT,
    "skills_text" TEXT,
    "tools_comfortable" TEXT,
    "tools_learning" TEXT,
    "previous_semesters" INTEGER,
    "why_mentor" TEXT,
    "comments" TEXT,
    "applied_at" TIMESTAMP(3),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sse_mentor_applications_pkey" PRIMARY KEY ("sse_application_id")
);

-- CreateIndex
CREATE INDEX "sse_mentor_applications_member_id_idx" ON "sse_mentor_applications"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "sse_members_discord_id_key" ON "sse_members"("discord_id");

-- AddForeignKey
ALTER TABLE "sse_mentor_applications" ADD CONSTRAINT "sse_mentor_applications_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "sse_members"("sse_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

