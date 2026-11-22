-- AlterTable
ALTER TABLE "products" ADD COLUMN     "min_price" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "products_min_price_idx" ON "products"("min_price");

-- CreateIndex
CREATE INDEX "products_total_sold_idx" ON "products"("total_sold");
