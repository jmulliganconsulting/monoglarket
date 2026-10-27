-- CreateTable
CREATE TABLE "market_comments" (
    "id" SERIAL NOT NULL,
    "market_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hidden_at" TIMESTAMP(3),
    "hidden_by" INTEGER,

    CONSTRAINT "market_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "market_comments_market_id_created_at_idx" ON "market_comments"("market_id", "created_at");

-- AddForeignKey
ALTER TABLE "market_comments" ADD CONSTRAINT "market_comments_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_comments" ADD CONSTRAINT "market_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

