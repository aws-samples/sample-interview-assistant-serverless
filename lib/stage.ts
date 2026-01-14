import { Aspects, Stage, StageProps } from "aws-cdk-lib";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { LogsRetentionAspect } from "./common/aspects";
import { Backend } from "./stacks/backend";
import { FrontendDeployment } from "./stacks/frontend";

export class ApplicationStage extends Stage {
  constructor(scope: Construct, id: string, props?: StageProps) {
    super(scope, id, props);

    const backend = new Backend(this, "backend", {
      region: String(props?.env?.region || ""),
      stage: String(id),
      projectId: String(this.node.tryGetContext("projectId") || ""),
    });

    // print all backend environment variables
    console.log(
      "📋 Backend environment variables:",
      backend.environmentVariables,
    );

    // this stack must be named frontendDeployment
    const frontend = new FrontendDeployment(this, "frontendDeployment", {
      websiteBucket: backend.websiteBucket,
      distribution: backend.distribution,
      environmentVariables: backend.environmentVariables,
    });
    // Ensure frontend deployment waits for CloudFront integration to complete
    frontend.node.addDependency(backend.cloudfrontIntegration);

    Aspects.of(this).add(new LogsRetentionAspect(RetentionDays.THREE_MONTHS));

    NagSuppressions.addResourceSuppressions(
      this,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "Lambda functions require the AWSLambdaBasicExecutionRole to write logs to CloudWatch.",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
          ],
        },
        {
          id: "AwsSolutions-IAM5",
          reason:
            "High-level constructs require wildcards for dynamic resource creation and management.",
        },
        {
          id: "AwsSolutions-L1",
          reason: "High-level constructs set their own runtimes.",
        },
      ],
      true,
    );
    Aspects.of(this).add(new AwsSolutionsChecks());
  }
}
