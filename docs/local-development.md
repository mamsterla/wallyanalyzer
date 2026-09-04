# Local Development

Docker Compose is the local runtime. It starts only two services:

1. `app-server` — one container running the Node local API behind Nginx. Nginx serves `app-ui` and forwards `/api/*` to Node. It exposes only `127.0.0.1:8081` by default.
2. `postgres` — PostgreSQL 16, exposed only at `127.0.0.1:5431` by default (`POSTGRES_PORT` overrides it).

## Start

Create or select AWS Secrets Manager JSON secrets for local PostgreSQL and PSIU authentication. The database secret must contain non-empty `username` and `password` fields; its `username` must equal the nonsecret `POSTGRES_USER` value in `.env`. The PSIU secret may contain an opaque `authorization` header value or `username` and `password` fields.

```bash
cp .env.example .env
# Set DATABASE_SECRET_ARN and PSIU_CREDENTIAL_SECRET_ARN to local secret ARNs.
# Do not put secret values in .env.
npm run docker:up
```

Check:

```bash
curl http://localhost:8081/health
curl http://localhost:8081/api/health
```

## Local PSIU inventory scan

The local scan proof of concept calls unauthenticated `GET /uid` through the loopback-only proxy and returns only `{ "uid": "..." }`; firmware telemetry is discarded. It does not look up or add cloud inventory.

```bash
# DATABASE_SECRET_ARN remains required to start the existing two-container Compose runtime.
# No PSIU credential secret is required for this scan.
export PSIU_BASE_URL=http://psiu.local
unset PSIU_CREDENTIAL_SECRET_ARN
npm run docker:up
curl http://localhost:8081/api/psiu/uid
```

Open `http://localhost:8081/controller` to use the local scanner panel. Entering a serial label is preview-only. Do not use this HTTP local UI with a production Cognito session; cloud inventory validation and writes are a later HTTPS bridge milestone.

## PSIU upload lifecycle lock test

The normal unit tests use repository doubles. Run this explicit local Postgres integration test to prove that a completion transaction blocks concurrent deassignment and unavailable transitions. It creates and removes isolated fixture rows; it does not access S3.

```bash
export AWS_PROFILE=wallyanalyzer AWS_REGION=us-east-1
export DATABASE_SECRET_ARN='your-local-Postgres-secret-ARN'
export DATABASE_NAME=wally DATABASE_TEST_HOST=127.0.0.1 DATABASE_TEST_PORT=5431
node app-server/scripts/test-psiu-upload-locking.mjs
```

The local database must have migrations through `0007_psiu_unavailable_lifecycle.sql` applied.

The initial SQL migration mounts into PostgreSQL's standard init directory. It runs only when the named `postgres-data` volume is first created. Reset database data only when safe:

```bash
docker compose down -v
npm run docker:up
```

## Design constraints

- Docker Compose is local-only and uses only two containers, but it requires AWS credentials with `secretsmanager:GetSecretValue` on the configured local database secret. Compose mounts the host AWS profile read-only at `/root/.aws`; credentials and secret values are never copied into Compose environment variables.
- `DATABASE_SECRET_ARN` and optional `PSIU_CREDENTIAL_SECRET_ARN` are nonsecret references. Both containers fetch the database secret at runtime. PostgreSQL writes only the database `password` field to a mode-0600 ephemeral password file for `POSTGRES_PASSWORD_FILE`; the Node service fetches PSIU credentials through the AWS SDK only when protected PSIU routes need them. The unauthenticated `/psiu/uid` scan does not read PSIU credentials and returns no device telemetry. PSIU credentials are forwarded only to the local `PSIU_BASE_URL`, never to browser, logs, or AWS. Do not use `DATABASE_URL`, `POSTGRES_PASSWORD`, `DATABASE_PASSWORD`, `DATABASE_USERNAME`, or PSIU credential values in configuration.
- Node listens only on loopback inside its container. Nginx is the sole exposed application port.
- Browser calls use same-origin `/api`. The local Node API proxies `/api/psiu/*` to `PSIU_BASE_URL` (default `http://psiu.local`), so local capture works before PSIU firmware has CORS support.
- This image is a rebuild-on-change baseline. Add a Compose development override with bind mounts/hot reload only when required; keep total service count at two unless approved.
