---
description: Plan, implement, validate, and review a scoped Wally Analyzer feature
argument-hint: "[feature request]"
---

Run the Wally Analyzer feature-build workflow for: $@

## Purpose

Deliver one scoped feature with requirements clarity, evidence-based discovery, one writer, focused validation, and review. Keep this lighter than the Electroscope workflow: no required telemetry schema, snapshot gate, post-commit hooks, custom model policy, or multiple specialized project agents.

## Rules

- Read `AGENTS.md`, `docs/architecture.md`, `docs/agentic-workflow.md`, and relevant contracts before planning.
- Preserve pre-existing working-tree changes. Never reset, stash, or overwrite unrelated work.
- Ask one focused clarification question before editing if requirements affect payments, credits, pricing, RBAC, data retention, AWS cost/destruction, public API contracts, or PSIU firmware behavior.
- Use one writer only. Reviewers do not edit source files.
- Use a new branch only when working tree is clean and user asks for one. Otherwise work from current branch and report its state.

## Discovery

1. Inspect branch/status and identify expected paths.
2. For TypeScript/Python symbol, caller, callee, impact, or test questions: use **CodeGraph first**. Confirm critical results in source/tests.
3. For cross-surface work involving app UI, API, CDK, algorithms, and docs: run:
   ```bash
   node .pi/build/graphify-preflight.mjs --scope <path> "<question>"
   ```
   Use Graphify only when preflight finds a usable graph or a bounded graph build is worthwhile. Graphify is advisory; confirm critical facts in files. Do not build a large semantic graph without available model credentials or explicit user approval.
4. Produce a compact plan: scope, files, contracts/data effects, security implications, tests, and validation commands.

## Delivery loop

1. Ask `oracle` for an advisory challenge before edits when scope crosses identity/RBAC, payments/credits, AWS infrastructure, migrations, or algorithm provenance.
2. Use `worker` as sole writer to implement approved plan and focused tests.
3. Run relevant checks. At minimum use `npm run check`; run `npm run synth` for CDK changes; run Python tests for algorithm changes.
4. Use fresh-context `reviewer` tasks after implementation:
   - correctness/tests for all non-trivial changes;
   - security/ownership/RBAC for API, auth, S3, database, or CDK changes;
   - UI/accessibility for user-facing changes.
5. Apply only blocking or user-approved review findings with one writer. Re-run focused validation and one repair-delta review if code changed.

## Final response

Return: requirements/assumptions, discovery evidence, plan, files changed, tests/validation, accepted review fixes, deferred findings, and residual risks. State when work is blocked or only planned.
