-- CreateTable
CREATE TABLE "sse_officer_positions" (
    "sse_position_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL,
    "category" TEXT,
    "is_defunct" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT,
    "current_officer_id" INTEGER,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "sse_officer_positions_pkey" PRIMARY KEY ("sse_position_id")
);

-- CreateTable
CREATE TABLE "sse_officer_terms" (
    "id" SERIAL NOT NULL,
    "term" TEXT NOT NULL,
    "term_code" TEXT,
    "position_id" INTEGER NOT NULL,
    "sse_officer_id" INTEGER NOT NULL,
    "member_id" INTEGER NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sse_officer_terms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sse_officer_terms_member_id_idx" ON "sse_officer_terms"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "sse_officer_terms_term_position_id_sse_officer_id_key" ON "sse_officer_terms"("term", "position_id", "sse_officer_id");

-- AddForeignKey
ALTER TABLE "sse_officer_terms" ADD CONSTRAINT "sse_officer_terms_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "sse_officer_positions"("sse_position_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sse_officer_terms" ADD CONSTRAINT "sse_officer_terms_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "sse_members"("sse_user_id") ON DELETE CASCADE ON UPDATE CASCADE;
