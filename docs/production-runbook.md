# Production Foundation Runbook

## Environments

- **Development:** local Docker Compose only; application port `8081`, PostgreSQL port `5431`.
- **Production:** account `265404809336`, region `us-east-1`. ECS, RDS, RDS Proxy, Cognito, S3, and the bastion remain private. The ALB is the only public resource.

Use `AWS_PROFILE=wallyanalyzer AWS_REGION=us-east-1` for every operator command.

## Node base image

Local and production image builds use AWS Public ECR directly:

```text
public.ecr.aws/docker/library/node:24-alpine
```

The Dockerfile and CDK asset both set this image explicitly. CodeBuild does not pull from Docker Hub, authenticate to a private base-image registry, or use an ECR pull-through cache. The existing deployment project can deploy this source because the Dockerfile default is already AWS Public ECR.

## Domain activation model

Canonical domain: `wally-analytics.app`. OpenSRS is registrar. Route 53 hosted zone `Z0640322GREKLUZ06W3O` is already delegated and must never be deleted or recreated.

After the first successful activation, the normal CodePipeline deployment includes `applicationActivation=true` to preserve the established HTTPS listener, ACM certificate, and aliases in the delegated hosted zone. It must use `applicationHostedZoneId=Z0640322GREKLUZ06W3O` and must not use `retainManagedDomainResources=true`; that recovery bridge creates a different hosted zone and can cause public DNS outage. New certificate issuance remains a separately approved manual activation action.

Domain activation is a separate manually-started CodePipeline. Its GitHub `main` source action has push triggers disabled, then a human approval gate precedes the DNS-preflighted activation build. It is safe to start only after both public resolvers return exactly these nameservers:

```text
ns-723.awsdns-26.net
ns-386.awsdns-48.com
ns-1026.awsdns-00.org
ns-1580.awsdns-05.co.uk
```

## Recovery after cancelled domain updates

1. Wait for CloudFormation to reach a terminal rollback state. Do not start another deployment while it is updating or cleaning up.
2. If CloudFormation attempts to delete `ApplicationHostedZone7F33F27F`, retain/skip that logical resource in rollback. It is the live delegated zone `Z0640322GREKLUZ06W3O`.
3. Reconcile stale A/AAAA records only after rollback is terminal:

```bash
aws route53 list-resource-record-sets --hosted-zone-id Z0640322GREKLUZ06W3O
```

Keep only NS/SOA before activation. Delete stale apex or `www` A/AAAA alias records from cancelled attempts with an explicit `DELETE` change batch. Do not delete ACM validation CNAMEs while an active certificate references them. Never delete the hosted zone.
4. Deploy foundation. It imports the zone and leaves the old active listener/certificate untouched.

## Foundation deploy context

```bash
cd infra
npx cdk deploy WallyPlatform-production -c environment=production \
  -c applicationHostedZoneId=Z0640322GREKLUZ06W3O \
  -c applicationExpectedNameServers=ns-723.awsdns-26.net,ns-386.awsdns-48.com,ns-1026.awsdns-00.org,ns-1580.awsdns-05.co.uk \
  -c legacyApplicationCertificateArn=arn:aws:acm:us-east-1:265404809336:certificate/52ff0b5a-79fb-4504-ac2e-9c5ce89f303c \
  --require-approval never
```

## Explicit HTTPS activation

Run this only with separate approval after the foundation deployment succeeds. The activation build fails fast if either Cloudflare `1.1.1.1` or Google `8.8.8.8` returns a different NS set. This avoids a CodeBuild/CDK ACM wait timeout.

```bash
ACTIVATION_PIPELINE=wally-analyzer-domain-activation
EXECUTION_ID=$(aws codepipeline start-pipeline-execution --name "$ACTIVATION_PIPELINE" \
  --client-request-token "domain-activation-$(date +%s)" --query pipelineExecutionId --output text)
printf 'Approve execution %s in the CodePipeline console after verifying DNS delegation.\n' "$EXECUTION_ID"
```

In the CodePipeline console, approve `ApproveDomainActivation`. The build uses the source artifact from the manually started execution, runs `infra/scripts/domain-activation-preflight.sh`, then deploys with `applicationActivation=true`. It never starts automatically from a `main` push.

Activation requests an ACM certificate for apex and `www`, creates Route 53 aliases, redirects HTTP to HTTPS and `www` to apex, and changes browser runtime configuration to the canonical hostname. If the certificate is already issued and the listener/aliases already match the desired state, CDK reports no changes and the activation execution succeeds. Do not detach or delete the old certificate/listener until the new certificate is `ISSUED`, the listener is healthy, and `https://wally-analytics.app/health` returns `200`.

## Isolated report smoke workflow

Run this only after a reviewed deployment has created `ReportSmokeRunnerFunctionName` **and an operator has completed the one-time private database bootstrap below**. It creates no customer records: it migrates only `wally_report_smoke`, writes a deterministic 60-second stereo 48 kHz PCM 1 kHz fixture under `smoke/raw/`, invokes the isolated dispatcher/state machine, validates immutable artifact/provenance records, then deletes its synthetic rows and exact smoke objects on success. Failures retain only smoke-database and smoke-prefix diagnostics.

### One-time smoke database bootstrap

CloudFormation never deploys a Lambda or service role that can read the platform-admin database credential. Before the first runner invocation, an approved database operator must start a private SSM port-forward to the RDS Proxy, then run `app-server/scripts/bootstrap-smoke-database.mjs` from the reviewed source checkout with their short-lived AWS identity. The script reads the two secret references in memory, creates or updates only the `wally_report_smoke` login/database, and exits; it does not print, persist, or export secret values. Use the stack's database-proxy endpoint and report-smoke secret ARN, discover the master secret ARN through approved RDS operator access, and pass only ARNs/host/database as arguments. Do not grant this access to Lambda, ECS, CodeBuild, or Step Functions.

```bash
node app-server/scripts/bootstrap-smoke-database.mjs \
  --proxy-host=127.0.0.1 --proxy-port=5432 \
  --tls-servername=applicationdatabaseproxy.proxy-….us-east-1.rds.amazonaws.com \
  --master-secret-arn=arn:... --smoke-secret-arn=arn:... \
  --database=wally_report_smoke
```

The runner, smoke workflow, and smoke worker receive only the smoke secret and cannot read the platform-admin secret. The CDK smoke assertion verifies this boundary and that the dispatcher targets only the isolated state machine.

```bash
SMOKE_RUNNER=$(aws cloudformation describe-stacks --stack-name WallyPlatform-production \
  --query "Stacks[0].Outputs[?OutputKey=='ReportSmokeRunnerFunctionName'].OutputValue" --output text)
aws lambda invoke --function-name "$SMOKE_RUNNER" --cli-binary-format raw-in-base64-out \
  --payload '{}' /tmp/wally-report-smoke-result.json
cat /tmp/wally-report-smoke-result.json
```

Do not invoke the individual smoke dispatcher or state-machine functions, use production `raw/` or `reports/` keys, read the smoke secret, or manually remove failure diagnostics before incident review. A successful response reports only the smoke correlation ID and `completed`; it never returns credentials or audio bytes.

## Private database operator access

The bastion has no public IP or inbound SSH. Use Session Manager only and port forward through it to the RDS Proxy. Do not expose RDS, RDS Proxy, or the bastion.
