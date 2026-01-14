import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";

export class CommonStack extends Stack {
  private readonly _projectId: string;

  constructor(scope: Construct, id: string, props?: StackProps) {
    // Get projectId from context
    const prefix = scope.node.tryGetContext("projectId");
    let prefixedId = id;

    // // Only add prefix if this is a top-level stack directly under Stage
    // // For any nested stacks, we don't want to add the prefix again
    const isTopLevelStack =
      scope.constructor.name === "App" ||
      scope.constructor.name === "ApplicationStage";

    if (prefix && isTopLevelStack) {
      prefixedId = `${prefix}-${id}`;
    }

    // For paths to be used in CloudFormation, don't include the project ID again if it's already in the path
    super(scope, prefixedId, {
      ...props,
      description: `demo-${prefixedId}`,
    });

    // Store projectId for use as resourcePrefix (for naming AWS resources)
    this._projectId = prefix || "";
  }

  /**
   * Get the project ID to use as resource prefix
   */
  public get resourcePrefix(): string {
    return this._projectId;
  }

  /**
   * Get the environment name (dev, test, prod, etc.)
   */
  public get environmentName(): string {
    return this.node.tryGetContext("stage") || "dev";
  }
}
