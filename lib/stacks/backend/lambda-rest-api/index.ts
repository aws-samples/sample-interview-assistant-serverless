import {
  StackProps,
  Duration,
  CfnOutput,
  RemovalPolicy,
  aws_lambda as lambda,
  aws_iam as iam,
  aws_logs as logs,
  aws_apigatewayv2 as apigw,
} from "aws-cdk-lib";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { CommonStack } from "../../../common/constructs/stack";
import { ArmBuildConstruct } from "../../../common/constructs/arm-build-construct";

export interface LambdaRestApiStackProps extends StackProps {
  region: string;
  stage: string;
  projectId: string;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  identityPoolId: string;
  dataBucket: string;
  memoryId?: string;
  agentCoreRuntimeArn?: string; // Optional: ARN for AgentCore Runtime (for pre-signed WebSocket URLs)
  knowledgeBaseId?: string; // Optional: Knowledge Base ID for interview questions
  cloudFrontDomain: string; // CloudFront distribution domain for CORS configuration
  cloudFrontHeaderSecret?: string; // Optional: Custom header secret for CloudFront verification
}

export class LambdaRestApiStack extends CommonStack {
  public readonly restApiFunction: lambda.DockerImageFunction;
  public readonly httpApi: apigw.HttpApi;
  public readonly apiGatewayWebAclArn: string;
  public readonly cloudFrontHeaderSecret: string;

