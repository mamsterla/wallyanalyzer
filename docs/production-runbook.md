# Production Foundation Runbook

## Environments

- **Development:** local Docker Compose only. It runs `app-server` and Postgres on loopback ports; it does not use AWS credentials.
- **Production:** account `265404809336`, region `us-east-1`, deployed from `main` through CodePipeline after its source connection is available.

Use the AWS CLI profile explicitly for operator commands:

```bash
AWS_PROFILE=wallyanalyzer AWS_REGION=us-east-1 npm run synth
```

## Production network posture

The temporary browser path is a public Application Load Balancer (ALB) HTTP listener. Its security group permits port 80 only from `47.150.127.7/32`. The ALB is the only public Wally resource; it forwards only to port 80 on private ECS tasks. ECS tasks remain in isolated subnets without public IPs or NAT. RDS PostgreSQL, RDS Proxy, Cognito, and S3 remain non-public. Tasks use the S3 gateway endpoint with AWS-managed prefix-list HTTPS egress for ECR image layers, plus interface endpoints for ECR, CloudWatch Logs, Secrets Manager, Cognito IDP, SES, Lambda, Step Functions, and Systems Manager APIs.

The temporary URL is HTTP only and sends traffic without TLS encryption. Do not use it on untrusted networks or enter sensitive production data. Its ALB hostname is not a replacement for the final hostname `wallyanalytics.app`. Do not add NAT or widen ingress without an approved architecture change.

## Custom domain phase 1: ACM DNS validation

The first custom-domain deployment creates a regional ACM public certificate for `wallyanalytics.app` with manual DNS validation. It does **not** attach the certificate to the ALB, create a port-443 listener, change the HTTP listener, change ALB security-group rules, or create an application DNS record. The existing restricted `47.150.127.7/32:80` path remains unchanged.

After the approved deployment completes, retrieve the CNAME required by ACM and create it at the external DNS provider exactly as returned. Do not use an ALIAS, URL redirect, or proxy record for certificate validation:

```bash
export AWS_PROFILE=wallyanalyzer AWS_REGION=us-east-1
STACK=WallyPlatform-production
CERTIFICATE_ARN=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='ApplicationCertificateArn'].OutputValue | [0]" --output text)
aws acm describe-certificate --certificate-arn "$CERTIFICATE_ARN" \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord.{Name:Name,Type:Type,Value:Value}' --output table
aws acm wait certificate-validated --certificate-arn "$CERTIFICATE_ARN"
```

The domain provider must publish the returned `Name`, `Type` (`CNAME`), and `Value`. Confirm `ISSUED` before approving phase 2. Phase 2 will attach this certificate to an HTTPS listener, redirect port 80 to HTTPS, make the final application DNS record point to the ALB, and replace the temporary CIDR-only HTTP access with approved HTTPS ingress. It requires a separate review and approval.

The existing Cognito pool had zero users when this phase was approved, so its standard `email` attribute is now mutable. The synthesized CDK diff identifies this as an in-place UserPool schema update, not a replacement. Review the CloudFormation change set before deployment and do not create users until the update completes.

## Private database operator access

The bastion has no public IP and no inbound SSH rule. Access it only with an IAM principal authorized for Session Manager, then use the SSM port-forwarding document to the RDS Proxy endpoint. Its security group can reach only the dedicated SSM, SSM Messages, and EC2 Messages interface endpoints on TCP/443, plus RDS Proxy on TCP/5432. The bastion cannot reach the ECS workload endpoints (ECR, Logs, Secrets Manager, Cognito, SES, Lambda, or Step Functions). ECS tasks retain their separate proxy and workload-endpoint rules. Do not expose the bastion, RDS, or RDS Proxy publicly.

Before production deployment, synthesize the template and confirm: endpoint services support `us-east-1c` and `us-east-1d`; application-task egress includes TCP/443 to the S3 managed prefix list and endpoint SG only; tasks are Linux/x86_64; ALB ingress is only `47.150.127.7/32:80`; RDS, ECS tasks, and bastion have no public IP; and any failed retained RDS instance is deleted or explicitly adopted before its VPC is removed.

## ECS diagnostic deployment

