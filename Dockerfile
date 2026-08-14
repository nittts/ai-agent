# =============================================================================
# Build multi-stage: o estágio final não carrega toolchain de compilação nem
# devDependencies. Isso importa para o argumento de escala do ADR — quanto menor
# e mais rápida a imagem, mais barato é escalar horizontalmente atrás do LB.
# =============================================================================

# ---- Estágio 1: dependências completas + build --------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY web ./web
COPY public ./public

# Compila o backend (tsc) e o console (esbuild).
RUN npm run build

# ---- Estágio 2: só dependências de produção -----------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- Estágio 3: runtime -------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Não rodar como root.
RUN addgroup -S app && adduser -S app -G app

COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/public       ./public
COPY package.json ./
COPY corpus ./corpus
COPY eval/questions.json ./eval/questions.json

USER app
EXPOSE 3000

# O health check é o mesmo endpoint que o compose e o LB usariam.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
