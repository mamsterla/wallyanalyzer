# Agentic Delivery Workflow

`pi-subagents` is installed at project scope in `.pi/settings.json`. Built-in agents provide the initial roles; no custom agent should override an approved architecture decision.

## Standard feature loop

1. **Scout** — read relevant docs, contracts, call paths, existing tests, and deployment boundaries. Output facts, affected files, and unresolved questions; no edits.
2. **Clarify** — ask user when product, pricing, security, irreversible data, or architecture choices remain open.
3. **Planner / Oracle** — planner proposes bounded implementation; oracle challenges cross-cutting assumptions for payments, identity, data retention, or AWS boundaries. No edits until scope is approved.
4. **Worker** — one writer edits implementation and tests. Never run concurrent writers in shared worktree.
5. **Reviewers** — run fresh-context reviews in parallel for correctness/security and test/operability. Reviewers cite file/line evidence and do not edit unless user requests a fix pass.
6. **Worker** — applies accepted review findings and runs targeted validation.

## Recommended task routing

| Work type | First agent | Required review angle |
| --- | --- | --- |
| React UI | scout | accessibility, auth/UI state |
| API/RBAC | scout then oracle | authorization, tenant isolation, input validation |
| CDK/AWS | oracle | least privilege, cost, removal/retention, deploy rollback |
| Algorithms | scout + researcher | Matlab/Python parity, fixture coverage, resource limits |
| PSIU integration | researcher + scout | documented device contract, CORS, LAN privacy |
| SQL/migrations | oracle | migration safety, locks, rollback/data retention |

## Definition of done

- Contract and authorization changes are server-enforced and tested.
- Object metadata and immutable artifacts have provenance/algorithm version.
- CDK synthesis succeeds for staging; production-sensitive retention/CORS changes are reviewed.
- Relevant workspace checks/build/tests pass.
- Remaining decisions are documented rather than silently guessed.

## Invocation examples

- `Use scout to map the sample upload flow, then ask clarification questions.`
- `Ask oracle to challenge this RDS migration and RBAC plan before edits.`
- `Have worker implement approved plan, then run parallel reviews for security and tests.`
