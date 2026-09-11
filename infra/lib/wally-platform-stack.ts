import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipelineActions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
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
    const applicationHostname = 'wally-analytics.app';
    const wwwApplicationHostname = `www.${applicationHostname}`;
    const applicationHostedZoneId = requiredContext(this, 'applicationHostedZoneId');
    const expectedDomainNameServers = requiredContext(this, 'applicationExpectedNameServers')
      .split(',').map((value) => value.trim().replace(/\.$/, '')).filter(Boolean).sort();
    const domainActivation = contextBoolean(this, 'applicationActivation');
    // One-time recovery bridge only. It preserves CloudFormation-managed resources
    // created by cancelled updates before the default deployment detaches them.
    const retainManagedDomainResources = contextBoolean(this, 'retainManagedDomainResources');
    const legacyCertificateArn = requiredContext(this, 'legacyApplicationCertificateArn');
    const legacyCertificate = retainManagedDomainResources
      ? legacyCertificateBridge(this, applicationHostname)
      : acm.Certificate.fromCertificateArn(this, 'LegacyApplicationCertificate', legacyCertificateArn);
    const applicationHostedZone = retainManagedDomainResources
      ? retainedHostedZoneBridge(this, applicationHostname)
      : route53.HostedZone.fromHostedZoneAttributes(this, 'ExistingApplicationHostedZone', {
        hostedZoneId: applicationHostedZoneId,
        zoneName: applicationHostname,
      });
    // Foundation never requests a certificate. Activation is an explicit manual
    // deployment after the CodeBuild delegation preflight has passed.
    const applicationCertificate = domainActivation
      ? new acm.Certificate(this, 'ApplicationActivationCertificate', {
        domainName: applicationHostname,
        subjectAlternativeNames: [wwwApplicationHostname],
        validation: acm.CertificateValidation.fromDns(applicationHostedZone),
      })
      : legacyCertificate;
    const diagnosticMode = this.node.tryGetContext('diagnosticMode') === true || this.node.tryGetContext('diagnosticMode') === 'true';
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
      // Kept stable to avoid replacing the existing ALB security group.
      description: 'Temporary restricted HTTP browser access',
    });
    // The ALB is the only public resource. Port 80 exists only to redirect every
    // request to TLS; application traffic is served only from the HTTPS listener.
    loadBalancerSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Public HTTP to HTTPS redirect');
    loadBalancerSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Public HTTPS application access');

    const serviceSecurityGroup = new ec2.SecurityGroup(this, 'ApplicationServiceSecurityGroup', {
      vpc,
      allowAllOutbound: false,
      description: 'Private Wally ECS tasks',
    });
    loadBalancerSecurityGroup.addEgressRule(serviceSecurityGroup, ec2.Port.tcp(80), 'HTTP to application tasks');
    serviceSecurityGroup.addIngressRule(loadBalancerSecurityGroup, ec2.Port.tcp(80), 'HTTP from temporary browser load balancer');
    const workflowSecurityGroup = new ec2.SecurityGroup(this, 'ReportWorkflowSecurityGroup', { vpc, allowAllOutbound: false, description: 'Private report workflow Lambdas' });
    const smokeWorkflowSecurityGroup = new ec2.SecurityGroup(this, 'ReportSmokeWorkflowSecurityGroup', { vpc, allowAllOutbound: false, description: 'Private isolated report smoke workflow Lambdas' });
    const endpointSecurityGroup = new ec2.SecurityGroup(this, 'VpcEndpointSecurityGroup', {
      vpc,
      allowAllOutbound: false,
      description: 'AWS PrivateLink endpoints used by private Wally workloads',
    });
    endpointSecurityGroup.addIngressRule(serviceSecurityGroup, ec2.Port.tcp(443), 'HTTPS from private application tasks');
    endpointSecurityGroup.addIngressRule(workflowSecurityGroup, ec2.Port.tcp(443), 'HTTPS from report workflow Lambdas');
    endpointSecurityGroup.addIngressRule(smokeWorkflowSecurityGroup, ec2.Port.tcp(443), 'HTTPS from report smoke workflow Lambdas');
    serviceSecurityGroup.addEgressRule(endpointSecurityGroup, ec2.Port.tcp(443), 'HTTPS to approved AWS PrivateLink endpoints');
    workflowSecurityGroup.addEgressRule(endpointSecurityGroup, ec2.Port.tcp(443), 'HTTPS to approved AWS PrivateLink endpoints');
    smokeWorkflowSecurityGroup.addEgressRule(endpointSecurityGroup, ec2.Port.tcp(443), 'HTTPS to approved AWS PrivateLink endpoints');

    vpc.addGatewayEndpoint('S3GatewayEndpoint', { service: ec2.GatewayVpcEndpointAwsService.S3 });
    const s3PrefixList = new cr.AwsCustomResource(this, 'S3ManagedPrefixList', {
      onUpdate: {
        service: 'EC2',
        action: 'describeManagedPrefixLists',
        parameters: { Filters: [{ Name: 'prefix-list-name', Values: [`com.amazonaws.${this.region}.s3`] }] },
        physicalResourceId: cr.PhysicalResourceId.of(`s3-prefix-list-${this.region}`),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE }),
      installLatestAwsSdk: false,
    });
    serviceSecurityGroup.addEgressRule(
      ec2.Peer.prefixList(s3PrefixList.getResponseField('PrefixLists.0.PrefixListId')),
      ec2.Port.tcp(443),
      'HTTPS to S3 image layers through the gateway endpoint',
    );
    workflowSecurityGroup.addEgressRule(ec2.Peer.prefixList(s3PrefixList.getResponseField('PrefixLists.0.PrefixListId')), ec2.Port.tcp(443), 'HTTPS to S3 report artifacts through the gateway endpoint');
    smokeWorkflowSecurityGroup.addEgressRule(ec2.Peer.prefixList(s3PrefixList.getResponseField('PrefixLists.0.PrefixListId')), ec2.Port.tcp(443), 'HTTPS to S3 smoke report artifacts through the gateway endpoint');
    [
      ec2.InterfaceVpcEndpointAwsService.ECR,
      ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      ec2.InterfaceVpcEndpointAwsService.COGNITO_IDP,
      ec2.InterfaceVpcEndpointAwsService.EMAIL,
      ec2.InterfaceVpcEndpointAwsService.LAMBDA,
      ec2.InterfaceVpcEndpointAwsService.STEP_FUNCTIONS,
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
    const bastionSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseBastionSecurityGroup', {
      vpc,
      allowAllOutbound: false,
      description: 'Private Session Manager database tunnel host',
    });
    const ssmEndpointSecurityGroup = new ec2.SecurityGroup(this, 'SessionManagerEndpointSecurityGroup', {
      vpc,
      allowAllOutbound: false,
      description: 'Session Manager PrivateLink endpoints used only by the database bastion',
    });
    ssmEndpointSecurityGroup.addIngressRule(bastionSecurityGroup, ec2.Port.tcp(443), 'HTTPS from private Session Manager bastion');
    bastionSecurityGroup.addEgressRule(ssmEndpointSecurityGroup, ec2.Port.tcp(443), 'HTTPS to Session Manager endpoints');
    [
      ec2.InterfaceVpcEndpointAwsService.SSM,
      ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
      ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
    ].forEach((service, index) => vpc.addInterfaceEndpoint(`SessionManagerEndpoint${index}`, {
      service,
      privateDnsEnabled: true,
      open: false,
      securityGroups: [ssmEndpointSecurityGroup],
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    }));
    bastionSecurityGroup.addEgressRule(proxySecurityGroup, ec2.Port.tcp(5432), 'PostgreSQL tunnel to RDS Proxy');
    proxySecurityGroup.addIngressRule(serviceSecurityGroup, ec2.Port.tcp(5432), 'PostgreSQL from private application tasks');
    proxySecurityGroup.addIngressRule(bastionSecurityGroup, ec2.Port.tcp(5432), 'PostgreSQL from Session Manager bastion');
    proxySecurityGroup.addIngressRule(workflowSecurityGroup, ec2.Port.tcp(5432), 'PostgreSQL from report workflow Lambdas');
    proxySecurityGroup.addIngressRule(smokeWorkflowSecurityGroup, ec2.Port.tcp(5432), 'PostgreSQL from isolated smoke workflow Lambdas');
    proxySecurityGroup.addEgressRule(databaseSecurityGroup, ec2.Port.tcp(5432), 'PostgreSQL to database');
    serviceSecurityGroup.addEgressRule(proxySecurityGroup, ec2.Port.tcp(5432), 'PostgreSQL through RDS Proxy');
    workflowSecurityGroup.addEgressRule(proxySecurityGroup, ec2.Port.tcp(5432), 'PostgreSQL through RDS Proxy');
    smokeWorkflowSecurityGroup.addEgressRule(proxySecurityGroup, ec2.Port.tcp(5432), 'PostgreSQL through RDS Proxy');
    databaseSecurityGroup.addIngressRule(proxySecurityGroup, ec2.Port.tcp(5432), 'PostgreSQL only through RDS Proxy');

    const bastionRole = new iam.Role(this, 'DatabaseBastionRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    });
    const bastion = new ec2.Instance(this, 'DatabaseBastion', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 }),
      role: bastionRole,
      securityGroup: bastionSecurityGroup,
      requireImdsv2: true,
      detailedMonitoring: false,
    });

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
    // Separate smoke credentials are added to the same private proxy; no workload shares the production database.
    const smokeDatabaseName='wally_report_smoke';
    const smokeDatabaseSecret=new secretsmanager.Secret(this,'ReportSmokeDatabaseSecret',{description:'Isolated report smoke-test database credential.',generateSecretString:{secretStringTemplate:JSON.stringify({username:'wally_report_smoke'}),generateStringKey:'password',passwordLength:32,excludePunctuation:true},removalPolicy:retention});
    const databaseProxy = new rds.DatabaseProxy(this, 'ApplicationDatabaseProxy', {
      proxyTarget: rds.ProxyTarget.fromInstance(database),
      secrets: [database.secret!,smokeDatabaseSecret],
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [proxySecurityGroup],
      requireTLS: true,
      debugLogging: false,
      idleClientTimeout: cdk.Duration.minutes(30),
    });

    const sampleBucket = privateArtifactBucket(this, 'SampleBucket', 'raw audio uploads', retention);
    sampleBucket.addCorsRule({ allowedOrigins: [`https://${applicationHostname}`], allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD], allowedHeaders: ['content-type', 'x-amz-checksum-sha256', 'x-amz-content-sha256', 'x-amz-date', 'x-amz-security-token', 'x-amz-tagging'], exposedHeaders: ['ETag', 'x-amz-checksum-sha256'], maxAge: 300 });
    sampleBucket.addLifecycleRule({ id: 'ExpireUnacceptedRawUploads', tagFilters: { 'wally-upload-state': 'unaccepted' }, expiration: cdk.Duration.days(1) });
    const reportBucket = privateArtifactBucket(this, 'ReportBucket', 'immutable report artifacts', retention);

    // Cognito cannot change standard email mutability in place. This replacement pool
    // is safe only because the failed pool has no identities or customer data.
    const userPool = new cognito.UserPool(this, 'MutableEmailUserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      // The current pool has no users, so mutable email can be enabled before
      // account creation rather than requiring a later identity migration.
      standardAttributes: { email: { required: true, mutable: true } },
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
    // AWS Public ECR avoids direct Docker Hub pulls and credentials in all environments.
    const nodeImage = 'public.ecr.aws/docker/library/node:24-alpine';
    const applicationImage = ecs.ContainerImage.fromAsset(path.resolve(process.cwd(), '..'), {
      file: 'app-server/Dockerfile',
      buildArgs: { NODE_IMAGE: nodeImage },
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
        // Public identifiers are rendered into runtime-config.js by the container
        // entrypoint. They are not secrets and do not require an image rebuild.
        PUBLIC_COGNITO_USER_POOL_ID: userPool.userPoolId,
        PUBLIC_COGNITO_WEB_CLIENT_ID: webClient.userPoolClientId,
        PUBLIC_API_BASE_URL: `https://${applicationHostname}/api`,
        DATABASE_PROXY_HOST: databaseProxy.endpoint,
        DATABASE_NAME: 'wally',
        DATABASE_SSL: 'require',
        DATABASE_SECRET_ARN: database.secret!.secretArn,
        SAMPLE_BUCKET_NAME: sampleBucket.bucketName,
        REPORT_BUCKET_NAME: reportBucket.bucketName,
      },
    });
    container.addPortMappings({ containerPort: 80 });
    // Raw upload cleanup is limited to verified ownership-scoped sample objects.
    // Report artifacts remain immutable and receive no delete permission.
    database.secret!.grantRead(taskDefinition.taskRole);
    taskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['s3:PutObject', 's3:PutObjectTagging', 's3:GetObject', 's3:DeleteObject'], resources: [sampleBucket.arnForObjects('raw/*')] }));
    taskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [reportBucket.arnForObjects('reports/*')] }));
    taskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminDisableUser',
        'cognito-idp:AdminEnableUser',
        'cognito-idp:AdminDeleteUser',
        'cognito-idp:AdminResetUserPassword',
      ],
      resources: [userPool.userPoolArn],
    }));
    // Workflow functions are private and use the same RDS Proxy security boundary as the API.
    const workflowImageFor = (handler:string) => lambda.DockerImageCode.fromImageAsset(path.resolve(process.cwd(), '..'), { file: 'app-server/Dockerfile.report-workflow', buildArgs: { NODE_IMAGE: nodeImage }, platform: ecrAssets.Platform.LINUX_AMD64, cmd: [handler] });
    const workerImage = lambda.DockerImageCode.fromImageAsset(path.resolve(process.cwd(), '..'), { file: 'algorithms/Dockerfile.analysis-worker', platform: ecrAssets.Platform.LINUX_AMD64 });
    const workflowLogGroup = new logs.LogGroup(this, 'ReportWorkflowLogGroup', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: retention });
    // An operator creates this isolated role/database once through the private SSM
    // tunnel before the runner is invoked. Do not add a deployed bootstrap Lambda:
    // no steady-state workload may read the platform-admin database secret.
    const workflowEnvironment = { DATABASE_PROXY_HOST: databaseProxy.endpoint, DATABASE_NAME: 'wally', DATABASE_SSL: 'require', DATABASE_SECRET_ARN: database.secret!.secretArn, SAMPLE_BUCKET_NAME: sampleBucket.bucketName, REPORT_BUCKET_NAME: reportBucket.bucketName };
    const workflowLambda = (id:string, handler:string) => new lambda.DockerImageFunction(this, id, { code: workflowImageFor(handler), vpc, vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }, securityGroups: [workflowSecurityGroup], timeout: cdk.Duration.minutes(2), memorySize: 512, environment: workflowEnvironment, logGroup: workflowLogGroup });
    const preflightFn=workflowLambda('ReportPreflightFunction','handlers/reportWorkflow.preflight');
    const finalizerFn=workflowLambda('ReportFinalizerFunction','handlers/reportWorkflow.finalize');
    const failedFn=workflowLambda('ReportFailureFunction','handlers/reportWorkflow.fail');
    const requestFinalizerFn=workflowLambda('ReportRequestFinalizerFunction','handlers/reportWorkflow.finalizeRequest');
    const dispatcherFn=workflowLambda('ReportDispatcherFunction','handlers/reportWorkflow.dispatch');
    const analysisWorker=new lambda.DockerImageFunction(this,'AnalysisWorkerFunction',{code:workerImage,timeout:cdk.Duration.minutes(15),memorySize:3008,ephemeralStorageSize:cdk.Size.gibibytes(4),environment:{SAMPLE_BUCKET_NAME:sampleBucket.bucketName,REPORT_BUCKET_NAME:reportBucket.bucketName},logGroup:workflowLogGroup});
    for(const fn of [preflightFn,finalizerFn,failedFn,requestFinalizerFn,dispatcherFn]){database.secret!.grantRead(fn);fn.addToRolePolicy(new iam.PolicyStatement({actions:['s3:GetObject'],resources:[sampleBucket.arnForObjects('raw/*'),reportBucket.arnForObjects('reports/*')]}));}
    // The trusted finalizer alone writes provenance manifests; the worker never supplies one.
    finalizerFn.addToRolePolicy(new iam.PolicyStatement({actions:['s3:PutObject'],resources:[reportBucket.arnForObjects('reports/*')]}));
    analysisWorker.addToRolePolicy(new iam.PolicyStatement({actions:['s3:GetObject','s3:GetObjectVersion'],resources:[sampleBucket.arnForObjects('raw/*')]}));
    analysisWorker.addToRolePolicy(new iam.PolicyStatement({actions:['s3:PutObject'],resources:[reportBucket.arnForObjects('reports/*')]}));
    // Preserve the Map item reportId outside untrusted worker output.
    const preflight=new sfnTasks.LambdaInvoke(this,'ReportPreflight',{lambdaFunction:preflightFn,payloadResponseOnly:true,resultPath:'$.preflight'});
    const worker=new sfnTasks.LambdaInvoke(this,'ReportWorker',{lambdaFunction:analysisWorker,payload:sfn.TaskInput.fromJsonPathAt('$.preflight'),payloadResponseOnly:true,resultPath:'$.worker'});
    const finalize=new sfnTasks.LambdaInvoke(this,'ReportFinalize',{lambdaFunction:finalizerFn,payload:sfn.TaskInput.fromObject({'reportId.$':'$.reportId','artifacts.$':'$.worker.artifacts'}),payloadResponseOnly:true,resultPath:'$.finalized'});
    const fail=new sfnTasks.LambdaInvoke(this,'ReportMarkFailed',{lambdaFunction:failedFn,payload:sfn.TaskInput.fromObject({'reportId.$':'$.reportId','error.$':'$.failure.Error'}),payloadResponseOnly:true,resultPath:'$.failed'});
    preflight.addRetry({maxAttempts:3,interval:cdk.Duration.seconds(5),backoffRate:2}).addCatch(fail,{resultPath:'$.failure'}); worker.addRetry({maxAttempts:2,interval:cdk.Duration.seconds(10),backoffRate:2}).addCatch(fail,{resultPath:'$.failure'}); finalize.addRetry({maxAttempts:5,interval:cdk.Duration.seconds(5),backoffRate:2}).addCatch(fail,{resultPath:'$.failure'});
    const child=preflight.next(worker).next(finalize);
    // Keep requestId at the root for the request finalizer after Map completion.
    const map=new sfn.Map(this,'ReportFanout',{itemsPath:'$.reportIds',maxConcurrency:4,resultPath:'$.fanout',parameters:{'requestId.$':'$.requestId','reportId.$':'$$.Map.Item.Value'}}).iterator(child);
    const finish=new sfnTasks.LambdaInvoke(this,'ReportRequestFinalize',{lambdaFunction:requestFinalizerFn,payload:sfn.TaskInput.fromObject({'requestId.$':'$.requestId'}),outputPath:'$.Payload'});
    finish.addRetry({maxAttempts:6,interval:cdk.Duration.seconds(10),backoffRate:2});
    const reportStateMachine=new sfn.StateMachine(this,'ReportStateMachine',{definitionBody:sfn.DefinitionBody.fromChainable(map.next(finish)),timeout:cdk.Duration.hours(1),stateMachineType:sfn.StateMachineType.STANDARD,logs:{level:sfn.LogLevel.OFF}});
    dispatcherFn.addEnvironment('REPORT_STATE_MACHINE_ARN',reportStateMachine.stateMachineArn);reportStateMachine.grantStartExecution(dispatcherFn);
    new events.Rule(this,'ReportOutboxDispatchSchedule',{schedule:events.Schedule.rate(cdk.Duration.minutes(1)),targets:[new targets.LambdaFunction(dispatcherFn)]});

    // Isolated smoke lane. It has no EventBridge target: the future smoke runner invokes
    // SmokeReportDispatcherFunction on demand after preparing its dedicated database.
    const smokeWorkflowEnvironment={DATABASE_PROXY_HOST:databaseProxy.endpoint,DATABASE_SSL:'require',SMOKE_DATABASE_SECRET_ARN:smokeDatabaseSecret.secretArn,SMOKE_DATABASE_NAME:smokeDatabaseName,SAMPLE_BUCKET_NAME:sampleBucket.bucketName,REPORT_BUCKET_NAME:reportBucket.bucketName,SMOKE_RAW_PREFIX:'smoke/raw/',SMOKE_REPORT_PREFIX:'smoke/reports/'};
    const smokeWorkflowLambda=(id:string,handler:string)=>new lambda.DockerImageFunction(this,id,{code:workflowImageFor(handler),vpc,vpcSubnets:{subnetType:ec2.SubnetType.PRIVATE_ISOLATED},securityGroups:[smokeWorkflowSecurityGroup],timeout:cdk.Duration.minutes(2),memorySize:512,environment:smokeWorkflowEnvironment,logGroup:workflowLogGroup});
    const smokePreflightFn=smokeWorkflowLambda('SmokeReportPreflightFunction','handlers/reportSmokeWorkflow.preflight');
    const smokeFinalizerFn=smokeWorkflowLambda('SmokeReportFinalizerFunction','handlers/reportSmokeWorkflow.finalize');
    const smokeFailedFn=smokeWorkflowLambda('SmokeReportFailureFunction','handlers/reportSmokeWorkflow.fail');
    const smokeRequestFinalizerFn=smokeWorkflowLambda('SmokeReportRequestFinalizerFunction','handlers/reportSmokeWorkflow.finalizeRequest');
    const smokeDispatcherFn=smokeWorkflowLambda('SmokeReportDispatcherFunction','handlers/reportSmokeWorkflow.dispatch');
    const smokeAnalysisWorker=new lambda.DockerImageFunction(this,'SmokeAnalysisWorkerFunction',{code:workerImage,timeout:cdk.Duration.minutes(15),memorySize:3008,ephemeralStorageSize:cdk.Size.gibibytes(4),vpc,vpcSubnets:{subnetType:ec2.SubnetType.PRIVATE_ISOLATED},securityGroups:[smokeWorkflowSecurityGroup],environment:{SAMPLE_BUCKET_NAME:sampleBucket.bucketName,REPORT_BUCKET_NAME:reportBucket.bucketName,REPORT_PREFIX:'smoke/reports/'},logGroup:workflowLogGroup});
    for(const fn of [smokePreflightFn,smokeFinalizerFn,smokeFailedFn,smokeRequestFinalizerFn,smokeDispatcherFn]){smokeDatabaseSecret.grantRead(fn);fn.addToRolePolicy(new iam.PolicyStatement({actions:['s3:GetObject'],resources:[sampleBucket.arnForObjects('smoke/raw/*'),reportBucket.arnForObjects('smoke/reports/*')]}));}
    smokeFinalizerFn.addToRolePolicy(new iam.PolicyStatement({actions:['s3:PutObject'],resources:[reportBucket.arnForObjects('smoke/reports/*')]}));
    smokeAnalysisWorker.addToRolePolicy(new iam.PolicyStatement({actions:['s3:GetObject','s3:GetObjectVersion'],resources:[sampleBucket.arnForObjects('smoke/raw/*')]}));
    smokeAnalysisWorker.addToRolePolicy(new iam.PolicyStatement({actions:['s3:PutObject'],resources:[reportBucket.arnForObjects('smoke/reports/*')]}));
    const smokePreflight=new sfnTasks.LambdaInvoke(this,'SmokeReportPreflight',{lambdaFunction:smokePreflightFn,payloadResponseOnly:true,resultPath:'$.preflight'});
    const smokeWorker=new sfnTasks.LambdaInvoke(this,'SmokeReportWorker',{lambdaFunction:smokeAnalysisWorker,payload:sfn.TaskInput.fromJsonPathAt('$.preflight'),payloadResponseOnly:true,resultPath:'$.worker'});
    const smokeFinalize=new sfnTasks.LambdaInvoke(this,'SmokeReportFinalize',{lambdaFunction:smokeFinalizerFn,payload:sfn.TaskInput.fromObject({'reportId.$':'$.reportId','artifacts.$':'$.worker.artifacts'}),payloadResponseOnly:true,resultPath:'$.finalized'});
    const smokeFail=new sfnTasks.LambdaInvoke(this,'SmokeReportMarkFailed',{lambdaFunction:smokeFailedFn,payload:sfn.TaskInput.fromObject({'reportId.$':'$.reportId','error.$':'$.failure.Error'}),payloadResponseOnly:true,resultPath:'$.failed'});
    smokePreflight.addRetry({maxAttempts:3,interval:cdk.Duration.seconds(5),backoffRate:2}).addCatch(smokeFail,{resultPath:'$.failure'});smokeWorker.addRetry({maxAttempts:2,interval:cdk.Duration.seconds(10),backoffRate:2}).addCatch(smokeFail,{resultPath:'$.failure'});smokeFinalize.addRetry({maxAttempts:5,interval:cdk.Duration.seconds(5),backoffRate:2}).addCatch(smokeFail,{resultPath:'$.failure'});
    const smokeMap=new sfn.Map(this,'SmokeReportFanout',{itemsPath:'$.reportIds',maxConcurrency:1,resultPath:'$.fanout',parameters:{'requestId.$':'$.requestId','reportId.$':'$$.Map.Item.Value'}}).iterator(smokePreflight.next(smokeWorker).next(smokeFinalize));
    const smokeFinish=new sfnTasks.LambdaInvoke(this,'SmokeReportRequestFinalize',{lambdaFunction:smokeRequestFinalizerFn,payload:sfn.TaskInput.fromObject({'requestId.$':'$.requestId'}),outputPath:'$.Payload'});
    const smokeReportStateMachine=new sfn.StateMachine(this,'SmokeReportStateMachine',{definitionBody:sfn.DefinitionBody.fromChainable(smokeMap.next(smokeFinish)),timeout:cdk.Duration.hours(1),stateMachineType:sfn.StateMachineType.STANDARD,logs:{level:sfn.LogLevel.OFF}});
    smokeDispatcherFn.addEnvironment('REPORT_STATE_MACHINE_ARN',smokeReportStateMachine.stateMachineArn);smokeReportStateMachine.grantStartExecution(smokeDispatcherFn);
    // This VPC Lambda is the only manual entry point. It has no event source and can invoke
    // only the isolated dispatcher after migrating and seeding the separate smoke database.
    const smokeRunnerFn=new lambda.DockerImageFunction(this,'ReportSmokeRunnerFunction',{code:workflowImageFor('handlers/reportSmokeRunner.run'),vpc,vpcSubnets:{subnetType:ec2.SubnetType.PRIVATE_ISOLATED},securityGroups:[smokeWorkflowSecurityGroup],timeout:cdk.Duration.minutes(15),memorySize:1024,environment:{DATABASE_PROXY_HOST:databaseProxy.endpoint,DATABASE_SSL:'require',SMOKE_DATABASE_SECRET_ARN:smokeDatabaseSecret.secretArn,SMOKE_DATABASE_NAME:smokeDatabaseName,SAMPLE_BUCKET_NAME:sampleBucket.bucketName,REPORT_BUCKET_NAME:reportBucket.bucketName,SMOKE_RAW_PREFIX:'smoke/raw/',SMOKE_REPORT_PREFIX:'smoke/reports/',SMOKE_DISPATCHER_FUNCTION_NAME:smokeDispatcherFn.functionName},logGroup:workflowLogGroup});
    smokeDatabaseSecret.grantRead(smokeRunnerFn);
    smokeRunnerFn.addToRolePolicy(new iam.PolicyStatement({actions:['s3:GetObject','s3:GetObjectVersion','s3:PutObject','s3:DeleteObject'],resources:[sampleBucket.arnForObjects('smoke/raw/*'),reportBucket.arnForObjects('smoke/reports/*')]}));
    smokeDispatcherFn.grantInvoke(smokeRunnerFn);
    const applicationService = new ecs.FargateService(this, 'PrivateApplicationService', {
      cluster,
      taskDefinition,
      desiredCount: diagnosticMode ? 0 : 1,
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
    const httpListener = temporaryBrowserLoadBalancer.addListener('TemporaryHttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false,
    });
    if (domainActivation) {
      httpListener.addAction('RedirectHttpToHttps', {
        action: elbv2.ListenerAction.redirect({ protocol: 'HTTPS', port: '443', permanent: true }),
      });
      const httpsListener = temporaryBrowserLoadBalancer.addListener('ApplicationHttpsListener', {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        certificates: [elbv2.ListenerCertificate.fromCertificateManager(applicationCertificate)],
        defaultAction: elbv2.ListenerAction.fixedResponse(404, { contentType: 'text/plain', messageBody: 'Not found' }),
        open: false,
      });
      httpsListener.addAction('RedirectWwwToApex', {
        priority: 10,
        conditions: [elbv2.ListenerCondition.hostHeaders([wwwApplicationHostname])],
        action: elbv2.ListenerAction.redirect({ host: applicationHostname, protocol: 'HTTPS', port: '443', path: '/#{path}', query: '#{query}', permanent: true }),
      });
      httpsListener.addTargets('CanonicalApplicationTargets', {
        priority: 20,
        conditions: [elbv2.ListenerCondition.hostHeaders([applicationHostname])],
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [applicationService],
        healthCheck: { path: '/health', healthyHttpCodes: '200' },
      });
      new route53.ARecord(this, 'ApplicationApexAliasRecord', {
        zone: applicationHostedZone,
        target: route53.RecordTarget.fromAlias(new route53targets.LoadBalancerTarget(temporaryBrowserLoadBalancer)),
      });
      new route53.AaaaRecord(this, 'ApplicationApexAliasIpv6Record', {
        zone: applicationHostedZone,
        target: route53.RecordTarget.fromAlias(new route53targets.LoadBalancerTarget(temporaryBrowserLoadBalancer)),
      });
      new route53.ARecord(this, 'ApplicationWwwAliasRecord', {
        zone: applicationHostedZone,
        recordName: 'www',
        target: route53.RecordTarget.fromAlias(new route53targets.LoadBalancerTarget(temporaryBrowserLoadBalancer)),
      });
      new route53.AaaaRecord(this, 'ApplicationWwwAliasIpv6Record', {
        zone: applicationHostedZone,
        recordName: 'www',
        target: route53.RecordTarget.fromAlias(new route53targets.LoadBalancerTarget(temporaryBrowserLoadBalancer)),
      });
    } else {
      httpListener.addTargets('TemporaryBrowserTargets', {
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [applicationService],
        healthCheck: { path: '/health', healthyHttpCodes: '200' },
      });
    }

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
        DATABASE_SECRET_ARN: database.secret!.secretArn,
        BOOTSTRAP_ADMIN_SECRET_ARN: bootstrapAdminSecret.secretArn,
      },
    });
    database.secret!.grantRead(bootstrapTaskDefinition.taskRole);
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

    let pipeline: codepipeline.Pipeline | undefined;
    let domainActivationPipeline: codepipeline.Pipeline | undefined;
    if (!diagnosticMode) {
      const sourceOutput = new codepipeline.Artifact('SourceOutput');
      const validationProject = pipelineProject(this, 'ValidationProject', {
        buildSpec: codebuild.BuildSpec.fromObject({
          version: '0.2',
          phases: {
            install: { 'runtime-versions': { nodejs: 24 }, commands: ['npm ci'] },
            build: { commands: ['npm run check', 'npm run build', 'npm run test', 'cd infra && npx cdk synth -c nodeBaseImage=public.ecr.aws/docker/library/node:24-alpine -c environment=production -c applicationHostedZoneId=Z0640322GREKLUZ06W3O -c applicationExpectedNameServers=ns-723.awsdns-26.net,ns-386.awsdns-48.com,ns-1026.awsdns-00.org,ns-1580.awsdns-05.co.uk -c legacyApplicationCertificateArn=arn:aws:acm:us-east-1:265404809336:certificate/52ff0b5a-79fb-4504-ac2e-9c5ce89f303c -c applicationActivation=true && node scripts/assert-smoke-workflow.mjs'] },
          },
        }),
      });
      const deploymentProject = pipelineProject(this, 'DeploymentProject', {
        buildSpec: codebuild.BuildSpec.fromObject({
          version: '0.2',
          phases: {
            install: { 'runtime-versions': { nodejs: 24 }, commands: ['npm ci'] },
            build: { commands: ['npm run check', 'npm run build', 'npm run test', 'cd infra && npx cdk deploy WallyPlatform-production -c nodeBaseImage=public.ecr.aws/docker/library/node:24-alpine -c environment=production -c applicationHostedZoneId=Z0640322GREKLUZ06W3O -c applicationExpectedNameServers=ns-723.awsdns-26.net,ns-386.awsdns-48.com,ns-1026.awsdns-00.org,ns-1580.awsdns-05.co.uk -c legacyApplicationCertificateArn=arn:aws:acm:us-east-1:265404809336:certificate/52ff0b5a-79fb-4504-ac2e-9c5ce89f303c -c applicationActivation=true --require-approval never && node scripts/assert-smoke-workflow.mjs'] },
            post_build: { commands: ['echo "Foundation deployment preserves the activated HTTPS listener, certificate, and canonical Route 53 aliases."'] },
          },
        }),
      });
      // Activation has its own manually-started pipeline: source is pinned to a
      // reviewed main revision, then a human must approve the DNS-preflighted deploy.
      const activationProject = pipelineProject(this, 'DomainActivationProject', {
        buildSpec: codebuild.BuildSpec.fromObject({
          version: '0.2',
          phases: {
            install: { 'runtime-versions': { nodejs: 24 }, commands: ['npm ci'] },
            pre_build: { commands: ['bash infra/scripts/domain-activation-preflight.sh'] },
            build: { commands: ['npm run check', 'npm run build', 'npm run test', 'cd infra && npx cdk deploy WallyPlatform-production -c nodeBaseImage=public.ecr.aws/docker/library/node:24-alpine -c environment=production -c applicationHostedZoneId=Z0640322GREKLUZ06W3O -c applicationExpectedNameServers=ns-723.awsdns-26.net,ns-386.awsdns-48.com,ns-1026.awsdns-00.org,ns-1580.awsdns-05.co.uk -c legacyApplicationCertificateArn=arn:aws:acm:us-east-1:265404809336:certificate/52ff0b5a-79fb-4504-ac2e-9c5ce89f303c -c applicationActivation=true --require-approval never && node scripts/assert-smoke-workflow.mjs'] },
          },
        }),
        environment: {
          APPLICATION_DOMAIN: applicationHostname,
          EXPECTED_NAME_SERVERS: expectedDomainNameServers.join(','),
        },
      });
      const bootstrapRoleArns = [
        'deploy-role',
        'file-publishing-role',
        'image-publishing-role',
        'lookup-role',
      ].map((role) => `arn:aws:iam::265404809336:role/cdk-hnb659fds-${role}-265404809336-us-east-1`);
      for (const project of [deploymentProject, activationProject]) {
        project.addToRolePolicy(new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: bootstrapRoleArns }));
        project.addToRolePolicy(new iam.PolicyStatement({
          actions: ['ssm:GetParameter'],
          resources: ['arn:aws:ssm:us-east-1:265404809336:parameter/cdk-bootstrap/hnb659fds/version'],
        }));
      }

      pipeline = new codepipeline.Pipeline(this, 'ProductionPipeline', {
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

      const activationSourceOutput = new codepipeline.Artifact('DomainActivationSourceOutput');
      domainActivationPipeline = new codepipeline.Pipeline(this, 'DomainActivationPipeline', {
        pipelineName: 'wally-analyzer-domain-activation',
        pipelineType: codepipeline.PipelineType.V1,
        restartExecutionOnUpdate: false,
      });
      domainActivationPipeline.addStage({
        stageName: 'Source',
        actions: [new codepipelineActions.CodeStarConnectionsSourceAction({
          actionName: 'GitHubMain',
          connectionArn: props.githubConnectionArn,
          owner: props.githubOwner,
          repo: props.githubRepository,
          branch: 'main',
          output: activationSourceOutput,
          triggerOnPush: false,
        })],
      });
      domainActivationPipeline.addStage({
        stageName: 'Approval',
        actions: [new codepipelineActions.ManualApprovalAction({
          actionName: 'ApproveDomainActivation',
          additionalInformation: 'Confirm public DNS delegation and approve the ACM/HTTPS activation deployment.',
        })],
      });
      domainActivationPipeline.addStage({
        stageName: 'Activate',
        actions: [new codepipelineActions.CodeBuildAction({
          actionName: 'PreflightAndActivate',
          project: activationProject,
          input: activationSourceOutput,
        })],
      });
    }

    new cdk.CfnOutput(this, 'ApplicationHostname', {
      value: applicationHostname,
      description: 'Canonical public application hostname.',
    });
    new cdk.CfnOutput(this, 'ApplicationHostedZoneId', {
      value: applicationHostedZone.hostedZoneId,
      description: 'Route 53 hosted-zone ID for wally-analytics.app.',
    });
    new cdk.CfnOutput(this, 'ApplicationExpectedNameServers', {
      value: expectedDomainNameServers.join(','),
      description: 'Expected Route 53 delegation, verified by the activation preflight.',
    });
    new cdk.CfnOutput(this, 'ApplicationCertificateArn', {
      value: applicationCertificate.certificateArn,
      description: domainActivation ? 'Activation ACM certificate for apex and www.' : 'Existing legacy certificate retained until explicit activation.',
    });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'WebClientId', { value: webClient.userPoolClientId });
    new cdk.CfnOutput(this, 'SampleBucketName', { value: sampleBucket.bucketName });
    new cdk.CfnOutput(this, 'ReportBucketName', { value: reportBucket.bucketName });
    new cdk.CfnOutput(this, 'DatabaseProxyEndpoint', { value: databaseProxy.endpoint });
    new cdk.CfnOutput(this, 'ReportSmokeRunnerFunctionName', { value: smokeRunnerFn.functionName, description: 'Manually invoked isolated Tracking Error smoke runner.' });
    new cdk.CfnOutput(this, 'BootstrapAdministratorSecretArn', { value: bootstrapAdminSecret.secretArn });
    new cdk.CfnOutput(this, 'BootstrapAdministratorTaskDefinitionArn', { value: bootstrapTaskDefinition.taskDefinitionArn });
    new cdk.CfnOutput(this, 'ApplicationTaskDefinitionArn', { value: taskDefinition.taskDefinitionArn });
    new cdk.CfnOutput(this, 'ApplicationClusterArn', { value: cluster.clusterArn });
    new cdk.CfnOutput(this, 'ApplicationLogGroupName', { value: applicationLogGroup.logGroupName });
    new cdk.CfnOutput(this, 'ApplicationHttpsUrl', {
      value: `https://${applicationHostname}`,
      description: 'Canonical public HTTPS application URL.',
    });
    new cdk.CfnOutput(this, 'ApplicationLoadBalancerDnsName', {
      value: temporaryBrowserLoadBalancer.loadBalancerDnsName,
      description: 'External DNS target for the wally-analytics.app apex ALIAS, ANAME, or CNAME-flattening record.'
    });
    new cdk.CfnOutput(this, 'PrivateTaskSecurityGroupId', { value: serviceSecurityGroup.securityGroupId });
    new cdk.CfnOutput(this, 'DatabaseBastionInstanceId', { value: bastion.instanceId });
    new cdk.CfnOutput(this, 'PrivateSubnetIds', { value: vpc.isolatedSubnets.map((subnet) => subnet.subnetId).join(',') });
    if (pipeline) new cdk.CfnOutput(this, 'ProductionPipelineName', { value: pipeline.pipelineName });
    if (domainActivationPipeline) new cdk.CfnOutput(this, 'DomainActivationPipelineName', {
      value: domainActivationPipeline.pipelineName,
      description: 'Manually-started, approval-gated DNS-preflighted domain activation pipeline.',
    });
  }
}

