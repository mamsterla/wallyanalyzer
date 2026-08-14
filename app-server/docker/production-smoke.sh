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
# Construct the server with a stub pool. The unauthenticated health route does
# not query Postgres, so this checks module resolution without test credentials.
docker run -d --name "$container_name" -p 127.0.0.1::3000 \
  --entrypoint node "$image_name" --input-type=module -e "import { createProductionServer } from '/app/production.js'; createProductionServer({ pool: {} }).listen(3000, '0.0.0.0');" >/dev/null
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
