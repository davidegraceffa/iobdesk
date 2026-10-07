-- AlterTable
ALTER TABLE "InterviewSession" ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'turns',
ADD COLUMN     "report" JSONB,
ADD COLUMN     "reportError" TEXT,
ADD COLUMN     "reportStatus" TEXT,
ADD COLUMN     "transcript" JSONB NOT NULL DEFAULT '[]';

