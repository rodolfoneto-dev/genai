# ========================================================
# Dockerfile - Módulo: genai (Generative AI Microservice)
# Multi-stage build para Node.js / Express
# ========================================================

# --------------------------------------------------------
# Estágio 1: Dependências (Dependencies)
# --------------------------------------------------------
FROM node:20-alpine AS dependencies

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# --------------------------------------------------------
# Estágio 2: Execução (Runtime)
# --------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4004

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

USER node

EXPOSE 4004

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4004/health || exit 1

CMD ["node", "src/server.js"]
