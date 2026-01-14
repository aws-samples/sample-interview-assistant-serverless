import {
  CfnOutput,
  RemovalPolicy,
  StackProps,
  CustomResource,
  Duration,
} from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3vectors from "aws-cdk-lib/aws-s3vectors";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as iam from "aws-cdk-lib/aws-iam";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import * as path from "path";
import { CommonStack } from "../../../common/constructs/stack";

interface KnowledgeBaseStackProps extends StackProps {
  dataBucket: s3.Bucket;
}

export class KnowledgeBaseStack extends CommonStack {
  public readonly knowledgeBase: bedrock.CfnKnowledgeBase;
  public readonly dataSource: bedrock.CfnDataSource;
  public readonly vectorBucket: s3.IBucket;

  constructor(scope: Construct, id: string, props: KnowledgeBaseStackProps) {
    super(scope, id, props);

    const resourcePrefix = this.resourcePrefix;
    const dataBucket = props.dataBucket;

    // Deploy source document(s) to S3 (interview questions)
    const sourceDataDeployment = new s3deploy.BucketDeployment(
      this,
      `${resourcePrefix}-SourceDataDeployment`,
      {
        sources: [
          s3deploy.Source.asset(path.join(__dirname, "../knowledge-base-data")),
        ],
        destinationBucket: dataBucket,
        destinationKeyPrefix: "app",
        prune: false,
      },
    );

    // Create S3 Vector bucket using native AWS CDK S3Vectors
    // Note: bucket name changed to force CloudFormation to create new bucket
    const vectorBucket = new s3vectors.CfnVectorBucket(
      this,
      `${resourcePrefix}-VectorBucket`,
      {
        vectorBucketName: `${resourcePrefix}-vectors-${this.account}`,
      },
    );

    // Suppress CDK Nag rule for S3 Vector bucket (managed by Bedrock)
    NagSuppressions.addResourceSuppressions(vectorBucket, [
      {
        id: "AwsSolutions-S1",
        reason:
          "S3 Vector bucket is managed by Amazon Bedrock service for vector storage only. Server access logs not required for this use case.",
      },
    ]);

    // Store bucket ARN for later use
    this.vectorBucket = s3.Bucket.fromBucketArn(
      this,
      `${resourcePrefix}-VectorBucketRef`,
      vectorBucket.attrVectorBucketArn,
    );

    // Create Vector Index using native AWS CDK S3Vectors
    const vectorIndex = new s3vectors.CfnIndex(
      this,
      `${resourcePrefix}-VectorIndex`,
      {
        vectorBucketName: vectorBucket.vectorBucketName!,
        indexName: `${resourcePrefix}-idx`, // Short name (max 63 chars)
        dataType: "float32",
        dimension: 1024, // For Titan Embed Text v2
        distanceMetric: "euclidean",
        // Mark Bedrock internal metadata groups as non-filterable to prevent exceeding 2KB filterable metadata limit
        // AMAZON_BEDROCK_TEXT and AMAZON_BEDROCK_METADATA are special grouping keys used by Bedrock
        // This keeps only custom metadata fields (category, difficulty) as filterable
        metadataConfiguration: {
          nonFilterableMetadataKeys: [
            "AMAZON_BEDROCK_TEXT",
            "AMAZON_BEDROCK_METADATA",
          ],
        },
      },
    );

    // Add dependency to ensure vector bucket is created before index
    vectorIndex.node.addDependency(vectorBucket);

    // Create Bedrock Knowledge Base role
    const bedrockKnowledgeBaseRole = this.createBedrockRole(
      resourcePrefix,
      dataBucket,
      vectorBucket.vectorBucketName!,
    );

    // Create Bedrock Knowledge Base with S3 Vectors (Bedrock will auto-create the vector index)
    this.knowledgeBase = new bedrock.CfnKnowledgeBase(
      this,
      `${resourcePrefix}-KnowledgeBase`,
      {
        name: `${resourcePrefix}-kb`,
        description: `Knowledge base for ${resourcePrefix}`,
        roleArn: bedrockKnowledgeBaseRole.roleArn,
        knowledgeBaseConfiguration: {
          type: "VECTOR",
          vectorKnowledgeBaseConfiguration: {
            embeddingModelArn: `arn:${this.partition}:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
            embeddingModelConfiguration: {
              bedrockEmbeddingModelConfiguration: {
                dimensions: 1024,
                embeddingDataType: "FLOAT32",
              },
            },
          },
        },
        storageConfiguration: {
          type: "S3_VECTORS",
          s3VectorsConfiguration: {
            vectorBucketArn: this.vectorBucket.bucketArn,
            indexName: `${resourcePrefix}-idx`,
          },
        },
      },
    );

    // Add dependencies to ensure vector index and IAM role are created before Knowledge Base
    this.knowledgeBase.node.addDependency(vectorIndex);
    this.knowledgeBase.node.addDependency(bedrockKnowledgeBaseRole);

    // Create Bedrock Data Source
    this.dataSource = new bedrock.CfnDataSource(
      this,
      `${resourcePrefix}-DataSource`,
      {
        knowledgeBaseId: this.knowledgeBase.ref,
        dataDeletionPolicy: "RETAIN",
        name: `${resourcePrefix}-datasource`,
        dataSourceConfiguration: {
          type: "S3",
          s3Configuration: {
            bucketArn: dataBucket.bucketArn,
            inclusionPrefixes: [`app/`],
          },
        },
        vectorIngestionConfiguration: {
          chunkingConfiguration: {
            chunkingStrategy: "NONE",
          },
        },
      },
    );

    this.dataSource.node.addDependency(sourceDataDeployment);

    // Trigger sync job to populate the vector index
    this.createSyncTrigger(resourcePrefix);

    // Outputs
    new CfnOutput(this, `KnowledgeBaseId`, {
      value: this.knowledgeBase.ref,
      description: "The ID of the Bedrock Knowledge Base",
      exportName: `${resourcePrefix}-KnowledgeBaseId`,
    });
  }

  private createBedrockRole(
    resourcePrefix: string,
    dataBucket: s3.Bucket,
    vectorBucketName: string,
  ) {
    const bedrockKnowledgeBaseRole = new iam.Role(
      this,
      `${resourcePrefix}-BedrockKnowledgeBaseRole`,
      {
        roleName: `AmazonBedrockExecutionRoleForKnowledgeBase-${resourcePrefix}`,
        assumedBy: new iam.ServicePrincipal("bedrock.amazonaws.com"),
        path: "/",
      },
    );

    const cfnBedrockRole = bedrockKnowledgeBaseRole.node
      .defaultChild as iam.CfnRole;
    cfnBedrockRole.addPropertyOverride(
      "AssumeRolePolicyDocument.Statement.0.Condition",
      {
        StringEquals: {
          "aws:SourceAccount": this.account,
        },
        ArnLike: {
          "AWS:SourceArn": `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`,
        },
      },
    );

    // S3 permissions for Bedrock Knowledge Base data source (scoped per AWS documentation)
    // Reference: https://docs.aws.amazon.com/bedrock/latest/userguide/kb-permissions.html#kb-permissions-access-s3
    bedrockKnowledgeBaseRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "s3:ListBucket", // Required to list objects in the bucket
          "s3:GetObject", // Required to read objects for ingestion
        ],
        resources: [dataBucket.bucketArn, `${dataBucket.bucketArn}/*`],
      }),
    );

    bedrockKnowledgeBaseRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
        ],
        resources: [
          this.vectorBucket.bucketArn,
          `${this.vectorBucket.bucketArn}/*`,
        ],
      }),
    );

    // Add S3Vectors permissions for Bedrock to query and manage vectors
    bedrockKnowledgeBaseRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3vectors:*"],
        resources: [
          `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}`,
          `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}/*`,
          `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}/index/*`,
        ],
      }),
    );

    bedrockKnowledgeBaseRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:ListCustomModels"],
        resources: ["*"],
      }),
    );

    bedrockKnowledgeBaseRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel"],
        resources: [`arn:aws:bedrock:${this.region}::foundation-model/*`],
      }),
    );

    return bedrockKnowledgeBaseRole;
  }

  private createSyncTrigger(resourcePrefix: string) {
    const triggerSyncRole = new iam.Role(
      this,
      `${resourcePrefix}-TriggerSyncRole`,
      {
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        description: "IAM role for the trigger sync Lambda function",
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AWSLambdaBasicExecutionRole",
          ),
        ],
      },
    );

    triggerSyncRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock:StartIngestionJob",
          "bedrock:GetIngestionJob",
          "bedrock:ListIngestionJobs",
        ],
        resources: [
          `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`,
        ],
      }),
    );

    const triggerSyncFunction = new lambda.Function(
      this,
      `${resourcePrefix}-TriggerSyncFunction`,
      {
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "index.handler",
        role: triggerSyncRole,
        timeout: Duration.seconds(240),
        code: lambda.Code.fromInline(`
import boto3
import cfnresponse
import os

def handler(event, context):
    try:
        if event['RequestType'] == 'Delete':
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
            return

        knowledge_base_id = event['ResourceProperties']['KnowledgeBaseId']
        data_source_id = event['ResourceProperties']['DataSourceId']
        region = os.environ['AWS_REGION']

        # Extract just the data source ID from the composite ID
        data_source_id = data_source_id.replace(knowledge_base_id, '').replace('|', '')

        print(f"Starting sync job for knowledge base {knowledge_base_id}, data source {data_source_id}")

        bedrock_agent = boto3.client('bedrock-agent', region_name=region)

        response = bedrock_agent.start_ingestion_job(
            knowledgeBaseId=knowledge_base_id,
            dataSourceId=data_source_id
        )
        print(f"Start Sync Job Response: {response}")

        ingestion_job_id = response['ingestionJob']['ingestionJobId']
        print(f"Ingestion job started with ID: {ingestion_job_id}")

        cfnresponse.send(event, context, cfnresponse.SUCCESS, {
            'IngestionJobId': ingestion_job_id
        })
    except Exception as e:
        print(f"Error: {str(e)}")
        cfnresponse.send(event, context, cfnresponse.FAILED, {
            'Error': str(e)
        })
`),
      },
    );

    const syncTrigger = new CustomResource(
      this,
      `${resourcePrefix}-SyncTrigger`,
      {
        serviceToken: triggerSyncFunction.functionArn,
        properties: {
          KnowledgeBaseId: this.knowledgeBase.ref,
          DataSourceId: this.dataSource.ref,
        },
      },
    );

    syncTrigger.node.addDependency(this.dataSource);
  }
}
