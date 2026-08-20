# ── Backend builder ────────────────────────────────────────────────────────────
FROM node:22-alpine AS backend-builder

WORKDIR /app/functions
COPY functions/package*.json ./
RUN npm ci
COPY functions/tsconfig.json ./
COPY functions/src ./src
RUN npm run build

# ── Frontend builder ──────────────────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
# Frontend re-exports shared modules from the backend source
COPY functions/src/lib/metrics-engine.ts ./functions/src/lib/metrics-engine.ts
COPY functions/src/lib/time-preference.ts ./functions/src/lib/time-preference.ts
COPY functions/src/lib/date-utils.ts ./functions/src/lib/date-utils.ts
COPY functions/src/types.ts ./functions/src/types.ts
# Empty VITE_API_URL means frontend calls the same origin (self-hosted mode)
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build
# The SAME code, built a second time to live under /beta (owner ask
# 2026-08-20: host the beta on telarchy.com so Google login works and a
# tester needs no second account). A bundle's asset paths and API base are
# baked at build time, so serving one build under two prefixes is not
# possible; this is the whole reason for the second pass. tsc already ran
# above, so this is the bundler only.
RUN npm run build:beta

# ── Runtime ────────────────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app
COPY functions/package*.json ./
RUN npm ci --omit=dev
COPY --from=backend-builder /app/functions/lib ./lib
# Fonts for the server-drawn share card (lib/lib/share-card.js resolves ../../assets)
COPY functions/assets ./assets
# Serve frontend static files — server.ts expects them at __dirname/public = lib/public
COPY --from=frontend-builder /app/dist ./lib/public
COPY --from=frontend-builder /app/dist-beta ./lib/public-beta

ENV PORT=8080
EXPOSE 8080

# Required: DATABASE_URL, API_KEY
# Optional: ALLOWED_ORIGIN, ADMIN_EMAILS, PORT,
#           GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
#           GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET,
#           BETTER_AUTH_SECRET
CMD ["node", "lib/server.js"]
