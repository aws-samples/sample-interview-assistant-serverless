// @export {"deleteFile": true}

import { RemovalPolicy, SecretValue, Stage, Names } from "aws-cdk-lib";
import {
  OAuthScope,
  OidcAttributeRequestMethod,
  ProviderAttribute,
  StringAttribute,
  UserPool,
  UserPoolClient,
  UserPoolClientIdentityProvider,
  UserPoolClientProps,
  UserPoolDomain,
  UserPoolIdentityProviderOidc,
  UserPoolProps,
} from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";

function getProfile(scope: Construct) {
  return `${Stage.of(scope)!.stageName}-${scope.node.getContext("projectId")}`;
}

function getCognitoDomainPrefix(scope: Construct): string {
  const stage = Stage.of(scope)!.stageName.toLowerCase();
  const projectId = scope.node.getContext("projectId").toLowerCase();
  const midway = scope.node.tryGetContext("midway");

  // If midway is enabled, use the original format
  if (midway) {
    return `${stage}-${projectId}`;
  }

  // For direct auth (no midway), add a unique suffix to ensure uniqueness
  // Use the first 8 characters of the unique ID (hash of the construct path)
  const uniqueId = Names.uniqueId(scope).toLowerCase().slice(0, 8);

  return `${stage}-${projectId}-${uniqueId}`;
}

export class FederateUserPool extends UserPool {
  public readonly userPoolDomain?: UserPoolDomain;
  constructor(scope: Construct, id: string, props: UserPoolProps) {
    super(scope, id, {
      ...props,
      removalPolicy: RemovalPolicy.DESTROY,
      customAttributes: scope.node.tryGetContext("midway")
        ? {
            posix: new StringAttribute({
              mutable: true,
            }),
            ldap: new StringAttribute({
              mutable: true,
            }),
          }
        : props.customAttributes,
    });

    // Only create a domain for OAuth/Midway authentication
    // Direct Cognito authentication doesn't need a domain
    const midway = scope.node.tryGetContext("midway");
    if (midway) {
      this.userPoolDomain = this.addDomain("userPoolDomain", {
        cognitoDomain: {
          domainPrefix: getCognitoDomainPrefix(scope),
        },
      });
    }
  }
}

export class FederateUserPoolClient extends UserPoolClient {
  constructor(scope: Construct, id: string, props: UserPoolClientProps) {
    const midway = scope.node.tryGetContext("midway");
    super(scope, id, {
      ...props,
      authFlows: midway
        ? {
            custom: true,
            userSrp: true,
          }
        : props.authFlows,
      oAuth: midway
        ? {
            flows: {
              authorizationCodeGrant: true,
              implicitCodeGrant: false,
            },
            scopes: [OAuthScope.OPENID, OAuthScope.PROFILE, OAuthScope.EMAIL],
            callbackUrls: props.oAuth?.callbackUrls,
            logoutUrls: props.oAuth?.logoutUrls,
          }
        : props.oAuth,
      supportedIdentityProviders: midway
        ? [
            UserPoolClientIdentityProvider.custom(
              new UserPoolIdentityProviderOidc(
                scope,
                "userPoolIdentityProvider",
                {
                  userPool: props.userPool,
                  name: "AmazonFederate",
                  attributeMapping: {
                    email: ProviderAttribute.other("EMAIL"),
                    custom: {
                      "custom:posix": ProviderAttribute.other("POSIX_GROUPS"),
                    },
                  },
                  clientId: scope.node.getContext("projectId"),
                  clientSecret: SecretValue.secretsManager(
                    `${getProfile(scope)}-federateSecret`,
                  ).unsafeUnwrap(),
                  attributeRequestMethod: OidcAttributeRequestMethod.GET,
                  issuerUrl:
                    Stage.of(scope)!.stageName === "prod"
                      ? "https://idp.federate.amazon.com"
                      : "https://idp-integ.federate.amazon.com",
                },
              ).providerName,
            ),
          ]
        : props.supportedIdentityProviders,
    });
  }
}
