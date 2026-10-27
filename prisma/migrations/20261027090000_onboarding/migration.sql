-- AlterTable
ALTER TABLE "users" ADD COLUMN     "birth_day" INTEGER,
ADD COLUMN     "birth_month" INTEGER,
ADD COLUMN     "birth_year" INTEGER,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "first_name" TEXT,
ADD COLUMN     "graduation_term" TEXT,
ADD COLUMN     "graduation_year" INTEGER,
ADD COLUMN     "is_transfer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_name" TEXT,
ADD COLUMN     "middle_name" TEXT,
ADD COLUMN     "name_prefix" TEXT,
ADD COLUMN     "name_suffix" TEXT,
ADD COLUMN     "on_coop_term" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "onboarded_at" TIMESTAMP(3),
ADD COLUMN     "onboarding_step" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "preferred_name" TEXT,
ADD COLUMN     "pronouns" TEXT,
ADD COLUMN     "pronouns_public" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "seniority" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "student_status" TEXT,
ADD COLUMN     "terms_accepted_at" TIMESTAMP(3),
ADD COLUMN     "username" TEXT;

-- CreateTable
CREATE TABLE "user_programs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "program" TEXT NOT NULL,
    "degree" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signup_blocks" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unblocked_at" TIMESTAMP(3),
    "unblocked_by" INTEGER,

    CONSTRAINT "signup_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_programs_user_id_program_degree_key" ON "user_programs"("user_id", "program", "degree");

-- CreateIndex
CREATE INDEX "signup_blocks_email_idx" ON "signup_blocks"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- AddForeignKey
ALTER TABLE "user_programs" ADD CONSTRAINT "user_programs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Accounts that predate onboarding are already members: mark them onboarded so they skip it.
UPDATE "users" SET "onboarded_at" = "created_at";
