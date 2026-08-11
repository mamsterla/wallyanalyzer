# Two-process local development image: Node API behind Nginx, plus Postgres in Compose.
# Production Lambda/CDK packaging remains separate.
FROM node:22-alpine AS builder
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY app-ui/package.json app-ui/package.json
COPY app-server/package.json app-server/package.json
COPY infra/package.json infra/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY app-server app-server
COPY app-ui app-ui
RUN npm run build --workspace=@wally/contracts \
  && npm run build --workspace=@wally/app-server \
  && npm run build --workspace=@wally/app-ui

FROM node:22-alpine AS runtime
RUN apk add --no-cache nginx

COPY app-server/docker/nginx.conf /etc/nginx/http.d/default.conf
COPY app-server/docker/entrypoint.sh /usr/local/bin/wally-entrypoint
RUN chmod +x /usr/local/bin/wally-entrypoint
COPY --from=builder /workspace/node_modules /app/node_modules
COPY --from=builder /workspace/packages/contracts /app/packages/contracts
COPY --from=builder /workspace/app-server/dist/local.js /app/local.js
COPY --from=builder /workspace/app-server/dist/production.js /app/production.js
COPY --from=builder /workspace/app-server/dist/migrate.js /app/migrate.js
COPY --from=builder /workspace/app-server/dist/bootstrapAdmin.js /app/bootstrapAdmin.js
COPY --from=builder /workspace/app-server/migrations /app/migrations
COPY --from=builder /workspace/app-ui/dist /usr/share/nginx/html

ENV NODE_ENV=production \
    NODE_SERVER_PATH=/app/production.js \
    PORT=3000
EXPOSE 80
ENTRYPOINT ["/usr/local/bin/wally-entrypoint"]
