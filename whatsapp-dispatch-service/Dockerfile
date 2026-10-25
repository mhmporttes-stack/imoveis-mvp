# syntax=docker/dockerfile:1
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
# Certificado extra OPCIONAL (rede com proxy TLS): docker build --secret id=npm_ca,src=<arquivo.crt> ...
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations
USER node
EXPOSE 3031
CMD ["node", "src/server.js", "--role=api"]