function requiredContext(scope: Construct, key: string): string {
  const value = scope.node.tryGetContext(key);
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing required CDK context: ${key}`);
  return value.trim();
}

function contextBoolean(scope: Construct, key: string): boolean {
  const value = scope.node.tryGetContext(key);
  return value === true || value === 'true';
}

function retainedHostedZoneBridge(scope: Construct, zoneName: string): route53.IHostedZone {
  const resource = new route53.CfnHostedZone(scope, 'ApplicationHostedZone', { name: zoneName });
  resource.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.RETAIN;
  resource.cfnOptions.updateReplacePolicy = cdk.CfnDeletionPolicy.RETAIN;
  return route53.HostedZone.fromHostedZoneAttributes(scope, 'RetainedApplicationHostedZone', {
    hostedZoneId: resource.ref,
    zoneName,
  });
}

function legacyCertificateBridge(scope: Construct, domainName: string): acm.ICertificate {
  const resource = new acm.CfnCertificate(scope, 'ApplicationCertificate', {
    domainName,
    validationMethod: 'DNS',
  });
  resource.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.RETAIN;
  resource.cfnOptions.updateReplacePolicy = cdk.CfnDeletionPolicy.RETAIN;
  return acm.Certificate.fromCertificateArn(scope, 'RetainedApplicationCertificate', resource.ref);
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

function pipelineProject(scope: Construct, id: string, props: { buildSpec: codebuild.BuildSpec; environment?: Record<string, string> }): codebuild.PipelineProject {
  return new codebuild.PipelineProject(scope, id, {
    environment: {
      buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      privileged: true,
      environmentVariables: Object.fromEntries(Object.entries(props.environment ?? {}).map(([name, value]) => [name, { value }])),
    },
    buildSpec: props.buildSpec,
    timeout: cdk.Duration.minutes(60),
  });
}
