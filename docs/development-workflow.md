# Development Workflow

Use `/build-feature <request>` in Pi for scoped feature delivery. The project-local extension queues `/build-feature-workflow <request>`.

## Tooling

- **CodeGraph:** initialized locally in `.codegraph/`; use it first for code-symbol, caller/callee, impact, and affected-test discovery. Refresh with `codegraph sync .` after meaningful changes.
- **Graphify:** installed globally. Use `node .pi/build/graphify-preflight.mjs --scope <path> "<question>"` for cross-surface architecture or documentation work. It finds a scoped graph when one exists and recommends a bounded query/build. Do not force semantic extraction for small edits or without model credentials.
- **Subagents:** project-local `pi-subagents` provides `scout`, `oracle`, `worker`, and `reviewer`. One writer only; parallelism is for discovery and review.

## Baseline validation

| Scope | Required validation |
| --- | --- |
| TypeScript app/API/contracts | `npm run check` |
| CDK | `npm run check && npm run synth` |
| React UI | `npm run check && npm run build` |
| Python algorithms | relevant `pytest` tests and parity fixture checks |

The feature workflow reads `AGENTS.md` and architecture docs, protects uncommitted work, clarifies high-risk product decisions, uses CodeGraph/Graphify conditionally, and runs review after implementation.
