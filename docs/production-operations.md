# Production operations

Production runs in AWS account `265404809336`, region `us-east-1`, with profile `wallyanalyzer`. It has no public ingress. Do not use local Docker credentials or PSIU credentials in AWS.

## First administrator bootstrap

The `BootstrapAdministratorTaskDefinition` is a private, one-off Fargate task. It reads `email` and `temporaryPassword` from the dedicated `BootstrapAdministratorSecret` and then:

1. looks up the Cognito user by email;
2. creates a Cognito user with `MessageAction=SUPPRESS` only when absent;
3. ensures membership in Cognito `admin` group;
4. writes the matching active Postgres user and immutable `admin.bootstrap` audit event.

If Postgres persistence fails after this task creates a Cognito user, it deletes only that newly created Cognito user. If compensation fails, rerunning the task reconciles the existing Cognito user into Postgres without creating a second account. It does not send email. Configure SES and the verified `wallyanalyzer.com` sender before enabling customer invitations.

### Preconditions

- The production stack is `CREATE_COMPLETE` and `PrivateApplicationService` is stable, so schema migrations have completed.
- Your terminal uses `AWS_PROFILE=wallyanalyzer` and `AWS_REGION=us-east-1`.
- Choose a temporary password that meets Cognito policy: at least 14 characters with upper/lower case, a digit, and a symbol.
- Do not pass the password in an ECS command, CloudFormation parameter, source file, shell history, or logs.

### Populate the one-time secret

Use a private file with mode `0600`; it is removed immediately after the Secrets Manager write.

```bash
export AWS_PROFILE=wallyanalyzer AWS_REGION=us-east-1
STACK=WallyPlatform-production
secret_arn=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='BootstrapAdministratorSecretArn'].OutputValue" --output text)

read -r -p 'Administrator email: ' BOOTSTRAP_EMAIL
read -r -s -p 'Temporary password: ' BOOTSTRAP_TEMP_PASSWORD; printf '\n'
secret_file=$(mktemp)
umask 077
admin_email=$BOOTSTRAP_EMAIL
export BOOTSTRAP_EMAIL BOOTSTRAP_TEMP_PASSWORD
node - <<'NODE' > "$secret_file"
process.stdout.write(JSON.stringify({
  email: process.env.BOOTSTRAP_EMAIL,
  temporaryPassword: process.env.BOOTSTRAP_TEMP_PASSWORD,
}));
NODE
unset BOOTSTRAP_EMAIL BOOTSTRAP_TEMP_PASSWORD
aws secretsmanager put-secret-value --secret-id "$secret_arn" --secret-string "file://$secret_file"
rm -f "$secret_file"
```

### Run and verify the private task

```bash
cluster=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='ApplicationClusterArn'].OutputValue" --output text)
task_definition=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='BootstrapAdministratorTaskDefinitionArn'].OutputValue" --output text)
security_group=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='PrivateTaskSecurityGroupId'].OutputValue" --output text)
subnets=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='PrivateSubnetIds'].OutputValue" --output text)

run=$(aws ecs run-task --cluster "$cluster" --launch-type FARGATE --task-definition "$task_definition" \
  --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$security_group],assignPublicIp=DISABLED}" \
  --started-by first-admin-bootstrap --output json)
task_arn=$(printf '%s' "$run" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).tasks[0].taskArn))')
aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task_arn"
aws ecs describe-tasks --cluster "$cluster" --tasks "$task_arn" \
  --query 'tasks[0].{StoppedReason:stoppedReason,ExitCode:containers[0].exitCode}' --output json

user_pool=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)
aws cognito-idp admin-get-user --user-pool-id "$user_pool" --username "$admin_email"
aws cognito-idp admin-list-groups-for-user --user-pool-id "$user_pool" --username "$admin_email"
```

An exit code of `0` means the durable Postgres insert and immutable audit event committed. The task is idempotent: it reuses a matching active admin record, or reconciles an existing Cognito user from a prior partial attempt, without creating a second Cognito user. If the task fails, review CloudWatch and CloudTrail before rerunning; a compensation failure is visible in the task error and the next run safely reconciles the retained Cognito identity.

### Rotate the bootstrap secret

After verified success, overwrite the secret with an unusable random value. Do not delete the CloudFormation-owned secret; deletion creates stack drift.

```bash
cleanup_file=$(mktemp)
umask 077
node - <<'NODE' > "$cleanup_file"
const { randomBytes } = require('node:crypto');
process.stdout.write(JSON.stringify({
  email: 'disabled@example.invalid',
  temporaryPassword: randomBytes(48).toString('base64url'),
}));
NODE
aws secretsmanager put-secret-value --secret-id "$secret_arn" --secret-string "file://$cleanup_file"
rm -f "$cleanup_file"
```

Record the bootstrap task ARN and operator in the change record. Enable SES with a verified `wallyanalyzer.com` sender before removing `MessageAction=SUPPRESS` from fulfillment invitations.
