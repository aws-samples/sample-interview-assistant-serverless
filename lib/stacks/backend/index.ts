import { StackProps, Stage, Tags, CfnOutput, Fn } from "aws-cdk-lib";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as iam from "aws-cdk-lib/aws-iam";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { CommonStack } from "../../common/constructs/stack";
import { AuthStack } from "./auth";
import { StorageStack } from "./storage";

import { KnowledgeBaseStack } from "./knowledgebase";
// import { GuardrailsStack } from './guardrails';
import { AgentCoreMemoryStack } from "./memory";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { CloudFrontIntegration } from "./cloudfront-integration";
// NEW: Serverless stacks for migration
import { LambdaRestApiStack } from "./lambda-rest-api";
import { AgentCoreRuntimeStack } from "./agentcore-runtime";

interface BackendProps extends StackProps {
  region: String;
  stage: String;
  projectId: String;
}

export class Backend extends CommonStack {
  public readonly environmentVariables: Record<string, string>;
  public readonly websiteBucket: Bucket;
  public readonly distribution: Distribution;
  public readonly cloudfrontIntegration: CloudFrontIntegration;

  constructor(scope: Construct, id: string, props: BackendProps) {
    super(scope, id, props);

    // Define resource prefix based on project ID
    const resourcePrefix = props.projectId.toString();
    const environment = props.stage.toString();

    // Add stage tag to all resources in this stack
    Tags.of(this).add("Stage", environment);

    // Helper to generate consistent stack names with dashes
    const getNestedStackName = (nestedId: string) =>
      `${environment}-${resourcePrefix}-backend-${nestedId}`;

    // Create storage stack with CloudFront distribution
    const storage = new StorageStack(this, `storage`, {
      ...props,
      stackName: getNestedStackName("storage"),
    });

    // Use the URLs from storage for auth and other stacks
    const urls = storage.urls;

    const auth = new AuthStack(this, `auth`, {
      urls,
      ...props,
      stackName: getNestedStackName("auth"),
    });
    // Grant authenticated users specific S3 permissions (no Delete operations)
    storage.dataBucket.grantRead(auth.identityPool.authenticatedRole);
    storage.dataBucket.grantPut(auth.identityPool.authenticatedRole);

    // Create KnowledgeBaseStack for interview questions
    const knowledgeBaseStack = new KnowledgeBaseStack(this, `vectorstore`, {
      ...props,
      dataBucket: storage.dataBucket,
      stackName: getNestedStackName("knowledgebase"),
    });
    knowledgeBaseStack.node.addDependency(storage);

    // // Create Guardrails Stack for security
    // const guardrailsStack = new GuardrailsStack(this, `guardrails`, {
    //     ...props,
    // });
    // guardrailsStack.node.addDependency(knowledgeBaseStack)

    // Create AgentCore Memory
    const memoryStack = new AgentCoreMemoryStack(this, `memory`, {
      region: props.region.toString(),
      stage: props.stage.toString(),
      projectId: props.projectId.toString(),
      stackName: getNestedStackName("memory"),
    });

    // ====================================================================================
    // NEW: Serverless Backend (Lambda + AgentCore Runtime) for migration
    // This runs in parallel with EKS during the migration phase
    // Uses SSM Parameter Store to break circular dependency between Lambda and AgentCore
    // ====================================================================================

    // Step 1: Create Lambda REST API Stack FIRST (without AgentCore ARN)
    // Lambda will read AgentCore Runtime ARN from Parameter Store at runtime
    const lambdaRestApiStack = new LambdaRestApiStack(this, `lambda-rest-api`, {
      region: props.region.toString(),
      stage: props.stage.toString(),
      projectId: props.projectId.toString(),
      userPool: auth.userPool,
      userPoolClient: auth.userPoolClient,
      identityPoolId: auth.identityPool.identityPoolId,
      dataBucket: storage.dataBucket.bucketName,
      memoryId: memoryStack.memoryId || undefined,
      agentCoreRuntimeArn: "", // Will be retrieved from SSM Parameter Store at runtime
      knowledgeBaseId: knowledgeBaseStack.knowledgeBase.ref, // Knowledge Base ID for interview questions
      cloudFrontDomain: storage.distribution.distributionDomainName, // For CORS configuration
      stackName: getNestedStackName("lambda-rest-api"),
    });
    lambdaRestApiStack.node.addDependency(storage);
    lambdaRestApiStack.node.addDependency(auth);
    lambdaRestApiStack.node.addDependency(memoryStack);
    lambdaRestApiStack.node.addDependency(knowledgeBaseStack);

    // Grant Lambda REST API access to data bucket for video uploads
    // Note: grantReadWrite() adds IAM permissions but NOT bucket policy
    // Bucket policy for presigned URLs must be added manually (see below)
    storage.dataBucket.grantReadWrite(lambdaRestApiStack.restApiFunction);

    // IMPORTANT: Bucket policy for presigned URL uploads
    // Cannot use addToResourcePolicy() here due to circular dependency:
    //   - Lambda depends on Storage (for bucket name env var)
    //   - Storage would depend on Lambda (for role ARN in policy)
    // Solution: Apply bucket policy manually after deployment:
    //   aws s3api get-bucket-policy --bucket <bucket-name> --query Policy --output text | jq . > /tmp/policy.json
    //   # Add Lambda role ARN to Allow statement
    //   aws s3api put-bucket-policy --bucket <bucket-name> --policy file:///tmp/policy.json

    // Step 2: Create AgentCore Runtime Stack with direct CDK reference to Lambda ARN
    // Uses L2 alpha constructs with automatic Docker build and deployment
    const agentCoreRuntimeStack = new AgentCoreRuntimeStack(
      this,
      `agentcore-runtime`,
      {
        region: props.region.toString(),
        stage: props.stage.toString(),
        projectId: props.projectId.toString(),
        restApiLambdaArn: lambdaRestApiStack.restApiFunction.functionArn,
        restApiLambdaFunctionName:
          lambdaRestApiStack.restApiFunction.functionName,
        userPool: auth.userPool,
        userPoolClient: auth.userPoolClient,
        identityPoolId: auth.identityPool.identityPoolId,
        dataBucket: storage.dataBucket,
        memoryId: memoryStack.memoryId,
        cloudFrontDomain: storage.distribution.distributionDomainName, // For CORS configuration
        stackName: getNestedStackName("agentcore-runtime"),
      },
    );
    agentCoreRuntimeStack.node.addDependency(lambdaRestApiStack);

    // Step 3: Store Lambda ARN in SSM Parameter Store (for documentation/reference)
    // Note: Not actually used by AgentCore - it gets the ARN via direct CDK reference
    new ssm.StringParameter(this, "LambdaRestApiArnParameter", {
      parameterName: `/${resourcePrefix}/lambda/rest-api-arn`,
      stringValue: lambdaRestApiStack.restApiFunction.functionArn,
      description: "Lambda REST API Function ARN (for reference)",
      tier: ssm.ParameterTier.STANDARD,
    });

    // Step 4: Store AgentCore Runtime ARN in SSM Parameter Store for Lambda to use at runtime
    // Note: Lambda IAM permissions for SSM read are added in the LambdaRestApiStack to avoid circular dependencies
    new ssm.StringParameter(this, "AgentCoreRuntimeArnParameter", {
      parameterName: `/${resourcePrefix}/agentcore/runtime-arn`,
      stringValue: agentCoreRuntimeStack.agentRuntimeArn,
      description:
        "AgentCore Runtime ARN for Lambda to generate pre-signed WebSocket URLs",
      tier: ssm.ParameterTier.STANDARD,
    });

    // Output serverless backend URLs
    new CfnOutput(this, "ServerlessRestApiUrl", {
      value: lambdaRestApiStack.httpApi.apiEndpoint,
      description: "Serverless REST API Gateway endpoint",
      exportName: `${this.stackName}-RestApiUrl`,
    });

    new CfnOutput(this, "ServerlessWebSocketUrl", {
      value: agentCoreRuntimeStack.agentRuntimeArn,
      description:
        "AgentCore Runtime ARN (WebSocket URL format: wss://<runtime-id>.agentcore.<region>.amazonaws.com)",
      // No exportName to allow runtime name changes without CloudFormation export conflicts
    });

    // ====================================================================================
    // CloudFront Integration: Add API Gateway origin
    // Note: WebSocket now uses pre-signed URLs directly to AgentCore Runtime (no /ws origin needed)
    // ====================================================================================

    const cloudfrontIntegration = new CloudFrontIntegration(
      this,
      `cloudfront-integration`,
      {
        distribution: storage.distribution,
        apiGatewayEndpoint: lambdaRestApiStack.httpApi.apiEndpoint,
        resourcePrefix: resourcePrefix,
        cloudFrontHeaderSecret: lambdaRestApiStack.cloudFrontHeaderSecret,
      },
    );
    cloudfrontIntegration.node.addDependency(storage);
    cloudfrontIntegration.node.addDependency(lambdaRestApiStack);

    NagSuppressions.addStackSuppressions(this, [
      {
        id: "AwsSolutions-IAM4",
        reason:
          "Lambda functions require managed policies to interface with the vpc.",
      },
      {
        id: "AwsSolutions-SF1",
        reason:
          "Step Functions from CDK provider constructs don't have CloudWatch logging enabled by default. These are auto-generated by CDK.",
      },
      {
        id: "AwsSolutions-SF2",
        reason:
          "Step Functions from CDK provider constructs don't have X-Ray tracing enabled by default. These are auto-generated by CDK.",
      },
    ]);

    this.websiteBucket = storage.websiteBucket;
    this.distribution = storage.distribution;
    this.cloudfrontIntegration = cloudfrontIntegration;

    this.environmentVariables = {
      REACT_APP_AWS_REGION: props.region.toString(),
      REACT_APP_USER_POOL_ID: auth.userPool.userPoolId,
      ...(auth.userPoolDomain && {
        // Fully qualified domain name for Cognito (including domain prefix)
        REACT_APP_OAUTH_DOMAIN: `${props.stage.toString()}-${props.projectId.toString()}.auth.${props.region.toString()}.amazoncognito.com`,
      }),
      REACT_APP_USER_POOL_CLIENT_ID: auth.userPoolClient.userPoolClientId,
      REACT_APP_IDENTITY_POOL_ID: auth.identityPool.identityPoolId,
      REACT_APP_CALLBACK_URL: `https://${storage.distribution.distributionDomainName}`,
      REACT_APP_OAUTH_REDIRECT_SIGN_IN: `https://${storage.distribution.distributionDomainName}`,
      REACT_APP_OAUTH_REDIRECT_SIGN_OUT: `https://${storage.distribution.distributionDomainName}`,
      // All API traffic routes through CloudFront for same-domain access
      // Note: /api prefix is already included in frontend routes, so baseURL should not include it
      REACT_APP_API_URL: `https://${storage.distribution.distributionDomainName}`,
      REACT_APP_WS_URL: `wss://${storage.distribution.distributionDomainName}`,
      // Authentication mode: 'oauth' (Midway) or 'direct' (Cognito)
      REACT_APP_AUTH_MODE: auth.authenticationMode,
      // Customer branding: Allow customization via environment variables
      REACT_APP_CUSTOMER_NAME: process.env.CUSTOMER_NAME || "AnyCompany",
      REACT_APP_CUSTOMER_LOGO:
        process.env.CUSTOMER_LOGO || "/interview_logo.png",
    };
  }
}
