#!/bin/sh
set -eu

image_name="${WALLY_PRODUCTION_SMOKE_IMAGE:-wally-production-smoke-$$}"
container_name="wally-production-smoke-$$"
image_built=false

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  if [ "$image_built" = true ]; then
    docker image rm "$image_name" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

docker build -t "$image_name" -f app-server/Dockerfile .
image_built=true
# Run the production module directly so no database is required for this
# dependency-resolution and health-route smoke test.
docker run -d --name "$container_name" -p 127.0.0.1::3000 \
  -e DATABASE_PROXY_HOST=127.0.0.1 \
  -e DATABASE_NAME=wally \
  -e DATABASE_USERNAME=wally \
  -e DATABASE_PASSWORD=smoke-test-password \
  -e DATABASE_SSL=require \
  -e COGNITO_USER_POOL_ID=us-east-1_smoketest \
  -e COGNITO_WEB_CLIENT_ID=smoke-test-client \
  --entrypoint node "$image_name" /app/production.js >/dev/null
port=$(docker port "$container_name" 3000/tcp | sed 's/.*://')

for _ in $(seq 1 20); do
  if curl --fail --silent --show-error "http://127.0.0.1:${port}/health" | grep -q '"status":"ok"'; then
    echo "Production image smoke test passed."
    exit 0
  fi
  sleep 1
done

docker logs "$container_name" >&2 || true
echo "Production image health check failed." >&2
exit 1
