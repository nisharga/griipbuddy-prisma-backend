-- CreateTable
CREATE TABLE "faqs" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdBy" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "faqs_product_id_status_idx" ON "faqs"("product_id", "status");

-- CreateIndex
CREATE INDEX "faqs_createdAt_idx" ON "faqs"("createdAt");

-- AddForeignKey
ALTER TABLE "faqs" ADD CONSTRAINT "faqs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
