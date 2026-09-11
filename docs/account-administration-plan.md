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
- `GET /v1/admin/users?limit=&cursor=&q=&lifecycle=` is a cursor-paginated user directory. Empty `q` browses; nonempty search requires two characters and matches email, name, and active PSIU serial.
- `GET /v1/admin/users/typeahead?q=` requires two characters.
- `GET|PUT /v1/admin/users/:id` reads/updates a role-`user` customer. `PUT` permits name/address only; email is immutable.
- `GET|POST /v1/admin/psiu-units?limit=&cursor=&q=&status=&assignment=` is a cursor-paginated inventory directory. Search matches serial, immutable UID, and current owner name/email.
- `POST /v1/admin/psiu-units/:id/assign|deassign|enable|disable`

Password reset is delivery-only through Cognito for Cognito-linked `invited` or `active` customers. It records `customer.password_reset_requested` without delivery data or secrets. Suspended, draft, ready, and cancelled customers must be restored/invited through their lifecycle before a reset can be requested.

## Operator validation

Production migration history was verified through the private SSM bastion before adding `0003`. Apply only through the existing task startup migration runner after an approved deployment. Do not introduce Prisma Migrate concurrently.

## Directory APIs

Admins may use `GET /v1/admin/users/typeahead?q=` after two characters to select a customer. `GET /v1/admin/samples` accepts owner-scoped `ownerId` plus two-character `q` matching customer name/email and PSIU serial/UID. `GET /v1/admin/reports` provides paginated administrative report search by two-character user/system query, report type, status, and preset. These routes remain admin-authorized.
