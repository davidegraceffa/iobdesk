-- Eseguito solo alla prima inizializzazione del volume pgdata.
-- Le migrazioni Prisma ripetono il CREATE EXTENSION in modo idempotente.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
