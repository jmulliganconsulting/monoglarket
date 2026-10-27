-- AlterTable
ALTER TABLE "outcomes" ADD COLUMN     "sse_member_id" INTEGER;

-- AddForeignKey
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_sse_member_id_fkey" FOREIGN KEY ("sse_member_id") REFERENCES "sse_members"("sse_user_id") ON DELETE SET NULL ON UPDATE CASCADE;
