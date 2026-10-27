-- AlterTable
ALTER TABLE "trades" ADD COLUMN "fee" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "markets" ADD COLUMN "question_group_id" INTEGER,
ADD COLUMN "option_label" TEXT;

-- CreateTable
CREATE TABLE "question_groups" (
    "id" SERIAL NOT NULL,
    "question" TEXT NOT NULL,
    "resolution_criteria" TEXT NOT NULL,
    "close_at" TIMESTAMP(3) NOT NULL,
    "creator_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_groups_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "markets" ADD CONSTRAINT "markets_question_group_id_fkey" FOREIGN KEY ("question_group_id") REFERENCES "question_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_groups" ADD CONSTRAINT "question_groups_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
