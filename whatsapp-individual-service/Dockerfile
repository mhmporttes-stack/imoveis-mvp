FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Build reproduzível: package-lock.json + `npm ci` (versão EXATA do Baileys e de
# todas as dependências). Antes era `npm install` com "^6.7.9" e sem lockfile —
# cada build podia resolver uma versão diferente. O lockfile registra a
# dependência libsignal (git) como ssh://git@github.com/...; o container não tem
# chave SSH, então a troca abaixo faz o git usar https.
COPY package.json package-lock.json ./
RUN git config --global url."https://github.com/".insteadOf ssh://git@github.com/ \
  && npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=3100
EXPOSE 3100

CMD ["node", "src/server.js"]
