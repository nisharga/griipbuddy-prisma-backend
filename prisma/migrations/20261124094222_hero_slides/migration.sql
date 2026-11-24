-- CreateTable
CREATE TABLE "hero_slides" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "video_url" TEXT NOT NULL,
    "thumbnail_url" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "button" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hero_slides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hero_slides_position_idx" ON "hero_slides"("position");
