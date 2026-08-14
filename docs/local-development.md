# Local Development

Docker Compose is the local runtime. It starts only two services:

1. `app-server` — one container running the Node local API behind Nginx. Nginx serves `app-ui` and forwards `/api/*` to Node. It exposes only `127.0.0.1:8081` by default.
2. `postgres` — PostgreSQL 16, exposed only at `127.0.0.1:5431` by default (`POSTGRES_PORT` overrides it).

## Start

Create or select an AWS Secrets Manager JSON secret for local PostgreSQL. It must contain non-empty `username` and `password` fields. Its `username` must equal the nonsecret `POSTGRES_USER` value in `.env`.

```bash
cp .env.example .env
# Set DATABASE_SECRET_ARN to the local secret ARN. Do not put its value in .env.
npm run docker:up
```

Check:

```bash
curl http://localhost:8081/health
curl http://localhost:8081/api/health
```

The initial SQL migration mounts into PostgreSQL's standard init directory. It runs only when the named `postgres-data` volume is first created. Reset database data only when safe:

```bash
docker compose down -v
npm run docker:up
```

## Design constraints

- Docker Compose is local-only and uses only two containers, but it requires AWS credentials with `secretsmanager:GetSecretValue` on the configured local database secret. Compose mounts the host AWS profile read-only at `/root/.aws`; credentials and secret values are never copied into Compose environment variables.
- `DATABASE_SECRET_ARN` is a nonsecret reference. Both containers fetch the standard Secrets Manager JSON at runtime. PostgreSQL writes only the `password` field to a mode-0600 ephemeral password file for `POSTGRES_PASSWORD_FILE`; the Node service fetches the same secret through the AWS SDK. Do not use `DATABASE_URL`, `POSTGRES_PASSWORD`, `DATABASE_PASSWORD`, or `DATABASE_USERNAME`.
- Node listens only on loopback inside its container. Nginx is the sole exposed application port.
- Browser calls use same-origin `/api`. The local Node API proxies `/api/psiu/*` to `PSIU_BASE_URL` (default `http://psiu.local`), so local capture works before PSIU firmware has CORS support.
- This image is a rebuild-on-change baseline. Add a Compose development override with bind mounts/hot reload only when required; keep total service count at two unless approved.
