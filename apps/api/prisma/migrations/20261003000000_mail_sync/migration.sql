-- Sincronizzazione delle candidature da Gmail: storico delle esecuzioni
CREATE TABLE "MailSyncRun" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'schedule',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "examined" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "ignored" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "MailSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MailSyncRun_startedAt_idx" ON "MailSyncRun"("startedAt");
