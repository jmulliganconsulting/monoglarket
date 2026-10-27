-- AlterTable
ALTER TABLE "earn_rules" ADD COLUMN     "category" TEXT;

-- AlterTable
ALTER TABLE "sse_events" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'other',
ADD COLUMN     "category_manual" TEXT,
ADD COLUMN     "image_checked_at" TIMESTAMP(3),
ADD COLUMN     "image_error" TEXT,
ADD COLUMN     "image_file" TEXT,
ADD COLUMN     "series" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "series_manual" TEXT;

-- CreateTable
CREATE TABLE "event_categories" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "run_by" TEXT,
    "description" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 50,

    CONSTRAINT "event_categories_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "sse_events_category_idx" ON "sse_events"("category");

-- Seed categories (src/sse/categories.ts); existing events default to 'other'.
INSERT INTO "event_categories" ("key", "name", "run_by", "sort") VALUES
('general_meeting', 'General meetings', 'President', 1),
('social', 'Social events', 'Events', 2),
('talk', 'Talks', 'Talks Head', 3),
('company', 'Company talks and visits', 'Public Relations Head', 4),
('career', 'Career development', 'Career Development Head', 5),
('academic', 'Review sessions and mentoring', 'Mentoring Head', 6),
('project', 'Projects', 'Projects Head', 7),
('outreach', 'Open houses and club fairs', NULL, 8),
('lab', 'Lab upkeep', 'Laboratory Operations', 9),
('officer', 'Officer meetings', NULL, 10),
('election', 'Elections', NULL, 11),
('other', 'Other', NULL, 99);

-- AddForeignKey
ALTER TABLE "sse_events" ADD CONSTRAINT "sse_events_category_fkey" FOREIGN KEY ("category") REFERENCES "event_categories"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sse_events" ADD CONSTRAINT "sse_events_category_manual_fkey" FOREIGN KEY ("category_manual") REFERENCES "event_categories"("key") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earn_rules" ADD CONSTRAINT "earn_rules_category_fkey" FOREIGN KEY ("category") REFERENCES "event_categories"("key") ON DELETE SET NULL ON UPDATE CASCADE;
