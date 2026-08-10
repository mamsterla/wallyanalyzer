import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

export interface WallyPlatformStackProps extends cdk.StackProps {
  environment: 'staging' | 'production';
}

export class WallyPlatformStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WallyPlatformStackProps) {
    super(scope, id, props);
    const isProduction = props.environment === 'production';
    const removalPolicy = isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    const vpc = new ec2.Vpc(this, 'PlatformVpc', { maxAzs: 2, natGateways: 0 });
    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', { vpc });

    const database = new rds.DatabaseCluster(this, 'ApplicationDatabase', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_16_4 }),
      writer: rds.ClusterInstance.serverlessV2('writer'),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      credentials: rds.Credentials.fromGeneratedSecret('platform_admin'),
      defaultDatabaseName: 'wally',
      backup: { retention: cdk.Duration.days(isProduction ? 14 : 3) },
      deletionProtection: isProduction,
      removalPolicy,
      serverlessV2MinCapacity: isProduction ? 0.5 : 0.5,
      serverlessV2MaxCapacity: isProduction ? 8 : 2,
    });

    const sampleBucket = new s3.Bucket(this, 'SampleBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: isProduction,
      eventBridgeEnabled: true,
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: cdk.Duration.days(7) }],
      removalPolicy,
      autoDeleteObjects: !isProduction,
    });

    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: false } },
      passwordPolicy: { minLength: 12, requireDigits: true, requireLowercase: true, requireUppercase: true, requireSymbols: true },
      removalPolicy,
    });
    const webClient = userPool.addClient('WebClient', {
      authFlows: { userPassword: true, userSrp: true },
      preventUserExistenceErrors: true,
    });
    ['user', 'installer', 'admin'].forEach((groupName, precedence) => new cognito.CfnUserPoolGroup(this, `${groupName}Group`, {
      groupName,
      precedence: precedence + 1,
      userPoolId: userPool.userPoolId,
    }));

    const functionLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
      retention: isProduction ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
      removalPolicy,
    });
    const apiHandler = new NodejsFunction(this, 'ApiHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app-server/src/handlers/api.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: { SAMPLE_BUCKET_NAME: sampleBucket.bucketName },
      logGroup: functionLogGroup,
    });
    sampleBucket.grantPut(apiHandler);

    const worker = new NodejsFunction(this, 'AnalysisWorker', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app-server/src/handlers/analysisWorker.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 2048,
      environment: { SAMPLE_BUCKET_NAME: sampleBucket.bucketName },
    });
    sampleBucket.grantRead(worker);
    const analysisWorkflow = new sfn.StateMachine(this, 'AnalysisWorkflow', {
      definitionBody: sfn.DefinitionBody.fromChainable(new tasks.LambdaInvoke(this, 'RunAnalysis', { lambdaFunction: worker, outputPath: '$.Payload' })),
      timeout: cdk.Duration.hours(1),
      tracingEnabled: true,
    });

    // ECS cluster is reserved for algorithms exceeding Lambda runtime/memory limits.
    new ecs.Cluster(this, 'AlgorithmCluster', { vpc });

    const api = new apigateway.RestApi(this, 'PublicApi', {
      restApiName: `wally-api-${props.environment}`,
      deployOptions: { stageName: props.environment, tracingEnabled: true, loggingLevel: apigateway.MethodLoggingLevel.INFO },
      defaultCorsPreflightOptions: {
        allowOrigins: isProduction ? ['https://app.example.invalid'] : ['http://localhost:5173'], 
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['authorization', 'content-type'],
      },
    });
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'UserPoolAuthorizer', { cognitoUserPools: [userPool] });
    const integration = new apigateway.LambdaIntegration(apiHandler);
    api.root.addResource('health').addMethod('GET', integration, { authorizationType: apigateway.AuthorizationType.NONE });
    const uploads = api.root.addResource('v1').addResource('samples').addResource('uploads');
    uploads.addMethod('POST', integration, { authorizationType: apigateway.AuthorizationType.COGNITO, authorizer });

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'WebClientId', { value: webClient.userPoolClientId });
    new cdk.CfnOutput(this, 'SampleBucketName', { value: sampleBucket.bucketName });
    new cdk.CfnOutput(this, 'DatabaseSecretArn', { value: database.secret!.secretArn });
    new cdk.CfnOutput(this, 'AnalysisWorkflowArn', { value: analysisWorkflow.stateMachineArn });
  }
}
