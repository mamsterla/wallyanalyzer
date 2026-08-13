#!/bin/sh
set -eu

json_string() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\r/\\r/g; s/\n/\\n/g'
}

cat > /usr/share/nginx/html/runtime-config.js <<EOF
window.wallyRuntimeConfig = {
  apiBaseUrl: "$(json_string "${PUBLIC_API_BASE_URL:-/api}")",
  cognitoUserPoolId: "$(json_string "${PUBLIC_COGNITO_USER_POOL_ID:-}")",
  cognitoWebClientId: "$(json_string "${PUBLIC_COGNITO_WEB_CLIENT_ID:-}")"
};
EOF
