# Infrastructure

The production CDK stack provisions a VPC, private RDS PostgreSQL and RDS Proxy, Cognito, private S3 artifact buckets, private ECS/Fargate application tasks, and a CodePipeline deployment path from `main`.

## Commands

```bash
npm install
npm run synth --workspace=@wally/infra
npm run deploy:production --workspace=@wally/infra
```

Use the `wallyanalyzer` AWS profile and review `docs/production-runbook.md` before deployment.

## Temporary restricted browser URL

The stack creates a public ALB only to expose a temporary HTTP URL to `47.150.127.7/32`. The ALB is in public subnets and forwards HTTP port 80 to private ECS tasks in isolated subnets. Tasks have no public IP or NAT. RDS, RDS Proxy, Cognito, and S3 remain private.

The temporary ALB hostname has no TLS certificate. Treat the URL as HTTP-only and do not use it for sensitive production data.

## Custom domain phase 1

The stack requests a public ACM certificate for `wallyanalytics.app` with manual DNS validation. It is an `AWS::CertificateManager::Certificate` in `us-east-1`, and no hosted-zone lookup or Route 53 record is created because DNS is externally managed. This phase does not create an HTTPS listener, alter ALB security groups, attach the certificate, redirect HTTP, or create the final application DNS record.

After deployment, retrieve the `ApplicationCertificateArn` CloudFormation output and use `aws acm describe-certificate` to obtain ACM's `DomainValidationOptions[0].ResourceRecord`. Publish that exact CNAME at the external DNS provider, then wait for the certificate to become `ISSUED`. The later reviewed phase attaches it to the ALB, redirects port 80, and creates the DNS target for `wallyanalytics.app`. See `docs/production-runbook.md` for commands.

The static React application is available for restricted review only. Cognito login and admin fulfillment screens are not implemented yet. PSIU browser control stays local until the device firmware supplies CORS headers on normal requests.

## Failed first-deployment recovery

The recorded `WallyPlatform-production` failed attempt is `ROLLBACK_COMPLETE`. Before recovery, reconfirm that no identities or data exist. The verified failed-stack artifacts are three empty buckets (`wallyplatform-production-productionpipelineartifac-rbw9dwg13uz3`, `wallyplatform-production-reportbucket577f0fcd-lb401ovvwcjo`, and `wallyplatform-production-samplebucket7f6f8160-wzqhje7d8yup`); empty user pool `us-east-1_KeHJ2FGHJ`; bootstrap secret ARN ending `BootstrapAdministratorSecre-SsuabW3E0NxI-KPQWKq`; zero-byte log group `WallyPlatform-production-ApplicationLogGroupE33FCF9B-L1lqxvMfJ4ph`; and unused DB subnet group `wallyplatform-production-applicationdatabasesubnetgroup242bc54f-sigs1xqsy3fn`.

Delete and wait for the failed stack first so CloudFormation removes non-retained dependencies. Then revalidate and delete only those retained artifacts. Do not delete the separate older buckets ending `wtgaoqbqz6su`, `jh5ymbjhx7d2`, or `lpkd7hdlkktx`; they are outside this recovery scope. `docs/production-runbook.md` contains the exact ordered commands. The repaired VPC uses `us-east-1c` and `us-east-1d` and retains original isolated subnet CIDRs before allocating ALB public subnets.

## Remaining deployment work

- Add a custom domain, ACM certificate, WAF, and approved frontend origin.
- Implement custom Cognito login and admin fulfillment UI.
- Replace analysis-worker placeholder with versioned Lambda container/Fargate implementations.
- Add S3 event validation and durable sample/job writes before starting workflow executions.
