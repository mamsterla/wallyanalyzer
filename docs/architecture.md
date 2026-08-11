# Platform Architecture

## Scope

Wally Analyzer is an AWS SaaS platform for commerce, PSIU-assisted recording, analysis jobs, reports, equipment tracking, and owner analytics. Existing Python code remains reference implementation while algorithms gain production packaging and parity validation.

## Initial bounded contexts

| Context | Responsibilities | Primary storage |
| --- | --- | --- |
| Identity and entitlement | Cognito identities, roles, commerce entitlement, analysis credits | Cognito + Postgres |
| Catalog and commerce | physical records, PSIU devices, digital analyses, pricing rules | Postgres + payment provider |
| Equipment | user-owned turntable, tonearm, cartridge records | Postgres |
| Samples | upload intent, file checksum, device/run metadata, retention | Postgres + S3 |
| Analysis | job selection, algorithm version, orchestration, outputs | Postgres + Step Functions + S3 |
| Reports | user report views and admin aggregates | Postgres + S3 |
| PSIU controller | browser-to-LAN device actions and upload workflow | browser + PSIU + API |

## Runtime flow

1. Cognito authenticates the user; private Node services verify signed access tokens and resolve the Cognito subject to a Postgres account.
2. The service checks account status, group, customer scope, PSIU assignment, and resource ownership before creating durable upload intent.
3. The service returns a short-lived S3 multipart/presigned upload URL. Browser uploads audio directly to private S3 after public ingress is explicitly approved.
4. S3 event validation confirms object metadata/checksum and moves sample to `queued`.
5. Step Functions selects algorithm version. Lambda container is default for bounded jobs; Fargate task is selected for long, memory-heavy, or native-library work.
6. Workers write artifacts and report payloads to S3, transactional status/results to Postgres, and report summary to API.
7. UI presents customer-scoped data or aggregate data after explicit admin authorization.

## AWS foundation

- **Cognito:** user pool plus groups `user`, `installer`, `admin`.
- **Cognito:** managed credentials, access tokens, password reset, and invite lifecycle; custom Wally UI owns presentation.
- **ECS/Fargate:** private production Node application service and future oversized algorithm execution plane.
- **S3:** private, encrypted, versioned raw input and immutable output artifacts.
- **RDS PostgreSQL + RDS Proxy:** encrypted transactional metadata, entitlements, jobs, reports, and analytics dimensions.
- **VPC endpoints:** private ECS access to approved AWS services without NAT.
- **CloudWatch:** structured application/workflow logs, metrics, alarms, dashboards.
- **CodePipeline/CodeBuild:** GitHub `main` validation and production deployment pipeline. Development remains local Docker Compose only.

## Security rules

- UI role hiding is cosmetic. Every backend mutation/query checks Cognito claims and resource ownership.
- Cognito group precedence does not replace product entitlements or credit ledger checks.
- S3 never exposes public read/write. Signed URLs are scope- and time-limited.
- Store only opaque device IDs and approved run metadata. Do not persist LAN reachability or device credentials.
- Encrypt secrets with Secrets Manager/KMS; never build them into UI or Lambda environment configuration.
- Add WAF, audit logs, retention policies, and production frontend origin before public launch.

## Algorithm evolution

Python parity tests and existing Matlab lineage are source evidence. Each production algorithm needs: a named input contract, semantic version, golden fixtures, expected metrics/artifact manifest, resource profile, and rollback-compatible output schema. Do not rewrite an algorithm for Lambda until its Python version has parity evidence.

## Open decisions

- Payment provider, tax/shipping, fulfillment, returns, and invoices.
- Hosted UI domain and final production CORS origin.
- Cognito hosted UI versus custom auth experience and MFA policy.
- PSIU firmware CORS/auth/upload endpoint details from tested device documentation.
- Credit ledger rules: expiration, refunds, bundles, role-based price policy, and concurrency/hold behavior.
- RDS Data API versus VPC-resident API service; migration runner and connection pool strategy.
