-- CreateTable
CREATE TABLE "sse_members" (
    "id" SERIAL NOT NULL,
    "sse_user_id" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "major" TEXT,
    "graduation_term" TEXT,
    "graduation_year" INTEGER,
    "linked_in" TEXT,
    "git_hub" TEXT,
    "image" TEXT,
    "membership_count" INTEGER NOT NULL DEFAULT 0,
    "term_membership_count" INTEGER NOT NULL DEFAULT 0,
    "is_mentor" BOOLEAN NOT NULL DEFAULT false,
    "mentor_expires_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'guest',
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sse_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sse_officers" (
    "id" SERIAL NOT NULL,
    "sse_officer_id" INTEGER NOT NULL,
    "member_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sse_officers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sse_members_sse_user_id_key" ON "sse_members"("sse_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sse_members_email_key" ON "sse_members"("email");

-- CreateIndex
CREATE INDEX "sse_members_status_idx" ON "sse_members"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sse_officers_sse_officer_id_key" ON "sse_officers"("sse_officer_id");

-- CreateIndex
CREATE INDEX "sse_officers_member_id_idx" ON "sse_officers"("member_id");

-- AddForeignKey
ALTER TABLE "sse_officers" ADD CONSTRAINT "sse_officers_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "sse_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
