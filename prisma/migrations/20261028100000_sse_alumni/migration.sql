-- CreateTable
CREATE TABLE "sse_alumni" (
    "sse_alumni_id" INTEGER NOT NULL,
    "member_id" INTEGER,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "linked_in" TEXT,
    "git_hub" TEXT,
    "description" TEXT,
    "image_key" TEXT,
    "start_date" TEXT NOT NULL,
    "end_date" TEXT NOT NULL,
    "quote" TEXT,
    "previous_roles" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "sse_alumni_pkey" PRIMARY KEY ("sse_alumni_id")
);

-- CreateIndex
CREATE INDEX "sse_alumni_member_id_idx" ON "sse_alumni"("member_id");

-- CreateIndex
CREATE INDEX "sse_alumni_email_idx" ON "sse_alumni"("email");

-- AddForeignKey
ALTER TABLE "sse_alumni" ADD CONSTRAINT "sse_alumni_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "sse_members"("sse_user_id") ON DELETE SET NULL ON UPDATE CASCADE;
