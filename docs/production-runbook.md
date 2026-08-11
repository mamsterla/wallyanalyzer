# Production Foundation Runbook

## Environments

- **Development:** local Docker Compose only. It runs `app-server` and Postgres on loopback ports; it does not use AWS credentials.
- **Production:** account `265404809336`, region `us-east-1`, deployed from `main` through CodePipeline after its source connection is available.

Use the AWS CLI profile explicitly for operator commands:

```bash
AWS_PROFILE=wallyanalyzer AWS_REGION=us-east-1 npm run synth
```

## Private production posture

The production CDK stack has no public ALB, API Gateway, public DNS, public S3 bucket, NAT gateway, or browser CORS origin. ECS tasks, RDS PostgreSQL, and RDS Proxy are isolated in a VPC. Tasks use S3 gateway and interface VPC endpoints for ECR, CloudWatch Logs, Secrets Manager, Cognito IDP, and SES APIs.

Do not add public ingress, NAT, a domain, or production CORS without an approved architecture change.

## Deployment pipeline

`WallyPlatform-production` creates `wally-analyzer-production`:

1. CodeConnections source: `mamsterla/wallyanalyzer`, branch `main`.
2. CodeBuild validation: dependency install, TypeScript checks, full workspace build, tests, and CDK synth.
3. CodeBuild deployment: repeated checks/build/tests, then CDK deploy with no interactive approval.

The CodeConnection ARN is bound in `infra/bin/app.ts`. Confirm the connection remains `AVAILABLE` before deploying the stack.

## Database and migrations

Production uses standard RDS for PostgreSQL 18.3, encrypted storage, private subnets, 14-day backups, deletion protection, and TLS-required RDS Proxy. Credentials are generated in Secrets Manager. The ECS startup path runs ordered, checksummed SQL migrations under a Postgres advisory lock before serving requests; it records applied migrations and safely recognizes the pre-migration local baseline. Do not expose the database or run migrations from a browser.

## Identity and fulfillment

Cognito self-service signup is disabled. Accounts are created by admin fulfillment only. Fulfillment persists a Cognito subject, user account state, PSIU serial/opaque UID assignment history, and immutable audit event in Postgres. It does not store PSIU credentials or LAN addresses.

SES production delivery is deferred. `AdminCreateUser` is suppressed until `wallyanalyzer.com` has an approved SES identity, DKIM/SPF/DMARC, and production SES access. Do not send fulfillment invitations from the stack before then.

The private ECS service has no public ingress. Browser access and custom domain/CORS configuration are intentionally deferred; only controlled private-network callers can use the admin fulfillment route.
