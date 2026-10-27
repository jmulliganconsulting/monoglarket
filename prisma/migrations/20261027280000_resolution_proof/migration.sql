-- CreateTable
CREATE TABLE "resolution_attachments" (
    "id" SERIAL NOT NULL,
    "proposal_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "url" TEXT,
    "stored_name" TEXT,
    "original_name" TEXT,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resolution_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resolution_attachments_proposal_id_idx" ON "resolution_attachments"("proposal_id");

-- AddForeignKey
ALTER TABLE "resolution_attachments" ADD CONSTRAINT "resolution_attachments_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "resolution_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
