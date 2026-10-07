# Contesto di build: la radice del repository (vedi docker-compose.yml).
ARG NODE_IMAGE=node:24-bookworm-slim

# ── base: Node LTS + pnpm (Corepack) + librerie di sistema ───────────────────────
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# openssl: motore Prisma · poppler-utils: pdfinfo/pdftoppm/pdffonts per pagine e miniature dei CV
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates poppler-utils \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare pnpm@10.34.6 --activate
WORKDIR /repo

# ── deps: dipendenze di tutto il workspace (layer cacheabile) ────────────────────
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --offline --frozen-lockfile

# ── dev: sorgenti montati come volume, hot reload, test e lint ───────────────────
FROM deps AS dev
ENV NODE_ENV=development
COPY . .
RUN pnpm --filter @jobagg/shared build && pnpm --filter @jobagg/api exec prisma generate
RUN mkdir -p /data/cv /data/state
WORKDIR /repo
CMD ["pnpm", "--filter", "@jobagg/api", "start:dev"]

# ── build: compilazione di shared e api ──────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @jobagg/shared build \
 && pnpm --filter @jobagg/api exec prisma generate \
 && pnpm --filter @jobagg/api build

# ── prod-deps: solo dipendenze di produzione dell'api + client Prisma ────────────
FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@jobagg/api..."
COPY apps/api/prisma apps/api/prisma
RUN pnpm --filter @jobagg/api exec prisma generate

# ── runtime: immagine finale minima, utente non root ─────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    CV_DATA_DIR=/data/cv \
    STATE_DIR=/data/state \
    CONFIG_DIR=/config
COPY --from=prod-deps /repo/node_modules node_modules
COPY --from=prod-deps /repo/apps/api/node_modules apps/api/node_modules
COPY --from=prod-deps /repo/packages/shared/node_modules packages/shared/node_modules
COPY packages/shared/package.json packages/shared/
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --chmod=755 apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# /data/state: file che non devono stare nel database (autorizzazione Google), leggibili solo dall'utente dell'app
RUN mkdir -p /data/cv /data/state && chown -R node:node /data/cv /data/state && chmod 700 /data/state
USER node
WORKDIR /repo/apps/api
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
