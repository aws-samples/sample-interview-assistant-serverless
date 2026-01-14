// @export {"deleteFile": true}

import { StackProps, Duration } from "aws-cdk-lib";
import { ReadWriteType, Trail } from "aws-cdk-lib/aws-cloudtrail";
import {
  BuildSpec,
  ComputeType,
  LinuxBuildImage,
} from "aws-cdk-lib/aws-codebuild";
import { Artifact } from "aws-cdk-lib/aws-codepipeline";
import {
  S3SourceAction,
  S3Trigger,
} from "aws-cdk-lib/aws-codepipeline-actions";
import {
  ArnPrincipal,
  CfnRole,
  Effect,
  PolicyDocument,
  PolicyStatement,
} from "aws-cdk-lib/aws-iam";
import {
  CodeBuildStep,
  CodePipeline,
  CodePipelineSource,
  ManualApprovalStep,
} from "aws-cdk-lib/pipelines";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";
import { CommonBucket } from "../common/constructs/s3";
import { CommonStack } from "../common/constructs/stack";
import { ApplicationStage } from "../stage";

export class Pipeline extends CommonStack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const projectId = this.node.getContext("projectId");
    const accounts = this.node.getContext("accounts");

    const sourceBucket = new CommonBucket(this, "sourceBucket", {
      bucketName: `${projectId}-source-bucket-${this.account}-${this.region}`,
      serverAccessLogsBucket: new CommonBucket(this, "loggingBucket", {
        lifecycleRules: [
          {
            enabled: true,
            expiration: Duration.days(30),
          },
        ],
      }),
      versioned: true, // requirement for triggering pipeline
    });

    const objectKey: string = "deploy.zip";
    // this is the file name Gitlab-CI will bundle the repo to in AWS S3

    new Trail(this, "trail").addS3EventSelector(
      [
        {
          bucket: sourceBucket,
          objectPrefix: objectKey,
        },
      ],
      {
        readWriteType: ReadWriteType.WRITE_ONLY,
      },
    );

    // https://gitlab.pages.aws.dev/docs/Platform/aws-credential-vendor.html#template-trust-policy
    new CfnRole(this, "gitlabRunnerRole", {
      roleName: `${projectId}-gitlab-runner-role`,
      assumeRolePolicyDocument: new PolicyDocument({
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["sts:AssumeRole", "sts:TagSession"],
            principals: [
              new ArnPrincipal(
                "arn:aws:iam::979517299116:role/gitlab-runners-prod",
              ),
            ], // must be the central Gitlab runner account
            conditions: {
              StringEquals: {
                "aws:PrincipalTag/GitLab:Group": [
                  this.node.getContext("gitlab").group,
                ],
                "aws:PrincipalTag/GitLab:Project": [
                  this.node.getContext("gitlab").project,
                ],
              },
            },
          }),
        ],
      }),
      policies: [
        {
          policyName: "sourceBucketReadWritePolicy",
          policyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: ["s3:ListBucket"],
                Resource: [`${sourceBucket.bucketArn}`],
              },
              {
                Effect: "Allow",
                Action: ["s3:PutObject", "s3:PutObjectAcl"],
                Resource: [`${sourceBucket.bucketArn}/*`],
              },
            ],
          },
        },
      ],
    });

    const pipeline = new CodePipeline(this, "pipeline", {
      selfMutation: true,
      dockerEnabledForSynth: true,
      crossAccountKeys: true,
      codeBuildDefaults: {
        buildEnvironment: {
          buildImage: LinuxBuildImage.STANDARD_7_0,
          computeType: ComputeType.LARGE,
          privileged: true, // for docker in docker
        },
        partialBuildSpec: BuildSpec.fromObject({
          phases: {
            install: {
              "runtime-versions": {
                nodejs: 22,
              },
            },
          },
        }),
      },
      synth: new CodeBuildStep("synth", {
        input: CodePipelineSource.s3(sourceBucket, objectKey, {
          trigger: S3Trigger.EVENTS,
          actionName: new S3SourceAction({
            actionName: "S3Source",
            bucket: sourceBucket,
            bucketKey: objectKey,
            output: new Artifact(),
            trigger: S3Trigger.EVENTS,
          }).actionProperties.actionName,
        }),
        installCommands: ["npm install"],
        commands: ["npm run cdk synth"],
        primaryOutputDirectory: "./cdk.out",
      }),
    });

    pipeline.addStage(
      new ApplicationStage(this, "dev", {
        env: {
          account: accounts["dev"].number,
          region: accounts["dev"].region,
        },
      }),
    );

    const prodAccount = accounts["prod"];
    if (prodAccount) {
      pipeline.addStage(
        new ApplicationStage(this, "prod", {
          env: {
            account: prodAccount.number,
            region: prodAccount.region,
          },
        }),
        {
          pre: [
            new ManualApprovalStep("prodApprovalStep", {
              comment: "Approve changes to prod.",
            }),
          ],
        },
      );
    }

    // CDK Nag Suppressions for Pipeline Stack
    // These suppressions are justified for CI/CD pipeline resources

    // Suppress stack-level violations
    NagSuppressions.addStackSuppressions(this, [
      {
        id: "AwsSolutions-S1",
        reason:
          "CloudTrail S3 bucket and Pipeline artifacts bucket do not require server access logs. These are internal CI/CD resources with CloudTrail monitoring already enabled.",
      },
      {
        id: "AwsSolutions-KMS5",
        reason:
          "Pipeline artifacts KMS key does not require automatic rotation. Key is managed by CDK Pipelines and rotated manually during infrastructure updates.",
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "Pipeline IAM roles require wildcard permissions for KMS (kms:GenerateDataKey*, kms:ReEncrypt*) and CodeBuild (log-group:*, report-group:*) to operate across dynamically created pipeline artifacts and build projects. These are standard CDK Pipelines permissions and are scoped to specific resource patterns. S3 permissions for the source bucket have been scoped to specific actions (s3:ListBucket, s3:PutObject, s3:PutObjectAcl).",
        appliesTo: [
          "Action::s3:GetObject*",
          "Action::s3:GetBucket*",
          "Action::s3:Abort*",
          "Action::s3:DeleteObject*",
          "Action::kms:GenerateDataKey*",
          "Action::kms:ReEncrypt*",
          "Resource::*",
          "Resource::<pipelinePipelineArtifactsBucketC2CD5B5E.Arn>/*",
          "Resource::arn:aws:logs:*:*:log-group:/aws/codebuild/*",
          "Resource::arn:aws:codebuild:*:*:report-group/*",
          "Resource::arn:*:iam::*:role/*",
          {
            regex: "/^Resource::arn:\\*:iam::[0-9]+:role/\\*$/",
          },
          {
            regex:
              "/^Resource::arn:aws:logs:.*:log-group:/aws/codebuild/.*:\\*$/",
          },
          {
            regex: "/^Resource::arn:aws:logs:.*:log-group:/aws/codebuild/\\*$/",
          },
          {
            regex: "/^Resource::arn:aws:codebuild:.*:report-group/.*-\\*$/",
          },
          {
            regex: "/^Resource::arn:aws:codebuild:.*:report-group/\\*$/",
          },
        ],
      },
    ]);
  }
}
