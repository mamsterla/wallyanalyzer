# Infrastructure

AWS CDK stack provisions network, Aurora PostgreSQL, Cognito, private S3 sample storage, API Gateway/Lambda, Step Functions, CloudWatch logs, and an ECS cluster for future long-running algorithm containers.

## Commands

```bash
npm install
npm run synth --workspace=@wally/infra
npm run deploy:staging --workspace=@wally/infra
```

`production` retains S3 and Aurora resources; `staging` is configured for disposable resources. Review CORS origins before a production deployment. Production CORS deliberately has no browser origin until the hosted UI domain is known.

## Remaining deployment work

- Bootstrap each target AWS account/region with `cdk bootstrap`.
- Add a custom domain, ACM certificate, WAF, and approved frontend origin.
- Wire database migration execution into CodePipeline.
- Replace analysis-worker placeholder with versioned Lambda container/Fargate implementations.
- Add S3 event validation and durable sample/job writes before starting workflow executions.
