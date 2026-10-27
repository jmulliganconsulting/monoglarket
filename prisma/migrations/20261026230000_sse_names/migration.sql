-- AlterTable
ALTER TABLE "sse_members" ADD COLUMN     "name_given" TEXT,
ADD COLUMN     "name_suspect" BOOLEAN NOT NULL DEFAULT false;

