import { App, Tags, Aspects } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
// @export {"deleteLines": 1}
import { Pipeline } from "../lib/stacks/pipeline";
import { ApplicationStage } from "../lib/stage";

const app = new App({});

const projectId = app.node.tryGetContext("projectId");
if (projectId) Tags.of(app).add("projectId", projectId);

const stage = app.node.tryGetContext("stage") || "dev";
const account = app.node.tryGetContext("accounts")?.[stage];
const properties = {
  env: {
    account: account?.number,
    region: account?.region,
    stage: stage,
    projectId: projectId,
  },
};

if (app.node.tryGetContext("pipeline") && stage === "dev") {
  // this stack must be named pipeline
  new Pipeline(app, "pipeline", properties);
} else {
  new ApplicationStage(app, stage, properties);
}

// Apply AWS Solutions CDK Nag checks to all stacks
// This validates all resources comply with AWS security best practices
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

app.synth();