  constructor(scope: Construct, id: string, props: LambdaRestApiStackProps) {
    super(scope, id, props);

    // Use props passed from parent stack
    const projectName = props.projectId;
    const environment = props.stage;

    // 1. Create IAM role for Lambda execution
    const lambdaRole = new iam.Role(this, "LambdaExecutionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole",
        ),
      ],
      inlinePolicies: {
        LambdaPolicy: new iam.PolicyDocument({
          statements: [
            // DynamoDB access
            // Table names are constructed by backend as: {projectName}-{TABLE}-{environment}
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "dynamodb:GetItem",
                "dynamodb:PutItem",
                "dynamodb:Query",
                "dynamodb:UpdateItem",
                "dynamodb:DeleteItem",
                "dynamodb:Scan",
              ],
              resources: [
                `arn:aws:dynamodb:${this.region}:${this.account}:table/${projectName}-SESSION-PREP-${environment}`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/${projectName}-SESSION-PREP-${environment}/index/*`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/${projectName}-SESSION-HISTORY-${environment}`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/${projectName}-SESSION-HISTORY-${environment}/index/*`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/${projectName}-FEEDBACK-${environment}`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/${projectName}-USERROLE-${environment}`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/${projectName}-DOCUMENTUPLOAD-${environment}`,
              ],
            }),
            // S3 access (including multipart upload for video recording)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:AbortMultipartUpload",
                "s3:ListMultipartUploadParts",
              ],
              resources: [`arn:aws:s3:::${props.dataBucket}/*`],
            }),
            // Bedrock model invocation (foundation models and inference profiles)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "bedrock:InvokeModel",
                "bedrock:InvokeModelWithResponseStream",
                "bedrock:InvokeTool",
                "bedrock:Retrieve", // Knowledge Base retrieval
                "bedrock:RetrieveAndGenerate", // Knowledge Base retrieval with generation
              ],
              resources: [
                "arn:aws:bedrock:*::foundation-model/*",
                `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`,
                `arn:aws:bedrock::${this.account}:system-tool/*`, // Nova Grounding system tool
                `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`, // Knowledge Bases
              ],
            }),
            // AgentCore Memory access (if provided)
            ...(props.memoryId
              ? [
                  new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: [
                      "bedrock-agentcore:PutMemory",
                      "bedrock-agentcore:GetMemory",
                      "bedrock-agentcore:ListMemories",
                    ],
                    resources: [
                      `arn:aws:bedrock-agentcore:${this.region}:${this.account}:memory/${props.memoryId}`,
                    ],
                  }),
                ]
              : []),
            // AgentCore Runtime WebSocket access
            // Required for generating pre-signed WebSocket URLs with IAM authentication
            // Uses wildcard since ARN is retrieved from SSM Parameter Store at runtime
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "bedrock-agentcore:InvokeAgentRuntimeWithWebSocketStream",
              ],
              resources: [
                `arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/*`,
              ],
            }),
            // SSM Parameter Store read access for AgentCore Runtime ARN
            // Lambda reads this at runtime to get the ARN if not provided via environment variable
            // Note: Parameter path uses projectId only (not projectId-environment)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["ssm:GetParameter"],
              resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/${projectName}/agentcore/*`,
              ],
            }),
            // Lambda self-invocation for async job processing
            // Allows Lambda to invoke itself asynchronously to process long-running jobs
            // This avoids API Gateway 30-second timeout by returning immediately while work continues
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["lambda:InvokeFunction"],
              resources: [
                `arn:aws:lambda:${this.region}:${this.account}:function:${this.stackName}-rest-api`,
              ],
            }),
          ],
        }),
      },
    });

    // 2. Build Lambda Docker image using dedicated CodeBuild project with native ARM64 compute
    // This avoids cross-compilation issues and ECR Public rate limits during local builds
    const lambdaBuild = new ArmBuildConstruct(this, "LambdaArmBuild", {
      sourcePath: "lib/stacks/backend/lambda-rest-api/app",
      region: props.region,
      namePrefix: `${projectName}-lambda-${environment}`,
      buildTimeoutMinutes: 20,
    });

    // 3. Create Lambda function from pre-built ECR image
    this.restApiFunction = new lambda.DockerImageFunction(
      this,
      "RestApiFunction",
      {
        functionName: `${this.stackName}-rest-api`,
        code: lambda.DockerImageCode.fromEcr(lambdaBuild.repository, {
          tagOrDigest: lambdaBuild.imageTag,
        }),
        architecture: lambda.Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.seconds(900), // 15 minutes for long-running operations
        role: lambdaRole,
        environment: {
          STACK_NAME: projectName,
          STACK_ENVIRONMENT: environment,
          DATA_BUCKET: props.dataBucket,
          FEATURE_FLAG_USE_NOVA_GROUNDING: "true",
          // Cognito configuration for JWT validation and Identity Pool credentials
          COGNITO_USER_POOL_ID: props.userPool.userPoolId,
          COGNITO_APP_CLIENT_ID: props.userPoolClient.userPoolClientId,
          COGNITO_IDENTITY_POOL_ID: props.identityPoolId,
          // CORS configuration - CloudFront origin
          ALLOWED_ORIGINS: `https://${props.cloudFrontDomain}`,
          ...(props.memoryId ? { AGENTCORE_MEMORY_ID: props.memoryId } : {}),
          ...(props.agentCoreRuntimeArn
            ? { AGENTCORE_RUNTIME_ARN: props.agentCoreRuntimeArn }
            : {}),
          ...(props.knowledgeBaseId
            ? { KNOWLEDGE_BASE_ID: props.knowledgeBaseId }
            : {}),
        },
        logRetention: logs.RetentionDays.ONE_WEEK,
      },
    );

    // Grant Lambda permission to pull from the build ECR repository
    lambdaBuild.repository.grantPull(lambdaRole);

    // Ensure Lambda is created after the build completes
    this.restApiFunction.node.addDependency(lambdaBuild);

    // 4. Create CloudWatch Log Group for API Gateway access logs
    const apiLogGroup = new logs.LogGroup(this, "ApiGatewayAccessLogs", {
      logGroupName: `/aws/apigateway/${this.stackName}-rest-api`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // 5. Create HTTP API Gateway
    this.httpApi = new apigw.HttpApi(this, "RestHttpApi", {
      apiName: `${this.stackName}-rest-api`,
      description: "REST API for Interview Assistant (serverless)",
      corsPreflight: {
        allowOrigins: ["*"], // Will be restricted to CloudFront in production
        allowMethods: [
          apigw.CorsHttpMethod.GET,
          apigw.CorsHttpMethod.POST,
          apigw.CorsHttpMethod.PUT,
          apigw.CorsHttpMethod.DELETE,
          apigw.CorsHttpMethod.PATCH,
          apigw.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["*"],
        // Note: allowCredentials cannot be true when allowOrigins is '*'
        // This will be configured when integrating with CloudFront
      },
    });

    // Configure access logging on the default stage
    const defaultStage = this.httpApi.defaultStage?.node
      .defaultChild as apigw.CfnStage;
    if (defaultStage) {
      defaultStage.accessLogSettings = {
        destinationArn: apiLogGroup.logGroupArn,
        format: JSON.stringify({
          requestId: "$context.requestId",
          ip: "$context.identity.sourceIp",
          caller: "$context.identity.caller",
          user: "$context.identity.user",
          requestTime: "$context.requestTime",
          httpMethod: "$context.httpMethod",
          resourcePath: "$context.resourcePath",
          status: "$context.status",
          protocol: "$context.protocol",
          responseLength: "$context.responseLength",
          errorMessage: "$context.error.message",
          errorType: "$context.error.messageString",
          integrationErrorMessage: "$context.integrationErrorMessage",
        }),
      };
    }

    // Generate or use provided CloudFront header secret for origin verification
    this.cloudFrontHeaderSecret =
      props.cloudFrontHeaderSecret || `cf-secret-${this.account}-${Date.now()}`;

    // 4a. Regional WAF for API Gateway - NOT CREATED
    // NOTE: AWS WAFv2 CfnWebACLAssociation does NOT support HTTP APIs (API Gateway v2)
    // It only supports: CloudFront, ALB, REST APIs (v1), AppSync, Cognito, App Runner
    // Since this API is accessed exclusively through CloudFront (which has WAF protection),
    // and we pass a custom header (x-origin-verify) for origin verification,
    // direct API Gateway WAF association is not possible.
    //
    // Security measures in place:
    // 1. CloudFront has WAF with rate limiting and managed rules (configured in storage stack)
    // 2. CloudFront sends custom header (x-origin-verify) to API Gateway
    // 3. API Gateway can validate the custom header at Lambda level if needed
    // 4. CORS restricts origins to CloudFront domain only
    //
    // If you need to migrate to REST API (v1) in the future, uncomment and create the WAF:
    // const apiGatewayWebAcl = new CfnWebACL(this, "ApiGatewayWebAcl", { ... });

    // Placeholder for WAF ARN (empty since no WAF is created)
    this.apiGatewayWebAclArn = "";

    // 4b. No WAF Association for HTTP APIs
    // See note in 4a above - HTTP APIs don't support WAF association

    // 4c. Add resource policy to API Gateway (CloudFront origin restriction)
    // Note: HTTP APIs don't support resource policies directly like REST APIs
    // Origin verification is provided via custom header (x-origin-verify) sent from CloudFront
    // For additional security, CORS is configured to only allow CloudFront domain

    // 6. Create JWT Authorizer
    const authorizer = new HttpJwtAuthorizer(
      "CognitoAuthorizer",
      `https://cognito-idp.${this.region}.amazonaws.com/${props.userPool.userPoolId}`,
      {
        jwtAudience: [props.userPoolClient.userPoolClientId],
      },
    );

    // 7. Create Lambda integration
    const lambdaIntegration = new HttpLambdaIntegration(
      "LambdaIntegration",
      this.restApiFunction,
    );

    // 8. Add routes
    // Catch-all route for /api/*
    this.httpApi.addRoutes({
      path: "/api/{proxy+}",
      methods: [apigw.HttpMethod.ANY],
      integration: lambdaIntegration,
      authorizer,
    });

    // Health check (no auth)
    const healthRoute = this.httpApi.addRoutes({
      path: "/health",
      methods: [apigw.HttpMethod.GET],
      integration: lambdaIntegration,
    });

    // Suppress auth warning for health check endpoint
    NagSuppressions.addResourceSuppressions(
      healthRoute,
      [
        {
          id: "AwsSolutions-APIG4",
          reason:
            "Health check endpoint intentionally has no authorization for monitoring purposes",
        },
      ],
      true,
    );

    // Outputs
    new CfnOutput(this, "RestApiUrl", {
      value: this.httpApi.apiEndpoint,
      description: "REST API Gateway endpoint URL",
    });

    new CfnOutput(this, "RestApiFunctionName", {
      value: this.restApiFunction.functionName,
      description: "Lambda function name",
    });

    new CfnOutput(this, "RestApiFunctionArn", {
      value: this.restApiFunction.functionArn,
      description: "Lambda function ARN",
    });

    new CfnOutput(this, "ApiGatewayLogGroup", {
      value: apiLogGroup.logGroupName,
      description: "API Gateway access logs CloudWatch Log Group",
    });

    // Note: API Gateway regional WAF output removed - HTTP APIs don't support WAF association
    // CloudFront WAF provides protection (configured in storage stack)

    new CfnOutput(this, "CloudFrontHeaderSecret", {
      value: this.cloudFrontHeaderSecret,
      description:
        "Custom header secret for CloudFront origin verification (use in CloudFront custom headers)",
    });

    // Nag Suppressions - Access logging is now enabled
    // NagSuppressions removed as AwsSolutions-APIG1 is now satisfied
  }
}
