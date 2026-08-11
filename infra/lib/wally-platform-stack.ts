import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipelineActions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface WallyPlatformStackProps extends cdk.StackProps {
  githubConnectionArn: string;
  githubOwner: string;
  githubRepository: string;
}

/** Production-only AWS foundation. Local development stays in Docker Compose. */
export class WallyPlatformStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WallyPlatformStackProps) {
    super(scope, id, props);

    const retention = cdk.RemovalPolicy.RETAIN;
    const vpc = new ec2.Vpc(this, 'ProductionVpc', {
      availabilityZones: ['us-east-1c', 'us-east-1d'],
      natGateways: 0,
      subnetConfiguration: [
        // Preserve the original isolated-subnet CIDRs before allocating public ALB subnets.
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      ],
    });

    const loadBalancerSecurityGroup = new ec2.SecurityGroup(this, 'TemporaryBrowserLoadBalancerSecurityGroup', {
      vpc,
      allowAllOutbound: false,
      description: 'Temporary restricted HTTP browser access',
    });
    loadBalancerSecurityGroup.addIngressRule(ec2.Peer.ipv4('47.150.127.7/32'), ec2.Port.tcp(80), 'Temporary browser access');

    const serviceSecurityGroup = new ec2.SecurityGroup(this, 'ApplicationServiceSecurityGroup', {
      vpc,
      allowAllOutbound: false,
      description: 'Private Wally ECS tasks',
    });
    loadBalancerSecurityGroup.addEgressRule(serviceSecurityGroup, ec2.Port.tcp(80), 'HTTP to application tasks');
    serviceSecurityGroup.addIngressRule(loadBalancerSecurityGroup, ec2.Port.tcp(80), 'HTTP from temporary browser load balancer');
    const endpointSecurityGroup = new ec2.SecurityGroup(this, 'VpcEndpointSecurityGroup', {
      vpc,
      allowAllOutbound: false,
      description: 'AWS PrivateLink endpoints used by Wally ECS tasks',
    });
    endpointSecurityGroup.addIngressRule(serviceSecurityGroup, ec2.Port.tcp(443), 'HTTPS from private application tasks');
    serviceSecurityGroup.addEgressRule(endpointSecurityGroup, ec2.Port.tcp(443), 'HTTPS to approved AWS PrivateLink endpoints');

