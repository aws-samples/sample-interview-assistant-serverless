import { StackProps, Tags, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import { CommonStack } from "../../../common/constructs/stack";
import * as iam from "aws-cdk-lib/aws-iam";
import * as bedrockagentcore from "aws-cdk-lib/aws-bedrockagentcore";
import * as ssm from "aws-cdk-lib/aws-ssm";

interface AgentCoreMemoryProps extends StackProps {
  region: string;
  stage: string;
  projectId: string;
}

export class AgentCoreMemoryStack extends CommonStack {
  public readonly memoryId: string;

  constructor(scope: Construct, id: string, props: AgentCoreMemoryProps) {
    super(scope, id, props);

    // Define resource prefix based on project ID
    const resourcePrefix = props.projectId.toString();
    const environment = props.stage.toString();

    // Add stage tag to all resources in this stack
    Tags.of(this).add("Stage", environment);

    // ========================================================================
    // Step 1: Create IAM Execution Role for AgentCore Memory
    // ========================================================================

    const memoryExecutionRole = new iam.Role(
      this,
      "AgentCoreMemoryExecutionRole",
      {
        roleName: `${resourcePrefix}-AgentCoreMemory-ExecutionRole-${environment}`,
        assumedBy: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com"),
        description:
          "Execution role for AgentCore Memory to invoke Claude models for extraction and consolidation",
      },
    );

    // ========================================================================
    // Step 2: Grant Bedrock Model Invocation to Execution Role
    // ========================================================================

    // Allow memory execution role to invoke all Bedrock models for extraction/consolidation
    memoryExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ],
        resources: [
          // Global foundation models (no region/account)
          `arn:aws:bedrock:::foundation-model/anthropic.claude-*`,
          `arn:aws:bedrock:::foundation-model/amazon.nova-*`,
          `arn:aws:bedrock:::foundation-model/amazon.titan-*`,
          // Regional models
          `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-*`,
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-*`,
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-*`,
          // Cross-region inference profiles (required for us.anthropic.claude-* model IDs)
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`,
        ],
      }),
    );

    // ========================================================================
    // Step 3: Create AgentCore Memory with User Preference Strategy
    // ========================================================================

    const memory = new bedrockagentcore.CfnMemory(this, "AgentCoreMemory", {
      name: `${resourcePrefix}communicationstyle${environment}`
        .replace(/-/g, "")
        .toLowerCase(),
      description:
        "AgentCore Memory for learning user communication styles and preferences during interview practice sessions",
      eventExpiryDuration: 90, // Keep raw events for 90 days
      memoryExecutionRoleArn: memoryExecutionRole.roleArn,
      memoryStrategies: [
        {
          customMemoryStrategy: {
            name: "communicationstyleextract",
            description:
              "Extract user communication style and preferences with custom prompts",
            namespaces: ["/users/{actorId}/communicationstyle"],
            configuration: {
              userPreferenceOverride: {
                extraction: {
                  modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
                  appendToPrompt: `
# Communication Style Extraction

Analyze the conversation to extract the user's communication preferences and patterns:

## Focus Areas:
1. **Response Style**: Does the user tend to provide concise answers or detailed explanations?
2. **Feedback Preferences**: How does the user respond to direct vs. gentle criticism?
3. **Tone Preference**: Does the user tend to be more Formal vs. casual, encouraging vs. professional?
4. **Pacing**: Does the user need more time to answer or is responding rather quickly?
5. **Anxiety Triggers**: What situations cause stress or uncertainty to the user?
6. **Strengths**: Communication patterns that work well for this user

## Output Format:
Extract specific preferences as key-value pairs that can guide future interactions.`,
                },
                consolidation: {
                  modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
                  appendToPrompt: `
# Consolidate Communication Preferences

Merge new observations with existing preferences:

## Rules:
1. Keep the most recent preference if contradictory
2. Identify evolving patterns (e.g. confidence increasing over time)
3. Prioritize consistent patterns over one-time behaviors
4. Categorize by: tone, detail_level, feedback_style, pacing, anxiety_management

## Goal:
Build a comprehensive profile that enables personalized, effective coaching.`,
                },
              },
            },
          },
        },
      ],
    });

    // Explicitly ensure the IAM role policy is created before the Memory resource
    memory.node.addDependency(memoryExecutionRole);

    // Store references (use getAtt for CloudFormation attributes)
    this.memoryId = memory.ref; // .ref returns the memory ID

    // ========================================================================
    // Step 4: CloudFormation Outputs
    // ========================================================================

    new CfnOutput(this, "AgentCoreMemoryId", {
      value: this.memoryId,
      description: "ID of the AgentCore Memory with User Preference Strategy",
      exportName: `${resourcePrefix}-${environment}-ac-memory-id`,
    });

    new CfnOutput(this, "AgentCoreMemoryName", {
      value: memory.name || "",
      description: "Name of the AgentCore Memory",
      exportName: `${resourcePrefix}-${environment}-ac-memory-name`,
    });
  }
}
