#!/bin/sh
# Applica le migrazioni versionate prima del bootstrap di NestJS.
# Per i comandi una tantum (es. `node dist/cli fetch` via `docker compose exec`) l'entrypoint non viene rieseguito.
set -e

if [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
  echo "[entrypoint] prisma migrate deploy"
  node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma
fi

exec "$@"
