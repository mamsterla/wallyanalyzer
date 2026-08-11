# Production Foundation Runbook

## Environments

- **Development:** local Docker Compose only. It runs `app-server` and Postgres on loopback ports; it does not use AWS credentials.
- **Production:** account `265404809336`, region `us-east-1`, deployed from `main` through CodePipeline after its source connection is available.

Use the AWS CLI profile explicitly for operator commands:

```bash
AWS_PROFILE=wallyanalyzer AWS_REGION=us-east-1 npm run synth
```

## Production network posture

The temporary browser path is a public Application Load Balancer (ALB) HTTP listener. Its security group permits port 80 only from `47.150.127.7/32`. The ALB is the only public Wally resource; it forwards only to port 80 on private ECS tasks. ECS tasks remain in isolated subnets without public IPs or NAT. RDS PostgreSQL, RDS Proxy, Cognito, and S3 remain non-public. Tasks use S3 gateway and interface VPC endpoints for ECR, CloudWatch Logs, Secrets Manager, Cognito IDP, and SES APIs.

The temporary URL is HTTP only and sends traffic without TLS encryption. Do not use it on untrusted networks or enter sensitive production data. Its ALB hostname is not a replacement for a custom domain. Add an ACM certificate and HTTPS listener after the DNS domain is ready, then remove the temporary port-80 listener and its `47.150.127.7/32` ingress rule. Do not add NAT or widen ingress without an approved architecture change.

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
TASK_ARN=$(aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE --task-definition "$TASK_DEFINITION" \
  --network-configuration "awsvpcConfiguration={subnets=$SUBNETS,securityGroups=$SECURITY_GROUP,assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)
aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --output json
```

Collect the stopped-task reason, container exit code, and the `wally-app` CloudWatch logs before any cleanup. If the task remains running, terminate it after recording its state. After fixing the verified cause, deploy without `diagnosticMode`; that restores application `desiredCount: 1` and creates the CodePipeline:

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

Cognito self-service signup is disabled. Accounts are created by admin fulfillment only. Fulfillment persists a Cognito subject, user account state, PSIU serial/opaque UID assignment history, and immutable audit event in Postgres. It does not store PSIU credentials or LAN addresses.

SES production delivery is deferred. `AdminCreateUser` is suppressed until `wallyanalyzer.com` has an approved SES identity, DKIM/SPF/DMARC, and production SES access. Do not send fulfillment invitations from the stack before then.

The temporary ALB serves the static React application for restricted browser review. It is not a complete authenticated production application: Cognito login, admin fulfillment screens, and public browser CORS are not yet implemented. The production fulfillment API still requires a valid Cognito admin access token. PSIU browser control remains local-device work; a private ECS task cannot reach a PSIU on an operator LAN.
