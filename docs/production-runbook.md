# Production Foundation Runbook

## Environments

- **Development:** local Docker Compose only; application port `8081`, PostgreSQL port `5431`.
- **Production:** account `265404809336`, region `us-east-1`. ECS, RDS, RDS Proxy, Cognito, S3, and the bastion remain private. The ALB is the only public resource.

Use `AWS_PROFILE=wallyanalyzer AWS_REGION=us-east-1` for every operator command.

## Domain activation model

Canonical domain: `wally-analytics.app`. OpenSRS is registrar. Route 53 hosted zone `Z0640322GREKLUZ06W3O` is already delegated and must never be deleted or recreated.

The normal CodePipeline deployment is **foundation only**. During the current recovery it passes `retainManagedDomainResources=true` to retain the existing CloudFormation logical hosted-zone/certificate resources while preserving their physical resources. It does not request ACM and cannot wait for DNS validation. The CodePipeline deploy action must not receive `applicationActivation=true`.

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

## Private database operator access

The bastion has no public IP or inbound SSH. Use Session Manager only and port forward through it to the RDS Proxy. Do not expose RDS, RDS Proxy, or the bastion.
