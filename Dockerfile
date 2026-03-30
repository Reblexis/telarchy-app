# ── Backend builder ────────────────────────────────────────────────────────────
FROM node:20-alpine AS backend-builder

WORKDIR /app/functions
COPY functions/package*.json ./
RUN npm ci
COPY functions/tsconfig.json ./
COPY functions/src ./src
RUN npm run build

# ── Frontend builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
# Empty VITE_API_URL means frontend calls the same origin (self-hosted mode)
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ── Runtime ────────────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app
COPY functions/package*.json ./
RUN npm ci --omit=dev
COPY --from=backend-builder /app/functions/lib ./lib
# Serve frontend static files from /app/public
COPY --from=frontend-builder /app/dist ./public

ENV PORT=8080
EXPOSE 8080

# Required: DATABASE_URL, API_KEY
# Optional: ALLOWED_ORIGIN, ADMIN_EMAILS, PORT,
#           GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
#           GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET,
#           BETTER_AUTH_SECRET
CMD ["node", "lib/server.js"]
