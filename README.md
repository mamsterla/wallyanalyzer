# Wally Analyzer Platform

Monorepo foundation for an AWS-hosted service that sells test records, PSIU devices and analysis credits; receives PSIU recordings; runs analysis jobs; and presents reports and fleet analytics.

## Workspaces

- `app-ui` — React user, admin, installer, and local PSIU-controller experience.
- `app-server` — TypeScript Lambda handlers, application services, and SQL migrations.
- `infra` — AWS CDK application and environment-aware platform stack.
- `packages/contracts` — shared API/domain contracts.
- `algorithms` and `src/wallyanalyzer` — existing Python algorithm reference implementation.
- `docs` — architecture, integration, and algorithm/data contracts.

## Local development

All local services run through Docker Compose. The initial setup has two containers: `app-server` (Nginx serving the React build and reverse-proxying its co-located Node API) and `postgres`.

```bash
cp .env.example .env
npm run docker:up
```

Open `http://localhost:8081`; API health is at `http://localhost:8081/health`. The local PSIU proxy uses `PSIU_BASE_URL` (default `http://psiu.local`). Postgres maps to `localhost:5433` by default. Use `npm run docker:down` to stop services; add `-v` manually only when local database data should be removed.

For non-container validation:

```bash
npm install
npm run check
npm run synth
```

Use `npm run deploy:staging` or `npm run deploy:production` only after setting AWS account/region context in `infra/cdk.json` and reviewing the generated CloudFormation.

## Agent workflow

Project-local `pi-subagents` is installed in `.pi/settings.json`. Reopen Pi in this repository after clone/install so it loads the project package. Initial workflow templates live in `.pi/chains/`.

## Boundary decisions

- S3 stores immutable audio uploads and algorithm/report artifacts; Postgres stores transactional and queryable metadata.
- Cognito groups are `user`, `installer`, and `admin`. API authorization must enforce server-side RBAC; UI guards are not authorization.
- The browser talks to a PSIU only on the user's LAN. No browser client owns AWS credentials; uploads use short-lived presigned S3 URLs.
- Python algorithms remain versioned reference workers. Production execution should package each approved algorithm version as a Lambda container image or Fargate task, selected by job type.

See [docs/architecture.md](docs/architecture.md) and [docs/psiu-integration.md](docs/psiu-integration.md).
