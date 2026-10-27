-- CreateTable
CREATE TABLE "discord_accounts" (
    "discord_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "member_id" INTEGER,
    "scopes" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "username" TEXT NOT NULL,
    "global_name" TEXT,
    "avatar" TEXT,
    "banner" TEXT,
    "accent_color" INTEGER,
    "locale" TEXT,
    "mfa_enabled" BOOLEAN,
    "premium_type" INTEGER,
    "flags" INTEGER,
    "public_flags" INTEGER,
    "email" TEXT,
    "email_verified" BOOLEAN,
    "raw_user" JSONB NOT NULL,
    "first_linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linked_at" TIMESTAMP(3) NOT NULL,
    "unlinked_at" TIMESTAMP(3),

    CONSTRAINT "discord_accounts_pkey" PRIMARY KEY ("discord_id")
);

-- CreateTable
CREATE TABLE "discord_connections" (
    "id" SERIAL NOT NULL,
    "discord_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "visibility" INTEGER,
    "friend_sync" BOOLEAN,
    "show_activity" BOOLEAN,
    "two_way_link" BOOLEAN,
    "raw" JSONB NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "discord_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discord_accounts_user_id_idx" ON "discord_accounts"("user_id");

-- CreateIndex
CREATE INDEX "discord_accounts_member_id_idx" ON "discord_accounts"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "discord_connections_discord_id_type_external_id_key" ON "discord_connections"("discord_id", "type", "external_id");

-- AddForeignKey
ALTER TABLE "discord_accounts" ADD CONSTRAINT "discord_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discord_accounts" ADD CONSTRAINT "discord_accounts_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "sse_members"("sse_user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discord_connections" ADD CONSTRAINT "discord_connections_discord_id_fkey" FOREIGN KEY ("discord_id") REFERENCES "discord_accounts"("discord_id") ON DELETE CASCADE ON UPDATE CASCADE;

