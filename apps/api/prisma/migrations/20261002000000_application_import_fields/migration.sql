-- Campi per le candidature importate da file (CSV / foglio di calcolo):
-- id esterno per reimportare senza duplicati, nazione, CV inviato, lingua del CV, modalità di tracciamento.
ALTER TABLE "Application"
    ADD COLUMN "externalId" TEXT,
    ADD COLUMN "country" TEXT,
    ADD COLUMN "cvSent" TEXT,
    ADD COLUMN "cvLanguage" TEXT,
    ADD COLUMN "trackingMode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Application_externalId_key" ON "Application"("externalId");

-- CreateIndex
CREATE INDEX "Application_country_idx" ON "Application"("country");
