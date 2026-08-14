# Wally Analyzer Project Instructions

Read `docs/architecture.md`, `docs/agentic-workflow.md`, `docs/development-workflow.md`, and relevant existing algorithm contracts before cross-cutting changes.

- Keep raw audio and report artifacts in S3; transactional/queryable metadata in Postgres.
- Enforce Cognito roles (`user`, `installer`, `admin`) and ownership in backend code. UI guards never replace authorization.
- Do not invent PSIU REST endpoints. Confirm them against `docs/API.pdf` and tested firmware.
- Keep algorithm version, input metadata, and artifact provenance durable and backward-compatible.
- For nontrivial work: use `/build-feature-workflow`; CodeGraph first for structural discovery, Graphify conditionally for cross-surface architecture.
- One writer edits project files. Parallel subagents only scout or review.
- Use Docker Compose for local services. Keep local development to the approved two containers unless explicit approval expands it.
- Do not deploy, expose AWS resources publicly, or change production retention/CORS without explicit approval.
- Store all passwords and secrets in AWS Secrets Manager. Do not place secret values in environment variables, source control, CI/CD variables, logs, chat, or browser bundles. ECS/CodeBuild may receive only secret ARNs/references and must retrieve values through workload-scoped AWS SDK access at runtime.
