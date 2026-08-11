#!/bin/sh
set -eu

if [ "${1:-}" = "bootstrap-admin" ]; then
  exec node /app/bootstrapAdmin.js
fi

if [ -n "${DATABASE_URL:-}${DATABASE_PROXY_HOST:-}" ]; then
  node /app/migrate.js
fi

node "${NODE_SERVER_PATH:-/app/local.js}" &
node_pid=$!

cleanup() {
  kill -TERM "$node_pid" 2>/dev/null || true
  wait "$node_pid" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

nginx -g 'daemon off;' &
nginx_pid=$!
wait "$nginx_pid"
