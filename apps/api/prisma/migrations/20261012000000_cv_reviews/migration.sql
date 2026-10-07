-- CreateTable
CREATE TABLE "CvReview" (
    "id" TEXT NOT NULL,
    "baseCvId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'schedule',
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "suggestions" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CvReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CvReview_language_createdAt_idx" ON "CvReview"("language", "createdAt");

-- AddForeignKey
ALTER TABLE "CvReview" ADD CONSTRAINT "CvReview_baseCvId_fkey" FOREIGN KEY ("baseCvId") REFERENCES "BaseCv"("id") ON DELETE CASCADE ON UPDATE CASCADE;
