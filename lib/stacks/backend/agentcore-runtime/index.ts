import {
  StackProps,
  CfnOutput,
  Duration,
  Fn,
  // aws_bedrockagentcore as bedrockagentcore,  // COMMENTED OUT - Gateway not used
  aws_cognito as cognito,
  aws_iam as iam,
  aws_s3 as s3,
  // custom_resources as cr,  // COMMENTED OUT - Used only for Gateway client secret
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as agentcore from "@aws-cdk/aws-bedrock-agentcore-alpha";
import { CommonStack } from "../../../common/constructs/stack";
import { ArmBuildConstruct } from "../../../common/constructs/arm-build-construct";

export interface AgentCoreRuntimeStackProps extends StackProps {
  region: string;
  stage: string;
  projectId: string;
  restApiLambdaArn: string;
  restApiLambdaFunctionName: string;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  identityPoolId: string;
  dataBucket: s3.IBucket;
  memoryId?: string;
  cloudFrontDomain: string; // CloudFront distribution domain for CORS configuration
}

export class AgentCoreRuntimeStack extends CommonStack {
  public readonly agentRuntime: agentcore.Runtime;
  public readonly agentRuntimeEndpoint: string;
  public readonly agentRuntimeArn: string;

  constructor(scope: Construct, id: string, props: AgentCoreRuntimeStackProps) {
    super(scope, id, props);

    // Use props passed from parent stack
    const projectName = props.projectId;
    const environment = props.stage;

    // Create IAM role for AgentCore Runtime
    const agentCoreRole = new iam.Role(this, "AgentCoreRole", {
      assumedBy: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com"),
      inlinePolicies: {
        AgentCorePolicy: new iam.PolicyDocument({
          statements: [
            // ECR access (for AgentCore to pull the container image)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "ecr:BatchGetImage",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchCheckLayerAvailability",
              ],
              resources: ["*"], // L2 construct manages ECR repo automatically
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["ecr:GetAuthorizationToken"],
              resources: ["*"], // This action doesn't support resource-level permissions
            }),
            // CloudWatch Logs
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
              ],
              resources: [
                `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*`,
              ],
            }),
            // Bedrock model invocation (Nova Sonic, foundation models, and inference profiles)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "bedrock:InvokeModel",
                "bedrock:InvokeModelWithResponseStream",
                "bedrock:InvokeTool",
              ],
              resources: [
                "arn:aws:bedrock:*::foundation-model/*",
                `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`,
                `arn:aws:bedrock::${this.account}:system-tool/*`, // Nova Grounding system tool
              ],
            }),
            // AgentCore Memory access
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "bedrock-agentcore:GetWorkloadAccessToken",
                "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
              ],
              resources: [
                `arn:aws:bedrock-agentcore:${this.region}:${this.account}:workload-identity-directory/default/*`,
              ],
            }),
            // DynamoDB access (for interview data)
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
            // Amazon Transcribe access (for Live Assistant candidateAssistant/interviewerAssistant sessions)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["transcribe:StartStreamTranscription"],
              resources: ["*"], // StartStreamTranscription doesn't support resource-level permissions
            }),
          ],
        }),
      },
    });

    // Build ARM64 Docker image using dedicated CodeBuild project with native ARM64 compute
    // This avoids cross-compilation issues when building on x86_64 hosts (e.g., Demo Factory)
    const armBuild = new ArmBuildConstruct(this, "AgentCoreArmBuild", {
      sourcePath: "lib/stacks/backend/agentcore-runtime/app",
      region: props.region,
      namePrefix: `${projectName}-agentcore-${environment}`,
      buildTimeoutMinutes: 30,
    });

    // Reference the pre-built ARM64 image from ECR
    const agentRuntimeArtifact =
      agentcore.AgentRuntimeArtifact.fromEcrRepository(
        armBuild.repository,
        armBuild.imageTag,
      );

    this.agentRuntime = new agentcore.Runtime(this, "InterviewAgentRuntime", {
      runtimeName: "sonicinterviewagent",
      agentRuntimeArtifact: agentRuntimeArtifact,
      executionRole: agentCoreRole,
      description: "AgentCore Runtime for Interview Assistant S2S",
      // Configure IAM authentication for WebSocket connections
      // Lambda will generate SigV4 pre-signed URLs using IAM credentials
      // No custom headers needed - authentication via query parameters
      authorizerConfiguration:
        agentcore.RuntimeAuthorizerConfiguration.usingIAM(),
      lifecycleConfiguration: {
        idleRuntimeSessionTimeout: Duration.minutes(15), // 900 seconds
        maxLifetime: Duration.hours(8), // 28800 seconds (8 hours)
      },
      environmentVariables: {
        AGENT_OBSERVABILITY_ENABLED: "true",
        NOVA_SONIC_MODEL_ID: "amazon.nova-2-sonic-v1:0",
        AWS_REGION: this.region,
        STACK_NAME: projectName,
        STACK_ENVIRONMENT: environment,
        // Cognito configuration for JWT validation and Identity Pool credentials
        COGNITO_USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_APP_CLIENT_ID: props.userPoolClient.userPoolClientId,
        COGNITO_IDENTITY_POOL_ID: props.identityPoolId,
        // CORS configuration - CloudFront origin
        ALLOWED_ORIGINS: `https://${props.cloudFrontDomain}`,
        // S3 data bucket for video frame uploads
        DATA_BUCKET_NAME: props.dataBucket.bucketName,
        ...(props.memoryId ? { AGENTCORE_MEMORY_ID: props.memoryId } : {}),
      },
    });

    // Grant AgentCore Runtime S3 access for video frame uploads
    props.dataBucket.grantReadWrite(agentCoreRole);

    // Grant AgentCore role permission to pull from the ARM build ECR repository
    armBuild.repository.grantPull(agentCoreRole);

    // Ensure runtime is created after the ARM build completes
    this.agentRuntime.node.addDependency(armBuild);

    // Compute runtime endpoint from ARN within this stack (avoids cross-stack export)
    // ARN format: arn:aws:bedrock-agentcore:region:account:runtime/runtime-id
    // Endpoint format: https://bedrock-agentcore.<region>.amazonaws.com/runtimes/<runtime-arn>
    // Reference: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-websocket.html
    this.agentRuntimeEndpoint = Fn.join("", [
      "https://bedrock-agentcore.",
      this.region,
      ".amazonaws.com/runtimes/",
      this.agentRuntime.agentRuntimeArn,
    ]);

    // Store ARN as a string property to avoid cross-stack CloudFormation exports
    this.agentRuntimeArn = this.agentRuntime.agentRuntimeArn;

    // Outputs
    new CfnOutput(this, "AgentRuntimeArn", {
      value: this.agentRuntimeArn,
      description: "AgentCore Runtime ARN",
    });

    new CfnOutput(this, "AgentRuntimeEndpoint", {
      value: this.agentRuntimeEndpoint,
      description: "AgentCore Runtime HTTPS endpoint",
    });
  }
}
