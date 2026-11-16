-- Long Tail sign-in handoff: one-time codes the game swaps for a member id.
CREATE TABLE "handoff_codes" (
    "id" SERIAL NOT NULL,
    "code_hash" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handoff_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "handoff_codes_code_hash_key" ON "handoff_codes"("code_hash");

-- CreateIndex
CREATE INDEX "handoff_codes_user_id_idx" ON "handoff_codes"("user_id");

-- AddForeignKey
ALTER TABLE "handoff_codes" ADD CONSTRAINT "handoff_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

