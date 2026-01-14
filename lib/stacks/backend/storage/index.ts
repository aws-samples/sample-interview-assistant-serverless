import { CfnOutput, Duration, RemovalPolicy, StackProps } from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { CloudfrontWebAcl } from "@aws/pdk/static-website";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import {
  AllowedMethods,
  Distribution,
  OriginRequestPolicy,
  SecurityPolicyProtocol,
  SSLMethod,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";

import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { CommonStack } from "../../../common/constructs/stack";
import { CommonBucket } from "../../../common/constructs/s3";

export class StorageStack extends CommonStack {
  public readonly websiteBucket: s3.Bucket;
  public readonly dataBucket: s3.Bucket;
  public readonly loggingBucket: s3.Bucket;
  public readonly tables: { [key: string]: dynamodb.Table } = {};
  public readonly distribution: Distribution;
  public readonly urls: string[];

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // Create logging bucket using CommonBucket with 30-day lifecycle policy
    this.loggingBucket = new CommonBucket(this, "loggingBucket", {
      lifecycleRules: [
        {
          enabled: true,
          expiration: Duration.days(30),
        },
      ],
    });

    this.loggingBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [
          new iam.ServicePrincipal(
            "logdelivery.elasticloadbalancing.amazonaws.com",
          ),
        ],
        actions: ["s3:PutObject"],
        resources: [
          `${this.loggingBucket.bucketArn}/AWSLogs/${this.account}/*`,
        ],
        conditions: {
          StringEquals: {
            "s3:x-amz-acl": "bucket-owner-full-control",
          },
        },
      }),
    );

    // Create website bucket using CommonBucket
    const websiteBucket = new CommonBucket(this, "websiteBucket", {
      serverAccessLogsBucket: this.loggingBucket,
    });

    const cloudfrontWebAcl = new CloudfrontWebAcl(this, "CloudfrontWebAcl", {
      managedRules: [
        // Remove AWSManagedRulesCommonRuleSet as it blocks file uploads
        // Keep IP reputation and bot control for security
        {
          vendor: "AWS",
          name: "AWSManagedRulesAmazonIpReputationList",
        },
        {
          vendor: "AWS",
          name: "AWSManagedRulesBotControlRuleSet",
        },
      ],
    });

    // Create CloudFront distribution
    const distribution = new Distribution(this, "distribution", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(websiteBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_ALL,
        originRequestPolicy: OriginRequestPolicy.CORS_S3_ORIGIN,
      },
      errorResponses: [
        {
          httpStatus: 404,
          responsePagePath: "/index.html",
          responseHttpStatus: 200,
        },
        {
          httpStatus: 403,
          responsePagePath: "/index.html",
          responseHttpStatus: 200,
        },
      ],
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      sslSupportMethod: SSLMethod.SNI,
      webAclId: cloudfrontWebAcl.webAclArn,
      logBucket: this.loggingBucket,
      logIncludesCookies: true,
      logFilePrefix: "distribution",
    });

    NagSuppressions.addResourceSuppressions(distribution, [
      {
        id: "AwsSolutions-CFR1",
        reason: "Distribution should be globally accessible.",
      },
      {
        id: "AwsSolutions-CFR4",
        reason: "Distribution is configured with TLS_V1_2_2021.",
      },
    ]);

    // Create data bucket with 30-day lifecycle policy
    this.dataBucket = new CommonBucket(this, "dataBucket", {
      serverAccessLogsBucket: this.loggingBucket,
      lifecycleRules: [
        {
          enabled: true,
          expiration: Duration.days(30),
        },
      ],
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.POST,
            s3.HttpMethods.PUT,
            s3.HttpMethods.HEAD,
            s3.HttpMethods.DELETE,
          ],
          allowedOrigins: [
            `https://${distribution.distributionDomainName}`,
            "http://localhost:3000",
            "http://localhost:3001",
          ],
          allowedHeaders: ["*"],
          exposedHeaders: [
            "x-amz-server-side-encryption",
            "x-amz-request-id",
            "x-amz-id-2",
            "ETag",
          ],
          maxAge: 3000,
        },
      ],
    });

    // Assign public properties
    this.websiteBucket = websiteBucket;
    this.distribution = distribution;
    this.urls = [
      `https://${distribution.distributionDomainName}`,
      "http://localhost:3000",
    ];

    // Outputs
    new CfnOutput(this, `WebsiteBucketName`, {
      value: this.websiteBucket.bucketName,
    });

    new CfnOutput(this, `CloudFrontDistributionDomainName`, {
      value: this.distribution.distributionDomainName,
    });

    new CfnOutput(this, `DataBucketName`, {
      value: this.dataBucket.bucketName,
    });

    new CfnOutput(this, `LoggingBucketName`, {
      value: this.loggingBucket.bucketName,
      description: "The name of the S3 logging bucket",
    });

    // Create DynamoDB tables using CommonStack properties
    this.createDynamoDBTables(this.resourcePrefix, this.environmentName);
  }

  private createDynamoDBTables(resourcePrefix: string, environment: string) {
    const tableConfig = {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    };

    // this.tables['userRole'] = new dynamodb.Table(this, `${resourcePrefix}-UserRoleTable`, {
    //     tableName: `${resourcePrefix}-USERROLE-${environment}`,
    //     partitionKey: {
    //         name: 'userId',
    //         type: dynamodb.AttributeType.STRING
    //     },
    //     ...tableConfig,
    // });

    // this.tables['feedback'] = new dynamodb.Table(this, `${resourcePrefix}-FeedbackTable`, {
    //     tableName: `${resourcePrefix}-FEEDBACK-${environment}`,
    //     partitionKey: {
    //         name: 'messageId',
    //         type: dynamodb.AttributeType.STRING
    //     },
    //     ...tableConfig,
    // });

    // this.tables['documentUpload'] = new dynamodb.Table(this, `${resourcePrefix}-DocumentUploadTable`, {
    // tableName: `${resourcePrefix}-DOCUMENTUPLOAD-${environment || 'DEV'}`,
    // partitionKey: {
    //     name: 'documentId',
    //     type: dynamodb.AttributeType.STRING
    // },
    // ...tableConfig,
    // });

    this.tables["sessionPrep"] = new dynamodb.Table(
      this,
      `${resourcePrefix}-sessionPrepTable`,
      {
        tableName: `${resourcePrefix}-SESSION-PREP-${environment || "DEV"}`,
        partitionKey: {
          name: "userId",
          type: dynamodb.AttributeType.STRING,
        },
        sortKey: {
          name: "itemId",
          type: dynamodb.AttributeType.STRING,
        },
        ...tableConfig,
      },
    );

    // Add GSI for efficient category-based queries
    this.tables["sessionPrep"].addGlobalSecondaryIndex({
      indexName: "CategoryIndex",
      partitionKey: {
        name: "categoryId",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "createdAt",
        type: dynamodb.AttributeType.NUMBER,
      },
    });

    this.tables["sessionHistory"] = new dynamodb.Table(
      this,
      `${resourcePrefix}-SessionHistoryTable`,
      {
        tableName: `${resourcePrefix}-SESSION-HISTORY-${environment || "DEV"}`,
        partitionKey: {
          name: "userId",
          type: dynamodb.AttributeType.STRING,
        },
        sortKey: {
          name: "itemId",
          type: dynamodb.AttributeType.STRING,
        },
        ...tableConfig,
      },
    );

    // Add GSI for efficient category-based queries
    this.tables["sessionHistory"].addGlobalSecondaryIndex({
      indexName: "CategoryIndex",
      partitionKey: {
        name: "categoryId",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "createdAt",
        type: dynamodb.AttributeType.NUMBER,
      },
    });
  }
}
