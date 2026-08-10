# Local Development

Docker Compose is the local runtime. It starts only two services:

1. `app-server` — one container running the Node local API behind Nginx. Nginx serves `app-ui` and forwards `/api/*` to Node. It exposes only `127.0.0.1:8081` by default.
2. `postgres` — PostgreSQL 16, exposed only at `127.0.0.1:5433` by default.

## Start

```bash
cp .env.example .env
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

- Docker Compose is local-only; no AWS resources or credentials are required.
- Node listens only on loopback inside its container. Nginx is the sole exposed application port.
- Browser calls use same-origin `/api`. The local Node API proxies `/api/psiu/*` to `PSIU_BASE_URL` (default `http://psiu.local`), so local capture works before PSIU firmware has CORS support.
- This image is a rebuild-on-change baseline. Add a Compose development override with bind mounts/hot reload only when required; keep total service count at two unless approved.
