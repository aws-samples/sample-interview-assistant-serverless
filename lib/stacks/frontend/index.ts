import { CfnOutput, StackProps } from "aws-cdk-lib";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { ComputeType, LinuxArmBuildImage } from "aws-cdk-lib/aws-codebuild";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import * as path from "path";
import { CommonStack } from "../../common/constructs/stack";
import { StaticWebsiteBuild } from "../../common/constructs/static-website";

interface FrontendDeploymentProps extends StackProps {
  websiteBucket: Bucket;
  distribution: Distribution;
  environmentVariables: Record<string, string>;
}

export class FrontendDeployment extends CommonStack {
  constructor(scope: Construct, id: string, props: FrontendDeploymentProps) {
    super(scope, id, props);

    const { websiteBucket, distribution, environmentVariables } = props;

    new CfnOutput(this, "environmentVariables", {
      value: JSON.stringify(environmentVariables),
    });

    new StaticWebsiteBuild(this, "staticWebsiteBuild", {
      path: path.join(__dirname),
      exclude: ["node_modules", "dist", ".env", ".env.local", ".env.example"],
      destinationBucket: websiteBucket,
      distribution,
      buildImage: LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
      computeType: ComputeType.SMALL,
      environmentVariables: environmentVariables,
      runtimeVersions: {
        nodejs: "22",
      },
      installCommands: ["npm install"],
      commands: ["npm run build"],
      primaryOutputDirectory: "build",
    });
  }
}