    vpc.addGatewayEndpoint('S3GatewayEndpoint', { service: ec2.GatewayVpcEndpointAwsService.S3 });
    [
      ec2.InterfaceVpcEndpointAwsService.ECR,
      ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      ec2.InterfaceVpcEndpointAwsService.COGNITO_IDP,
      ec2.InterfaceVpcEndpointAwsService.EMAIL,
    ].forEach((service, index) => vpc.addInterfaceEndpoint(`PrivateLinkEndpoint${index}`, {
      service,
      privateDnsEnabled: true,
      open: false,
      securityGroups: [endpointSecurityGroup],
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    }));

    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      allowAllOutbound: false,
      description: 'Private PostgreSQL database',
    });
    const proxySecurityGroup = new ec2.SecurityGroup(this, 'DatabaseProxySecurityGroup', {
      vpc,
      allowAllOutbound: false,
      description: 'TLS-only RDS Proxy',
    });
    proxySecurityGroup.addIngressRule(serviceSecurityGroup, ec2.Port.tcp(5432), 'PostgreSQL from private application tasks');
    proxySecurityGroup.addEgressRule(databaseSecurityGroup, ec2.Port.tcp(5432), 'PostgreSQL to database');
    serviceSecurityGroup.addEgressRule(proxySecurityGroup, ec2.Port.tcp(5432), 'PostgreSQL through RDS Proxy');
    databaseSecurityGroup.addIngressRule(proxySecurityGroup, ec2.Port.tcp(5432), 'PostgreSQL only through RDS Proxy');

    const database = new rds.DatabaseInstance(this, 'ApplicationDatabase', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_18_3 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE4_GRAVITON, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      credentials: rds.Credentials.fromGeneratedSecret('platform_admin'),
      databaseName: 'wally',
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      publiclyAccessible: false,
      multiAz: false,
      backupRetention: cdk.Duration.days(14),
      deleteAutomatedBackups: false,
      deletionProtection: true,
      removalPolicy: retention,
    });
    const databaseProxy = new rds.DatabaseProxy(this, 'ApplicationDatabaseProxy', {
      proxyTarget: rds.ProxyTarget.fromInstance(database),
      secrets: [database.secret!],
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [proxySecurityGroup],
      requireTLS: true,
      debugLogging: false,
      idleClientTimeout: cdk.Duration.minutes(30),
    });

    const sampleBucket = privateArtifactBucket(this, 'SampleBucket', 'raw audio uploads', retention);
    const reportBucket = privateArtifactBucket(this, 'ReportBucket', 'immutable report artifacts', retention);

    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: false } },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      passwordPolicy: {
        minLength: 14,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      removalPolicy: retention,
    });
    const webClient = userPool.addClient('CustomWallyWebClient', {
      authFlows: { userPassword: true, userSrp: true },
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });
    [
      { name: 'admin', precedence: 1 },
      { name: 'installer', precedence: 2 },
      { name: 'user', precedence: 3 },
    ].forEach(({ name, precedence }) => new cognito.CfnUserPoolGroup(this, `${name}Group`, {
      groupName: name,
      precedence,
      userPoolId: userPool.userPoolId,
    }));

    const bootstrapAdminSecret = new secretsmanager.Secret(this, 'BootstrapAdministratorSecret', {
      description: 'One-time initial administrator credentials. Rotate immediately after the bootstrap task succeeds.',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ email: '' }),
        generateStringKey: 'temporaryPassword',
        passwordLength: 32,
        excludePunctuation: true,
      },
      removalPolicy: retention,
    });

    const cluster = new ecs.Cluster(this, 'ApplicationCluster', { vpc, containerInsightsV2: ecs.ContainerInsights.ENHANCED });
    const runtimePlatform = {
      cpuArchitecture: ecs.CpuArchitecture.X86_64,
      operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
    };
    const applicationImage = ecs.ContainerImage.fromAsset(path.resolve(process.cwd(), '..'), {
      file: 'app-server/Dockerfile',
      platform: ecrAssets.Platform.LINUX_AMD64,
    });
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'ApplicationTaskDefinition', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform,
    });
    const applicationLogGroup = new logs.LogGroup(this, 'ApplicationLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: retention,
    });
    const container = taskDefinition.addContainer('ApplicationContainer', {
      image: applicationImage,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'wally-app', logGroup: applicationLogGroup }),
      environment: {
        NODE_ENV: 'production',
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_WEB_CLIENT_ID: webClient.userPoolClientId,
        DATABASE_PROXY_HOST: databaseProxy.endpoint,
        DATABASE_NAME: 'wally',
        DATABASE_SSL: 'require',
      },
      secrets: {
        DATABASE_USERNAME: ecs.Secret.fromSecretsManager(database.secret!, 'username'),
        DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(database.secret!, 'password'),
      },
    });
    container.addPortMappings({ containerPort: 80 });
    // No S3 application permissions exist until an ownership-checked upload or
    // report route is implemented. In particular, this API task has no delete
    // permission for private raw audio or immutable report artifacts.
    taskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminDisableUser',
      ],
      resources: [userPool.userPoolArn],
    }));
    const applicationService = new ecs.FargateService(this, 'PrivateApplicationService', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      assignPublicIp: false,
      securityGroups: [serviceSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });
    const temporaryBrowserLoadBalancer = new elbv2.ApplicationLoadBalancer(this, 'TemporaryBrowserLoadBalancer', {
      vpc,
      internetFacing: true,
      securityGroup: loadBalancerSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });
    const temporaryBrowserListener = temporaryBrowserLoadBalancer.addListener('TemporaryHttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false,
    });
    temporaryBrowserListener.addTargets('PrivateApplicationTargets', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [applicationService],
      healthCheck: {
        path: '/health',
        healthyHttpCodes: '200',
      },
    });

    const bootstrapTaskDefinition = new ecs.FargateTaskDefinition(this, 'BootstrapAdministratorTaskDefinition', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform,
    });
    bootstrapTaskDefinition.addContainer('BootstrapAdministratorContainer', {
      image: applicationImage,
      command: ['bootstrap-admin'],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'wally-bootstrap-admin', logGroup: applicationLogGroup }),
      environment: {
        NODE_ENV: 'production',
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        DATABASE_PROXY_HOST: databaseProxy.endpoint,
        DATABASE_NAME: 'wally',
        DATABASE_SSL: 'require',
        BOOTSTRAP_ADMIN_SECRET_ARN: bootstrapAdminSecret.secretArn,
      },
      secrets: {
        DATABASE_USERNAME: ecs.Secret.fromSecretsManager(database.secret!, 'username'),
        DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(database.secret!, 'password'),
      },
    });
    bootstrapAdminSecret.grantRead(bootstrapTaskDefinition.taskRole);
    bootstrapTaskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminDeleteUser',
      ],
      resources: [userPool.userPoolArn],
    }));

    const sourceOutput = new codepipeline.Artifact('SourceOutput');
    const validationProject = pipelineProject(this, 'ValidationProject', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: { commands: ['npm ci'] },
          build: { commands: ['npm run check', 'npm run build', 'npm run test', 'cd infra && npx cdk synth -c environment=production'] },
        },
      }),
    });
    const deploymentProject = pipelineProject(this, 'DeploymentProject', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: { commands: ['npm ci'] },
          build: { commands: ['npm run check', 'npm run build', 'npm run test', 'cd infra && npx cdk deploy WallyPlatform-production -c environment=production --require-approval never'] },
        },
      }),
    });
    const bootstrapRoleArns = [
      'deploy-role',
      'file-publishing-role',
      'image-publishing-role',
      'lookup-role',
    ].map((role) => `arn:aws:iam::265404809336:role/cdk-hnb659fds-${role}-265404809336-us-east-1`);
    deploymentProject.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: bootstrapRoleArns,
    }));
    deploymentProject.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: ['arn:aws:ssm:us-east-1:265404809336:parameter/cdk-bootstrap/hnb659fds/version'],
    }));

    const pipeline = new codepipeline.Pipeline(this, 'ProductionPipeline', {
      pipelineName: 'wally-analyzer-production',
      pipelineType: codepipeline.PipelineType.V1,
      restartExecutionOnUpdate: true,
    });
    pipeline.addStage({
      stageName: 'Source',
      actions: [new codepipelineActions.CodeStarConnectionsSourceAction({
        actionName: 'GitHubMain',
        connectionArn: props.githubConnectionArn,
        owner: props.githubOwner,
        repo: props.githubRepository,
        branch: 'main',
        output: sourceOutput,
        triggerOnPush: true,
      })],
    });
    pipeline.addStage({
      stageName: 'Validate',
      actions: [new codepipelineActions.CodeBuildAction({ actionName: 'CheckAndSynth', project: validationProject, input: sourceOutput })],
    });
    pipeline.addStage({
      stageName: 'Deploy',
      actions: [new codepipelineActions.CodeBuildAction({ actionName: 'DeployProduction', project: deploymentProject, input: sourceOutput })],
    });

    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'WebClientId', { value: webClient.userPoolClientId });
    new cdk.CfnOutput(this, 'SampleBucketName', { value: sampleBucket.bucketName });
    new cdk.CfnOutput(this, 'ReportBucketName', { value: reportBucket.bucketName });
    new cdk.CfnOutput(this, 'DatabaseProxyEndpoint', { value: databaseProxy.endpoint });
    new cdk.CfnOutput(this, 'BootstrapAdministratorSecretArn', { value: bootstrapAdminSecret.secretArn });
    new cdk.CfnOutput(this, 'BootstrapAdministratorTaskDefinitionArn', { value: bootstrapTaskDefinition.taskDefinitionArn });
    new cdk.CfnOutput(this, 'ApplicationClusterArn', { value: cluster.clusterArn });
    new cdk.CfnOutput(this, 'ApplicationLogGroupName', { value: applicationLogGroup.logGroupName });
    new cdk.CfnOutput(this, 'TemporaryBrowserHttpUrl', {
      value: `http://${temporaryBrowserLoadBalancer.loadBalancerDnsName}`,
      description: 'Temporary restricted HTTP browser URL. Replace with HTTPS after DNS and ACM are configured.',
    });
    new cdk.CfnOutput(this, 'PrivateTaskSecurityGroupId', { value: serviceSecurityGroup.securityGroupId });
    new cdk.CfnOutput(this, 'PrivateSubnetIds', { value: vpc.isolatedSubnets.map((subnet) => subnet.subnetId).join(',') });
    new cdk.CfnOutput(this, 'ProductionPipelineName', { value: pipeline.pipelineName });
  }
}

function privateArtifactBucket(scope: Construct, id: string, _purpose: string, removalPolicy: cdk.RemovalPolicy): s3.Bucket {
  return new s3.Bucket(scope, id, {
    encryption: s3.BucketEncryption.S3_MANAGED,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    enforceSSL: true,
    versioned: true,
    lifecycleRules: [{ abortIncompleteMultipartUploadAfter: cdk.Duration.days(7) }],
    removalPolicy,
    autoDeleteObjects: false,
  });
}

function pipelineProject(scope: Construct, id: string, props: { buildSpec: codebuild.BuildSpec }): codebuild.PipelineProject {
  return new codebuild.PipelineProject(scope, id, {
    environment: {
      buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      privileged: true,
    },
    buildSpec: props.buildSpec,
    timeout: cdk.Duration.minutes(60),
  });
}
