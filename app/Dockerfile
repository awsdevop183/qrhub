# ---- build stage: install production deps only ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

# ---- runtime stage ----
FROM node:20-alpine
WORKDIR /app

# Run as a non-root user (never run containers as root in production)
RUN addgroup -g 1001 -S nodegrp && adduser -u 1001 -S nodeusr -G nodegrp

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=nodeusr:nodegrp . .

USER nodeusr

# Declared so `docker inspect` and `docker run --rm <img> env` reveal the
# contract. Values here are DEFAULTS, not secrets.
ENV NODE_ENV=production \
    PORT=3000 \
    APP_VERSION=dev \
    BANNER_MESSAGE="Running locally" \
    BREAK_HEALTH=false
# QRHUB_SIGNING_KEY is REQUIRED and deliberately has no default.
# The app exits 1 if it is missing. Supply it at runtime:
#   docker run -e QRHUB_SIGNING_KEY=... qrhub:v1
# In ECS it comes from Secrets Manager via the task execution role.

LABEL org.opencontainers.image.title="QRHub" \
      org.opencontainers.image.source="https://github.com/<you>/qrhub-ecs" \
      io.qrhub.env.required="QRHUB_SIGNING_KEY" \
      io.qrhub.env.optional="APP_VERSION,BANNER_MESSAGE,BREAK_HEALTH,PORT,PUBLIC_BASE_URL"

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/health || exit 1

CMD ["node", "server.js"]
