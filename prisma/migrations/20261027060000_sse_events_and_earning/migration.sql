-- CreateTable
CREATE TABLE "sse_events" (
    "sse_event_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "image" TEXT,
    "location_given" TEXT,
    "location" TEXT,
    "attendance_enabled" BOOLEAN NOT NULL,
    "grants_membership" BOOLEAN NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "attendance_fetched_at" TIMESTAMP(3),
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "sse_events_pkey" PRIMARY KEY ("sse_event_id")
);

-- CreateTable
CREATE TABLE "sse_event_places" (
    "event_id" TEXT NOT NULL,
    "sort" INTEGER NOT NULL,
    "place" TEXT NOT NULL,
    "room" TEXT,
    "role" TEXT NOT NULL,

    CONSTRAINT "sse_event_places_pkey" PRIMARY KEY ("event_id","sort")
);

-- CreateTable
CREATE TABLE "sse_event_attendance" (
    "sse_attendance_id" INTEGER NOT NULL,
    "event_id" TEXT NOT NULL,
    "member_id" INTEGER NOT NULL,
    "attended_at" TIMESTAMP(3) NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "sse_event_attendance_pkey" PRIMARY KEY ("sse_attendance_id")
);

-- CreateTable
CREATE TABLE "manual_checkins" (
    "id" SERIAL NOT NULL,
    "event_id" TEXT NOT NULL,
    "member_id" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "added_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "manual_checkins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_events" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "site_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_event_checkins" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "added_by_id" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "site_event_checkins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "earn_rules" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "sse_event_id" TEXT,
    "site_event_id" INTEGER,
    "amount" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "set_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "earn_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "earn_awards" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "target" INTEGER NOT NULL,
    "rule_id" INTEGER,
    "reason" TEXT NOT NULL,
    "transaction_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "earn_awards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sse_events_date_idx" ON "sse_events"("date");

-- CreateIndex
CREATE INDEX "sse_event_places_place_idx" ON "sse_event_places"("place");

-- CreateIndex
CREATE INDEX "sse_event_attendance_member_id_idx" ON "sse_event_attendance"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "sse_event_attendance_event_id_member_id_key" ON "sse_event_attendance"("event_id", "member_id");

-- CreateIndex
CREATE UNIQUE INDEX "manual_checkins_event_id_member_id_key" ON "manual_checkins"("event_id", "member_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_event_checkins_event_id_user_id_key" ON "site_event_checkins"("event_id", "user_id");

-- CreateIndex
CREATE INDEX "earn_rules_kind_effective_from_idx" ON "earn_rules"("kind", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "earn_awards_transaction_id_key" ON "earn_awards"("transaction_id");

-- CreateIndex
CREATE INDEX "earn_awards_user_id_idx" ON "earn_awards"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "earn_awards_source_source_id_seq_key" ON "earn_awards"("source", "source_id", "seq");

-- AddForeignKey
ALTER TABLE "sse_event_places" ADD CONSTRAINT "sse_event_places_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "sse_events"("sse_event_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sse_event_attendance" ADD CONSTRAINT "sse_event_attendance_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "sse_events"("sse_event_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sse_event_attendance" ADD CONSTRAINT "sse_event_attendance_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "sse_members"("sse_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_checkins" ADD CONSTRAINT "manual_checkins_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "sse_events"("sse_event_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_checkins" ADD CONSTRAINT "manual_checkins_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "sse_members"("sse_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_event_checkins" ADD CONSTRAINT "site_event_checkins_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "site_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_event_checkins" ADD CONSTRAINT "site_event_checkins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earn_rules" ADD CONSTRAINT "earn_rules_sse_event_id_fkey" FOREIGN KEY ("sse_event_id") REFERENCES "sse_events"("sse_event_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earn_rules" ADD CONSTRAINT "earn_rules_site_event_id_fkey" FOREIGN KEY ("site_event_id") REFERENCES "site_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earn_awards" ADD CONSTRAINT "earn_awards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earn_awards" ADD CONSTRAINT "earn_awards_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "earn_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
