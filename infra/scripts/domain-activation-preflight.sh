#!/usr/bin/env bash
set -euo pipefail

DOMAIN=${APPLICATION_DOMAIN:-wally-analytics.app}
EXPECTED_CSV=${EXPECTED_NAME_SERVERS:?EXPECTED_NAME_SERVERS is required}
EXPECTED=$(tr ',' '\n' <<<"$EXPECTED_CSV" | sed 's/\.$//' | sort)

if ! command -v dig >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq dnsutils
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache bind-tools
  else
    echo 'dig is required; install dnsutils or bind-tools.' >&2
    exit 1
  fi
fi

for resolver in 1.1.1.1 8.8.8.8; do
  actual=$(dig +short "@$resolver" NS "$DOMAIN" | sed 's/\.$//' | sort)
  if [[ "$actual" != "$EXPECTED" ]]; then
    echo "DNS delegation mismatch at $resolver for $DOMAIN" >&2
    echo "Expected:" >&2; printf '%s\n' "$EXPECTED" >&2
    echo "Actual:" >&2; printf '%s\n' "$actual" >&2
    exit 1
  fi
done

echo "DNS delegation preflight passed for $DOMAIN at 1.1.1.1 and 8.8.8.8."