Use this mode only to investigate a task-start failure after an approved cleanup. It creates the same VPC, RDS, RDS Proxy, task definitions, and restricted ALB as production, but creates no running application service task and no CodePipeline. It therefore cannot autonomously deploy `desiredCount: 1` while task evidence is collected.

Deploy the diagnostic stack with the explicit context flag:

```bash
cd infra
AWS_PROFILE=wallyanalyzer AWS_REGION=us-east-1 npx cdk deploy WallyPlatform-production \
  -c environment=production -c diagnosticMode=true --require-approval never
```

Read the stack outputs, then run one application task on the production-equivalent private network. Do not add a public IP:

```bash
export AWS_PROFILE=wallyanalyzer AWS_REGION=us-east-1
STACK=WallyPlatform-production
CLUSTER=$(aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='ApplicationClusterArn'].OutputValue | [0]" --output text)
TASK_DEFINITION=$(aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='ApplicationTaskDefinitionArn'].OutputValue | [0]" --output text)
SUBNETS=$(aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='PrivateSubnetIds'].OutputValue | [0]" --output text)
SECURITY_GROUP=$(aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='PrivateTaskSecurityGroupId'].OutputValue | [0]" --output text)
LOG_GROUP=$(aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='ApplicationLogGroupName'].OutputValue | [0]" --output text)
TASK_ARN=$(aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE --task-definition "$TASK_DEFINITION" \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUP],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)
printf 'Diagnostic task: %s\n' "$TASK_ARN"

# This returns nonzero if the task is still running after approximately 10 minutes.
if ! aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN"; then
  echo 'Task did not stop within the waiter window; record its current state before deciding whether to stop it.' >&2
fi
aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
  --query 'tasks[0].{lastStatus:lastStatus,desiredStatus:desiredStatus,stoppedReason:stoppedReason,stopCode:stopCode,containers:containers[].{name:name,lastStatus:lastStatus,exitCode:exitCode,reason:reason,logStreamName:logStreamName}}' \
  --output json
aws logs tail "$LOG_GROUP" --since 30m --format short || true
```

Collect and retain the final task state, stopped-task reason, stop code, container exit code/reason/log stream, and `wally-app` CloudWatch logs before any cleanup. If the task remains running after the waiter window, record this output, then explicitly stop it only if needed. After fixing the verified cause, deploy without `diagnosticMode`; that restores application `desiredCount: 1` and creates the CodePipeline:

```bash
AWS_PROFILE=wallyanalyzer AWS_REGION=us-east-1 npx cdk deploy WallyPlatform-production \
  -c environment=production --require-approval never
```

## Failed first-deployment recovery

Use this procedure only for the recorded `WallyPlatform-production` `ROLLBACK_COMPLETE` attempt. Before cleanup, reconfirm that the resources below contain no identities or data. The verified state at the time of this runbook update was: all three buckets had no object versions or delete markers; Cognito pool `us-east-1_KeHJ2FGHJ` had zero users; and the log group had zero stored bytes. No database instance was created.

The failed stack still owns non-retained dependencies such as bucket policies, the Cognito client, and Cognito groups. Delete the failed stack first and wait for completion so CloudFormation removes those dependencies while retaining only these parent artifacts:

```text
wallyplatform-production-productionpipelineartifac-rbw9dwg13uz3
wallyplatform-production-reportbucket577f0fcd-lb401ovvwcjo
wallyplatform-production-samplebucket7f6f8160-wzqhje7d8yup
us-east-1_KeHJ2FGHJ
arn:aws:secretsmanager:us-east-1:265404809336:secret:BootstrapAdministratorSecre-SsuabW3E0NxI-KPQWKq
WallyPlatform-production-ApplicationLogGroupE33FCF9B-L1lqxvMfJ4ph
wallyplatform-production-applicationdatabasesubnetgroup242bc54f-sigs1xqsy3fn
```

Do not delete the separate older bucket set with suffixes `wtgaoqbqz6su`, `jh5ymbjhx7d2`, or `lpkd7hdlkktx`. Its ownership is outside this recovery procedure.

