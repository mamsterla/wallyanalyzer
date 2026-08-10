#!/bin/sh
set -eu

node /app/local.js &
node_pid=$!

cleanup() {
  kill -TERM "$node_pid" 2>/dev/null || true
  wait "$node_pid" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

nginx -g 'daemon off;' &
nginx_pid=$!
wait "$nginx_pid"
