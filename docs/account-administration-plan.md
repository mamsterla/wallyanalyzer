# Account administration milestone

## Implemented vertical slice

- Admins create detached durable customer records before Cognito identities.
- Customer lifecycle is `draft`, `ready`, `invited`, `active`, `suspended`, or `cancelled`.
- Admins enroll PSIU inventory with the exact manual UID read from firmware `GET /status`; no LAN host or credentials are stored.
- Each enabled unit has at most one active assignment and each customer at most one active unit.
- Invite creates a Cognito user with Cognito's default email, then records its subject and invitation atomically from the durable system perspective. Failure after Cognito creation deletes that identity.
- First successful verified access-token request changes `invited` to `active`.
- Archive closes active assignments, preserves durable/audit history, deletes the Cognito identity, and reserves the email permanently.
- Browser authentication calls Cognito directly. Access tokens are passed to the API; credentials never transit the API.

## Release prerequisites

Do not deploy or use these credential routes over the temporary HTTP ALB. Before production release, approve and implement:

1. Route 53 authoritative DNS cutover while Wix remains registrar: copy all existing Wix records, change Wix nameservers to the Route 53 output, and validate apex/`www` HTTPS routing. The stack manages ACM DNS validation and A/AAAA ALB Alias records.
2. The current Cognito pool had zero users, so the replacement pool enables mutable standard `email` before initial account creation. No identity migration is needed while the pool remains empty.
3. Cognito callback/logout configuration for the approved UI origin and operational test accounts.

## API surface

All `/v1/*` routes require a Cognito access token verified against the configured pool/client. The server then resolves the token subject to an active durable account and checks the matching durable role. UI guards are not authorization.

- `GET /v1/me`, `GET /v1/me/units`
- `GET|POST /v1/admin/customers`
- `POST /v1/admin/customers/:id/invite|reset-password|suspend|restore`
- `DELETE /v1/admin/customers/:id`
- `GET|POST /v1/admin/psiu-units`
- `POST /v1/admin/psiu-units/:id/assign|deassign|enable|disable`

## Operator validation

Production migration history was verified through the private SSM bastion before adding `0003`. Apply only through the existing task startup migration runner after an approved deployment. Do not introduce Prisma Migrate concurrently.
