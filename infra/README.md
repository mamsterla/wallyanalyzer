# Infrastructure

The production CDK stack provisions a VPC, private RDS PostgreSQL and RDS Proxy, Cognito, private S3 artifact buckets, private ECS/Fargate application tasks, and a CodePipeline deployment path from `main`.

## Commands

```bash
npm install
npm run synth --workspace=@wally/infra
npm run deploy:production --workspace=@wally/infra
```

Use the `wallyanalyzer` AWS profile and review `docs/production-runbook.md` before deployment.

## Public HTTPS application and Route 53 DNS

The ALB is the only public resource. Foundation deployment keeps the existing browser listener and certificate active. The separately approved `applicationActivation=true` deploy adds canonical HTTPS for `wally-analytics.app`, redirects HTTP and `www` to the apex, and writes Route 53 aliases. Tasks have no public IP or NAT. RDS, RDS Proxy, Cognito, and S3 remain private.

Route 53 zone `Z0640322GREKLUZ06W3O` is externally delegated and imported by context; CDK must never create, replace, or delete it. See `docs/production-runbook.md` for required context, DNS preflight, activation, and rollback recovery.

The stack creates the public Route 53 hosted zone, apex and `www` A/AAAA ALB Alias records, and ACM DNS validation records for both hostnames. Wix remains registrar. After deployment, copy every required existing Wix record to Route 53, then replace Wix nameservers with the four values from the `ApplicationAuthoritativeNameServers` output. Do not assume missing public lookup records means email or third-party records are absent. See `docs/production-runbook.md` for cutover, validation, and rollback.

Production public Cognito identifiers and the API origin are injected at container startup into `/runtime-config.js`. They are public client configuration, not secrets. The image does not embed environment-specific Cognito IDs. PSIU browser control stays local until the device firmware supplies CORS headers on normal requests.

## Failed first-deployment recovery

The recorded `WallyPlatform-production` failed attempt is `ROLLBACK_COMPLETE`. Before recovery, reconfirm that no identities or data exist. The verified failed-stack artifacts are three empty buckets (`wallyplatform-production-productionpipelineartifac-rbw9dwg13uz3`, `wallyplatform-production-reportbucket577f0fcd-lb401ovvwcjo`, and `wallyplatform-production-samplebucket7f6f8160-wzqhje7d8yup`); empty user pool `us-east-1_KeHJ2FGHJ`; bootstrap secret ARN ending `BootstrapAdministratorSecre-SsuabW3E0NxI-KPQWKq`; zero-byte log group `WallyPlatform-production-ApplicationLogGroupE33FCF9B-L1lqxvMfJ4ph`; and unused DB subnet group `wallyplatform-production-applicationdatabasesubnetgroup242bc54f-sigs1xqsy3fn`.

Delete and wait for the failed stack first so CloudFormation removes non-retained dependencies. Then revalidate and delete only those retained artifacts. Do not delete the separate older buckets ending `wtgaoqbqz6su`, `jh5ymbjhx7d2`, or `lpkd7hdlkktx`; they are outside this recovery scope. `docs/production-runbook.md` contains the exact ordered commands. The repaired VPC uses `us-east-1c` and `us-east-1d` and retains original isolated subnet CIDRs before allocating ALB public subnets.

## Remaining deployment work

- Add WAF and configure the external apex DNS record for the public HTTPS origin.
- Create and validate initial Cognito administrator and fulfillment workflows.
- Replace analysis-worker placeholder with versioned Lambda container/Fargate implementations.
- Add S3 event validation and durable sample/job writes before starting workflow executions.
