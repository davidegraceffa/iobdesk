-- Estensione per deduplicazione fuzzy e ricerca per similarità
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "canonicalUrl" TEXT,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "companyUrl" TEXT,
    "titleNorm" TEXT NOT NULL,
    "companyNorm" TEXT NOT NULL,
    "descriptionOriginal" TEXT NOT NULL,
    "descriptionHtml" TEXT NOT NULL,
    "descriptionText" TEXT NOT NULL,
    "language" TEXT,
    "applyUrl" TEXT,
    "applyMethod" TEXT NOT NULL DEFAULT 'source_page',
    "techStack" JSONB NOT NULL,
    "salaryFound" BOOLEAN NOT NULL DEFAULT false,
    "salaryRawText" TEXT,
    "salaryMin" DOUBLE PRECISION,
    "salaryMax" DOUBLE PRECISION,
    "salaryCurrency" TEXT,
    "salaryPeriod" TEXT,
    "salaryLocalMin" DOUBLE PRECISION,
    "salaryLocalMax" DOUBLE PRECISION,
    "tags" TEXT[],
    "location" TEXT NOT NULL,
    "remote" TEXT NOT NULL DEFAULT 'unknown',
    "regions" TEXT[],
    "restrictedCountries" TEXT[],
    "timezoneOffsets" DOUBLE PRECISION[],
    "contractType" TEXT NOT NULL DEFAULT 'unknown',
    "requiresVat" BOOLEAN,
    "viaEor" BOOLEAN NOT NULL DEFAULT false,
    "seniority" TEXT NOT NULL DEFAULT 'unknown',
    "publishedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ruleScore" INTEGER NOT NULL DEFAULT 0,
    "scoreBreakdown" JSONB NOT NULL,
    "llmScore" INTEGER,
    "llmReason" TEXT,
    "llmRedFlags" TEXT[],
    "rejectedReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "notes" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "duplicateOfId" TEXT,
    -- colonna generata: titolo (peso A), azienda (B), descrizione (C)
    "searchVector" tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
        setweight(to_tsvector('english', coalesce("company", '')), 'B') ||
        setweight(to_tsvector('english', left(coalesce("descriptionText", ''), 200000)), 'C')
    ) STORED,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL,
    "channel" TEXT NOT NULL,
    "currentStatus" TEXT NOT NULL DEFAULT 'applied',
    "notes" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "generatedCvId" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationEvent" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "ApplicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettingsHistory" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'save',
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSettingsHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FetchRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'schedule',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "found" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "message" TEXT,

    CONSTRAINT "FetchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceState" (
    "source" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "httpCache" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "SourceState_pkey" PRIMARY KEY ("source")
);

-- CreateTable
CREATE TABLE "BaseCv" (
    "id" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "originalFileName" TEXT NOT NULL,
    "docxPath" TEXT NOT NULL,
    "pdfPath" TEXT,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "structure" JSONB NOT NULL,
    "error" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BaseCv_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedCv" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "baseCvId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "step" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "warning" TEXT,
    "userInstructions" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "analysis" JSONB,
    "edits" JSONB NOT NULL DEFAULT '[]',
    "rejectedEdits" JSONB NOT NULL DEFAULT '[]',
    "manualEdits" JSONB NOT NULL DEFAULT '{}',
    "gaps" JSONB NOT NULL DEFAULT '[]',
    "matchSummary" JSONB NOT NULL DEFAULT '{}',
    "docxPath" TEXT,
    "pdfPath" TEXT,
    "pageCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedCv_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_ruleScore_idx" ON "Job"("ruleScore");

-- CreateIndex
CREATE INDEX "Job_publishedAt_idx" ON "Job"("publishedAt");

-- CreateIndex
CREATE INDEX "Job_source_idx" ON "Job"("source");

-- CreateIndex
CREATE INDEX "Job_canonicalUrl_idx" ON "Job"("canonicalUrl");

-- CreateIndex
CREATE INDEX "Job_duplicateOfId_idx" ON "Job"("duplicateOfId");

-- CreateIndex
CREATE INDEX "Job_searchVector_idx" ON "Job" USING GIN ("searchVector");

-- CreateIndex
CREATE INDEX "Job_titleNorm_trgm_idx" ON "Job" USING GIN ("titleNorm" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Job_companyNorm_trgm_idx" ON "Job" USING GIN ("companyNorm" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Application_jobId_idx" ON "Application"("jobId");

-- CreateIndex
CREATE INDEX "Application_currentStatus_idx" ON "Application"("currentStatus");

-- CreateIndex
CREATE INDEX "Application_appliedAt_idx" ON "Application"("appliedAt");

-- CreateIndex
CREATE INDEX "ApplicationEvent_applicationId_at_idx" ON "ApplicationEvent"("applicationId", "at");

-- CreateIndex
CREATE INDEX "UserSettingsHistory_savedAt_idx" ON "UserSettingsHistory"("savedAt");

-- CreateIndex
CREATE INDEX "FetchRun_source_startedAt_idx" ON "FetchRun"("source", "startedAt");

-- CreateIndex
CREATE INDEX "BaseCv_language_isActive_idx" ON "BaseCv"("language", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "BaseCv_language_version_key" ON "BaseCv"("language", "version");

-- CreateIndex
CREATE INDEX "GeneratedCv_jobId_idx" ON "GeneratedCv"("jobId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_generatedCvId_fkey" FOREIGN KEY ("generatedCvId") REFERENCES "GeneratedCv"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedCv" ADD CONSTRAINT "GeneratedCv_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedCv" ADD CONSTRAINT "GeneratedCv_baseCvId_fkey" FOREIGN KEY ("baseCvId") REFERENCES "BaseCv"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

