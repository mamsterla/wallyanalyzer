# Production Foundation Runbook

## Environments

- **Development:** local Docker Compose only; application port `8081`, PostgreSQL port `5431`.
- **Production:** account `265404809336`, region `us-east-1`. ECS, RDS, RDS Proxy, Cognito, S3, and the bastion remain private. The ALB is the only public resource.

Use `AWS_PROFILE=wallyanalyzer AWS_REGION=us-east-1` for every operator command.

## Domain activation model

Canonical domain: `wally-analytics.app`. OpenSRS is registrar. Route 53 hosted zone `Z0640322GREKLUZ06W3O` is already delegated and must never be deleted or recreated.

The normal CodePipeline deployment is **foundation only**. During the current recovery it passes `retainManagedDomainResources=true` to retain the existing CloudFormation logical hosted-zone/certificate resources while preserving their physical resources. It does not request ACM and cannot wait for DNS validation. The CodePipeline deploy action must not receive `applicationActivation=true`.

Domain activation is a separate manual, approved command. It is safe to run only after both public resolvers return exactly these nameservers:

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

Run this only with separate approval after the foundation deployment succeeds. The preflight fails fast if either Cloudflare `1.1.1.1` or Google `8.8.8.8` returns a different NS set. This avoids a CodeBuild/CDK ACM wait timeout.

```bash
export APPLICATION_DOMAIN=wally-analytics.app
export EXPECTED_NAME_SERVERS=ns-723.awsdns-26.net,ns-386.awsdns-48.com,ns-1026.awsdns-00.org,ns-1580.awsdns-05.co.uk
bash infra/scripts/domain-activation-preflight.sh

cd infra
npx cdk deploy WallyPlatform-production -c environment=production \
  -c applicationHostedZoneId=Z0640322GREKLUZ06W3O \
  -c applicationExpectedNameServers="$EXPECTED_NAME_SERVERS" \
  -c legacyApplicationCertificateArn=arn:aws:acm:us-east-1:265404809336:certificate/52ff0b5a-79fb-4504-ac2e-9c5ce89f303c \
  -c applicationActivation=true --require-approval never
```

Activation requests an ACM certificate for apex and `www`, creates Route 53 aliases, redirects HTTP to HTTPS and `www` to apex, and changes browser runtime configuration to the canonical hostname. Do not detach or delete the old certificate/listener until the new certificate is `ISSUED`, the listener is healthy, and `https://wally-analytics.app/health` returns `200`.

## Private database operator access

The bastion has no public IP or inbound SSH. Use Session Manager only and port forward through it to the RDS Proxy. Do not expose RDS, RDS Proxy, or the bastion.
