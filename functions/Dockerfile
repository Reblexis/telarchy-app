FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/lib ./lib

ENV PORT=8080
EXPOSE 8080

# Required: DATABASE_URL, API_KEY
# Optional: ALLOWED_ORIGIN, ADMIN_EMAILS, PORT,
#           GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
#           GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET,
#           BETTER_AUTH_SECRET
CMD ["node", "lib/server.js"]