After confirming the narrow scope, delete the failed stack and wait for completion. Only then revalidate that the listed retained buckets remain empty, the user pool has zero users, the log group has zero stored bytes, and no DB instance uses the subnet group. Delete the verified empty retained artifacts only after those checks pass:

```bash
AWS_PROFILE=wallyanalyzer AWS_REGION=us-east-1 aws cloudformation delete-stack --stack-name WallyPlatform-production
AWS_PROFILE=wallyanalyzer AWS_REGION=us-east-1 aws cloudformation wait stack-delete-complete --stack-name WallyPlatform-production
AWS_PROFILE=wallyanalyzer AWS_REGION=us-east-1 aws s3api delete-bucket --bucket wallyplatform-production-productionpipelineartifac-rbw9dwg13uz3
AWS_PROFILE=wallyanalyzer AWS_REGION=us-east-1 aws s3api delete-bucket --bucket wallyplatform-production-reportbucket577f0fcd-lb401ovvwcjo
AWS_PROFILE=wallyanalyzer AWS_REGION=us-east-1 aws s3api delete-bucket --bucket wallyplatform-production-samplebucket7f6f8160-wzqhje7d8yup
AWS_PROFILE=wallyanalyzer AWS_REGION=us-east-1 aws cognito-idp delete-user-pool --user-pool-id us-east-1_KeHJ2FGHJ
AWS_PROFILE=wallyanalyzer AWS_REGION=us-east-1 aws secretsmanager delete-secret --secret-id arn:aws:secretsmanager:us-east-1:265404809336:secret:BootstrapAdministratorSecre-SsuabW3E0NxI-KPQWKq --force-delete-without-recovery
AWS_PROFILE=wallyanalyzer AWS_REGION=us-east-1 aws logs delete-log-group --log-group-name WallyPlatform-production-ApplicationLogGroupE33FCF9B-L1lqxvMfJ4ph
AWS_PROFILE=wallyanalyzer AWS_REGION=us-east-1 aws rds delete-db-subnet-group --db-subnet-group-name wallyplatform-production-applicationdatabasesubnetgroup242bc54f-sigs1xqsy3fn
```

The repaired stack pins `us-east-1c` and `us-east-1d`, which support every required interface endpoint, and preserves the original isolated subnet CIDRs before adding public ALB subnets. Deploy only after the cleanup and a reviewed CDK diff.

## Deployment pipeline

`WallyPlatform-production` creates `wally-analyzer-production`:

1. CodeConnections source: `mamsterla/wallyanalyzer`, branch `main`.
2. CodeBuild validation: dependency install, TypeScript checks, full workspace build, tests, and CDK synth.
3. CodeBuild deployment: repeated checks/build/tests, then CDK deploy with no interactive approval.

The CodeConnection ARN is bound in `infra/bin/app.ts`. Confirm the connection remains `AVAILABLE` before deploying the stack.

## Database and migrations

Production uses standard RDS for PostgreSQL 18.3, encrypted storage, private subnets, 14-day backups, deletion protection, and TLS-required RDS Proxy. Credentials are generated in Secrets Manager. The ECS startup path runs ordered, checksummed SQL migrations under a Postgres advisory lock before serving requests; it records applied migrations and safely recognizes the pre-migration local baseline. Do not expose the database or run migrations from a browser.

## Identity and fulfillment

Cognito self-service signup is disabled. Accounts are created by admin fulfillment only. Fulfillment persists a Cognito subject, user account state, PSIU serial/opaque UID assignment history, and immutable audit event in Postgres. It does not store PSIU credentials or LAN addresses. The current zero-user pool is configured with a mutable standard `email` attribute so an authenticated customer can change email after the HTTPS release.

SES production delivery is deferred. `AdminCreateUser` is suppressed until `wallyanalyzer.com` has an approved SES identity, DKIM/SPF/DMARC, and production SES access. Do not send fulfillment invitations from the stack before then.

The temporary ALB serves the static React application for restricted browser review. It is not a complete authenticated production application: Cognito login, admin fulfillment screens, and public browser CORS are not yet implemented. The production fulfillment API still requires a valid Cognito admin access token. PSIU browser control remains local-device work; a private ECS task cannot reach a PSIU on an operator LAN.
