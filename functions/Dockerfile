FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/lib ./lib

ENV PORT=8080
EXPOSE 8080

# Required: DATA_SERVICE_ACCOUNT (base64 service account JSON), API_KEY
# Optional: ALLOWED_ORIGIN, ADMIN_EMAILS, PORT
CMD ["node", "lib/server.js"]
