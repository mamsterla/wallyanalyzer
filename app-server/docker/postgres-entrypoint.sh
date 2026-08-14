#!/bin/sh
set -eu

: "${DATABASE_SECRET_ARN:?DATABASE_SECRET_ARN is required}"
: "${AWS_REGION:?AWS_REGION is required}"

umask 077
secret=$(aws secretsmanager get-secret-value --secret-id "$DATABASE_SECRET_ARN" --query SecretString --output text)
password=$(printf '%s' "$secret" | python3 -c 'import json,sys; value=json.load(sys.stdin).get("password"); assert isinstance(value,str) and value; print(value,end="")')
password_file=/run/wally/postgres-password
mkdir -p /run/wally
printf '%s' "$password" > "$password_file"
unset secret password
export POSTGRES_PASSWORD_FILE="$password_file"
exec /usr/local/bin/docker-entrypoint.sh "$@"
