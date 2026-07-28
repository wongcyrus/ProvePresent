import { Construct } from 'constructs';
import { Fn, TerraformOutput, TerraformStack } from 'cdktf';
import { ApplicationInsights } from '@cdktf/provider-azurerm/lib/application-insights';
import { AzurermProvider } from '@cdktf/provider-azurerm/lib/provider';
import { DataAzurermClientConfig } from '@cdktf/provider-azurerm/lib/data-azurerm-client-config';
import { LinuxFunctionApp } from '@cdktf/provider-azurerm/lib/linux-function-app';
import { LogAnalyticsWorkspace } from '@cdktf/provider-azurerm/lib/log-analytics-workspace';
import { ResourceGroup } from '@cdktf/provider-azurerm/lib/resource-group';
import { ResourceGroupTemplateDeployment } from '@cdktf/provider-azurerm/lib/resource-group-template-deployment';
import { RoleAssignment } from '@cdktf/provider-azurerm/lib/role-assignment';
import { ServicePlan } from '@cdktf/provider-azurerm/lib/service-plan';
import { SignalrService } from '@cdktf/provider-azurerm/lib/signalr-service';
import { StorageAccount } from '@cdktf/provider-azurerm/lib/storage-account';
import { StorageContainer } from '@cdktf/provider-azurerm/lib/storage-container';
import { StorageTable } from '@cdktf/provider-azurerm/lib/storage-table';
import { EnvironmentConfig, tableNames } from './config';

const STORAGE_TABLE_DATA_CONTRIBUTOR_ROLE_ID = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3';
const SIGNALR_SERVICE_OWNER_ROLE_ID = '7e4f1700-ea5a-4f59-8f37-079cfe29dce3';
const COGNITIVE_SERVICES_OPENAI_USER_ROLE_ID = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd';
const AZURE_AI_USER_ROLE_ID = '53ca6127-db72-4b80-b1b0-d745d6d5456d';
const STORAGE_DNS_SUFFIX = 'core.windows.net';

export class ProvePresentStack extends TerraformStack {
  public constructor(scope: Construct, id: string, config: EnvironmentConfig) {
    super(scope, id);

    new AzurermProvider(this, 'azurerm', {
      features: [{}],
      subscriptionId: config.armSubscriptionId || undefined,
      tenantId: config.armTenantId || undefined,
      clientId: config.armClientId || undefined,
      clientSecret: config.armClientSecret || undefined
    });

    const current = new DataAzurermClientConfig(this, 'current');

    const openAiCustomSubdomain = `${resourceName('openai', config)}`;
    const storageAccountName = sanitizeStorageAccountName(`st${config.baseName}${config.environment}`);
    const signalrName = resourceName('signalr', config);
    const functionAppName = resourceName('func', config);
    const appServicePlanName = resourceName('asp', config);
    const appInsightsName = resourceName('appi', config);
    const openAiName = openAiCustomSubdomain;
    const foundryProjectName = `${openAiName}-project`;
    const projectEndpoint = `https://${openAiName}.services.ai.azure.com/api/projects/${foundryProjectName}`;
    const openAiEndpoint = `https://${openAiName}.cognitiveservices.azure.com/`;
    const openAiAccountId = `/subscriptions/${current.subscriptionId}/resourceGroups/${config.resourceGroupName}/providers/Microsoft.CognitiveServices/accounts/${openAiName}`;
    const foundryProjectId = `${openAiAccountId}/projects/${foundryProjectName}`;

    const resourceGroup = new ResourceGroup(this, 'resource-group', {
      name: config.resourceGroupName,
      location: config.location,
      tags: config.tags
    });

    const storage = new StorageAccount(this, 'storage-account', {
      name: storageAccountName,
      resourceGroupName: resourceGroup.name,
      location: resourceGroup.location,
      accountTier: 'Standard',
      accountReplicationType: 'LRS',
      accountKind: 'StorageV2',
      accessTier: 'Hot',
      allowNestedItemsToBePublic: true,
      sharedAccessKeyEnabled: true,
      httpsTrafficOnlyEnabled: true,
      minTlsVersion: 'TLS1_2',
      publicNetworkAccessEnabled: true,
      tags: config.tags,
      blobProperties: {
        deleteRetentionPolicy: {
          days: 7
        },
        corsRule: [
          {
            allowedHeaders: ['*'],
            allowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD', 'OPTIONS'],
            allowedOrigins: uniqueOrigins([
              ...config.blobCorsAllowedOrigins,
              'http://localhost:3000',
              'http://localhost:7071'
            ]),
            exposedHeaders: ['*'],
            maxAgeInSeconds: 3600
          }
        ]
      },
      networkRules: {
        defaultAction: 'Allow',
        bypass: ['AzureServices']
      }
    });

    for (const tableName of tableNames) {
      new StorageTable(this, `table-${tableName.toLowerCase()}`, {
        name: tableName,
        storageAccountName: storage.name
      });
    }

    new StorageContainer(this, 'quiz-slides-container', {
      name: 'quiz-slides',
      storageAccountName: storage.name,
      containerAccessType: 'private'
    });

    new StorageContainer(this, 'student-captures-container', {
      name: 'student-captures',
      storageAccountName: storage.name,
      containerAccessType: 'private'
    });

    const signalr = config.deploySignalR
      ? new SignalrService(this, 'signalr-service', {
          name: signalrName,
          resourceGroupName: resourceGroup.name,
          location: resourceGroup.location,
          sku: {
            name: config.signalrSkuName,
            capacity: config.signalrSkuCapacity
          },
          serviceMode: 'Serverless',
          publicNetworkAccessEnabled: true,
          cors: [
            {
              allowedOrigins: ['*']
            }
          ],
          connectivityLogsEnabled: true,
          messagingLogsEnabled: true,
          liveTraceEnabled: true,
          tags: config.tags
        })
      : undefined;

    const workspace = new LogAnalyticsWorkspace(this, 'log-analytics-workspace', {
      name: `${appInsightsName}-workspace`,
      location: resourceGroup.location,
      resourceGroupName: resourceGroup.name,
      sku: 'PerGB2018',
      retentionInDays: 30,
      dailyQuotaGb: 1,
      internetIngestionEnabled: true,
      internetQueryEnabled: true,
      tags: config.tags
    });

    const appInsights = new ApplicationInsights(this, 'application-insights', {
      name: appInsightsName,
      location: resourceGroup.location,
      resourceGroupName: resourceGroup.name,
      workspaceId: workspace.id,
      applicationType: 'web',
      internetIngestionEnabled: true,
      internetQueryEnabled: true,
      retentionInDays: 30,
      tags: config.tags
    });

    const openAiDeployment = config.deployAzureOpenAI
      ? new ResourceGroupTemplateDeployment(this, 'openai-deployment', {
          name: `openai-${config.environment}`,
          resourceGroupName: resourceGroup.name,
          deploymentMode: 'Incremental',
          tags: config.tags,
          parametersContent: JSON.stringify({
            openAIName: {
              value: openAiName
            },
            location: {
              value: config.location
            },
            projectName: {
              value: foundryProjectName
            },
            gpt54Capacity: {
              value: config.gpt54Capacity
            }
          }),
          templateContent: JSON.stringify(buildOpenAiTemplate())
        })
      : undefined;

    const foundryTracingConnection = openAiDeployment && config.enableFoundryTracingConnection
      ? new ResourceGroupTemplateDeployment(this, 'foundry-tracing-connection', {
          name: `foundry-tracing-${config.environment}`,
          resourceGroupName: resourceGroup.name,
          deploymentMode: 'Incremental',
          parametersContent: JSON.stringify({
            openAIName: {
              value: openAiName
            },
            projectName: {
              value: foundryProjectName
            },
            connectionName: {
              value: 'appinsights-tracing'
            },
            targetResourceId: {
              value: appInsights.id
            },
            targetResourceName: {
              value: appInsights.name
            },
            appInsightsInstrumentationKey: {
              value: appInsights.instrumentationKey
            }
          }),
          templateContent: JSON.stringify(buildFoundryTracingConnectionTemplate()),
          dependsOn: [openAiDeployment, appInsights]
        })
      : undefined;

    const servicePlan = new ServicePlan(this, 'function-service-plan', {
      name: appServicePlanName,
      resourceGroupName: resourceGroup.name,
      location: resourceGroup.location,
      osType: 'Linux',
      skuName: 'Y1',
      tags: config.tags
    });

    const functionAppSiteConfig = {
      alwaysOn: false,
      ftpsState: 'Disabled',
      http2Enabled: true,
      minimumTlsVersion: '1.2',
      applicationStack: {
        nodeVersion: '22'
      },
      appServiceLogs: {
        diskQuotaMb: 35,
        retentionPeriodDays: 7
      },
      ...(config.frontendUrls.length > 0
        ? {
            cors: {
              allowedOrigins: config.frontendUrls,
              supportCredentials: !config.frontendUrls.includes('*')
            }
          }
        : {})
    };

    const functionApp = new LinuxFunctionApp(this, 'function-app', {
      name: functionAppName,
      resourceGroupName: resourceGroup.name,
      location: resourceGroup.location,
      servicePlanId: servicePlan.id,
      storageAccountName: storage.name,
      storageAccountAccessKey: storage.primaryAccessKey,
      httpsOnly: true,
      builtinLoggingEnabled: false,
      functionsExtensionVersion: '~4',
      tags: config.tags,
      identity: {
        type: 'SystemAssigned'
      },
      siteConfig: functionAppSiteConfig,
      appSettings: {
        AzureWebJobsStorage: buildStorageConnectionString(storage.name, storage.primaryAccessKey),
        WEBSITE_CONTENTAZUREFILECONNECTIONSTRING: buildStorageConnectionString(storage.name, storage.primaryAccessKey),
        WEBSITE_CONTENTSHARE: functionAppName.toLowerCase(),
        FUNCTIONS_EXTENSION_VERSION: '~4',
        FUNCTIONS_WORKER_RUNTIME: 'node',
        FUNCTIONS_WORKER_RUNTIME_VERSION: '~4',
        WEBSITE_NODE_DEFAULT_VERSION: '~22',
        FUNCTIONS_NODE_BLOCK_ON_ENTRY_POINT_ERROR: 'true',
        WEBSITE_MOUNT_ENABLED: '1',
        SCM_DO_BUILD_DURING_DEPLOYMENT: 'false',
        ENABLE_ORYX_BUILD: 'false',
        APPLICATIONINSIGHTS_CONNECTION_STRING: appInsights.connectionString,
        STORAGE_ACCOUNT_NAME: storage.name,
        STORAGE_ACCOUNT_URI: `https://${storage.name}.table.${STORAGE_DNS_SUFFIX}/`,
        SIGNALR_CONNECTION_STRING: signalr ? signalr.primaryConnectionString : '',
        LATE_ROTATION_SECONDS: '60',
        EARLY_LEAVE_ROTATION_SECONDS: '60',
        CHAIN_TOKEN_TTL_SECONDS: '25',
        OWNER_TRANSFER: 'true',
        WIFI_SSID_ALLOWLIST: '',
        AZURE_AI_PROJECT_ENDPOINT: openAiDeployment ? projectEndpoint : '',
        QR_ENCRYPTION_KEY: Fn.sha256(`${config.resourceGroupName}/${functionAppName}/qr-encryption`),
        OTP_SMTP_HOST: config.otpSmtpHost,
        OTP_SMTP_PORT: config.otpSmtpPort,
        OTP_SMTP_SECURE: config.otpSmtpSecure,
        OTP_SMTP_USERNAME: config.otpSmtpUsername,
        OTP_SMTP_PASSWORD: config.otpSmtpPassword,
        OTP_FROM_EMAIL: config.otpFromEmail,
        OTP_FROM_NAME: config.otpFromName,
        OTP_EMAIL_SUBJECT: config.otpEmailSubject,
        OTP_APP_NAME: config.otpAppName,
        ALLOWED_EMAIL_DOMAINS: config.allowedEmailDomains,
        ORGANIZATION_NAME: config.organizationName,
        ORGANIZER_DOMAIN: config.organizerDomain,
        ATTENDEE_DOMAIN: config.attendeeDomain,
        JWT_SECRET: config.jwtSecret
      }
    });

    const staticWebAppBackendLink = config.enableStaticWebAppBackendLink
      ? new ResourceGroupTemplateDeployment(this, 'static-web-app-backend-link', {
          name: `static-web-app-link-${config.environment}`,
          resourceGroupName: resourceGroup.name,
          deploymentMode: 'Incremental',
          parametersContent: JSON.stringify({
            staticSiteName: {
              value: config.staticWebAppName
            },
            linkedBackendName: {
              value: config.staticWebAppLinkedBackendName
            },
            backendResourceId: {
              value: functionApp.id
            },
            backendRegion: {
              value: config.location
            }
          }),
          templateContent: JSON.stringify(buildStaticWebAppLinkedBackendTemplate()),
          dependsOn: [functionApp]
        })
      : undefined;

    new RoleAssignment(this, 'storage-role-assignment', {
      scope: storage.id,
      roleDefinitionId: subscriptionRoleId(current.subscriptionId, STORAGE_TABLE_DATA_CONTRIBUTOR_ROLE_ID),
      principalId: functionApp.identity.principalId,
      principalType: 'ServicePrincipal'
    });

    if (signalr) {
      new RoleAssignment(this, 'signalr-role-assignment', {
        scope: signalr.id,
        roleDefinitionId: subscriptionRoleId(current.subscriptionId, SIGNALR_SERVICE_OWNER_ROLE_ID),
        principalId: functionApp.identity.principalId,
        principalType: 'ServicePrincipal'
      });
    }

    if (openAiDeployment) {
      new RoleAssignment(this, 'openai-user-role-assignment', {
        scope: openAiAccountId,
        roleDefinitionId: subscriptionRoleId(current.subscriptionId, COGNITIVE_SERVICES_OPENAI_USER_ROLE_ID),
        principalId: functionApp.identity.principalId,
        principalType: 'ServicePrincipal'
      });

      new RoleAssignment(this, 'azure-ai-user-account-role-assignment', {
        scope: openAiAccountId,
        roleDefinitionId: subscriptionRoleId(current.subscriptionId, AZURE_AI_USER_ROLE_ID),
        principalId: functionApp.identity.principalId,
        principalType: 'ServicePrincipal'
      });

      new RoleAssignment(this, 'azure-ai-user-project-role-assignment', {
        scope: foundryProjectId,
        roleDefinitionId: subscriptionRoleId(current.subscriptionId, AZURE_AI_USER_ROLE_ID),
        principalId: functionApp.identity.principalId,
        principalType: 'ServicePrincipal'
      });
    }

    new TerraformOutput(this, 'resource_group_name', {
      value: resourceGroup.name
    });

    new TerraformOutput(this, 'storage_account_name', {
      value: storage.name
    });

    new TerraformOutput(this, 'function_app_name', {
      value: functionApp.name
    });

    new TerraformOutput(this, 'function_app_url', {
      value: `https://${functionApp.defaultHostname}`
    });

    new TerraformOutput(this, 'application_insights_name', {
      value: appInsights.name
    });

    new TerraformOutput(this, 'signalr_name', {
      value: signalr ? signalr.name : ''
    });

    new TerraformOutput(this, 'signalr_endpoint', {
      value: signalr ? signalr.hostname : ''
    });

    new TerraformOutput(this, 'openai_name', {
      value: openAiDeployment ? openAiName : ''
    });

    new TerraformOutput(this, 'openai_endpoint', {
      value: openAiDeployment ? openAiEndpoint : ''
    });

    new TerraformOutput(this, 'foundry_project_name', {
      value: openAiDeployment ? foundryProjectName : ''
    });

    new TerraformOutput(this, 'foundry_project_endpoint', {
      value: openAiDeployment ? projectEndpoint : ''
    });

    new TerraformOutput(this, 'gpt54_deployment_name', {
      value: openAiDeployment ? 'gpt-5.4' : ''
    });

    new TerraformOutput(this, 'static_web_app_backend_link_name', {
      value: staticWebAppBackendLink ? config.staticWebAppLinkedBackendName : ''
    });

    new TerraformOutput(this, 'foundry_tracing_connection_name', {
      value: foundryTracingConnection ? 'appinsights-tracing' : ''
    });
  }
}

function resourceName(prefix: string, config: EnvironmentConfig): string {
  return `${prefix}-${config.baseName}-${config.environment}`;
}

function sanitizeStorageAccountName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
}

function buildStorageConnectionString(accountName: string, accountKey: string): string {
  return `DefaultEndpointsProtocol=https;AccountName=${accountName};AccountKey=${accountKey};EndpointSuffix=${STORAGE_DNS_SUFFIX}`;
}

function uniqueOrigins(origins: string[]): string[] {
  return [...new Set(origins)];
}

function subscriptionRoleId(subscriptionId: string, roleDefinitionId: string): string {
  return `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleDefinitionId}`;
}

function buildOpenAiTemplate(): Record<string, unknown> {
  return {
    $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
    contentVersion: '1.0.0.0',
    parameters: {
      openAIName: {
        type: 'string'
      },
      location: {
        type: 'string'
      },
      projectName: {
        type: 'string'
      },
      gpt54Capacity: {
        type: 'int'
      }
    },
    resources: [
      {
        type: 'Microsoft.CognitiveServices/accounts',
        apiVersion: '2025-04-01-preview',
        name: "[parameters('openAIName')]",
        location: "[parameters('location')]",
        kind: 'AIServices',
        identity: {
          type: 'SystemAssigned'
        },
        sku: {
          name: 'S0'
        },
        properties: {
          customSubDomainName: "[parameters('openAIName')]",
          publicNetworkAccess: 'Enabled',
          allowProjectManagement: true,
          disableLocalAuth: true,
          networkAcls: {
            defaultAction: 'Allow',
            ipRules: [],
            virtualNetworkRules: []
          }
        }
      },
      {
        type: 'Microsoft.CognitiveServices/accounts/projects',
        apiVersion: '2025-04-01-preview',
        name: "[format('{0}/{1}', parameters('openAIName'), parameters('projectName'))]",
        location: "[parameters('location')]",
        identity: {
          type: 'SystemAssigned'
        },
        dependsOn: ["[resourceId('Microsoft.CognitiveServices/accounts', parameters('openAIName'))]"],
        properties: {
          displayName: 'ProvePresent Project',
          description: 'Project for ProvePresent application with Agent Service'
        }
      },
      {
        type: 'Microsoft.CognitiveServices/accounts/deployments',
        apiVersion: '2025-04-01-preview',
        name: "[format('{0}/{1}', parameters('openAIName'), 'gpt-5.4')]",
        dependsOn: ["[resourceId('Microsoft.CognitiveServices/accounts', parameters('openAIName'))]"],
        sku: {
          name: 'GlobalStandard',
          capacity: "[parameters('gpt54Capacity')]"
        },
        properties: {
          model: {
            format: 'OpenAI',
            name: 'gpt-5.4',
            version: '2026-03-05'
          }
        }
      }
    ],
    outputs: {
      openAIName: {
        type: 'string',
        value: "[parameters('openAIName')]"
      },
      projectName: {
        type: 'string',
        value: "[parameters('projectName')]"
      }
    }
  };
}

function buildStaticWebAppLinkedBackendTemplate(): Record<string, unknown> {
  return {
    $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
    contentVersion: '1.0.0.0',
    parameters: {
      staticSiteName: {
        type: 'string'
      },
      linkedBackendName: {
        type: 'string'
      },
      backendResourceId: {
        type: 'string'
      },
      backendRegion: {
        type: 'string'
      }
    },
    resources: [
      {
        type: 'Microsoft.Web/staticSites/linkedBackends',
        apiVersion: '2025-03-01',
        name: "[format('{0}/{1}', parameters('staticSiteName'), parameters('linkedBackendName'))]",
        kind: 'LinkedBackend',
        properties: {
          backendResourceId: "[parameters('backendResourceId')]",
          region: "[parameters('backendRegion')]"
        }
      }
    ],
    outputs: {
      linkedBackendName: {
        type: 'string',
        value: "[parameters('linkedBackendName')]"
      }
    }
  };
}

function buildFoundryTracingConnectionTemplate(): Record<string, unknown> {
  return {
    $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
    contentVersion: '1.0.0.0',
    parameters: {
      openAIName: {
        type: 'string'
      },
      projectName: {
        type: 'string'
      },
      connectionName: {
        type: 'string'
      },
      targetResourceId: {
        type: 'string'
      },
      targetResourceName: {
        type: 'string'
      },
      appInsightsInstrumentationKey: {
        type: 'securestring'
      }
    },
    resources: [
      {
        type: 'Microsoft.CognitiveServices/accounts/projects/connections',
        apiVersion: '2025-09-01',
        name: "[format('{0}/{1}/{2}', parameters('openAIName'), parameters('projectName'), parameters('connectionName'))]",
        properties: {
          category: 'AppInsights',
          authType: 'ApiKey',
          target: "[parameters('targetResourceId')]",
          credentials: {
            key: "[parameters('appInsightsInstrumentationKey')]"
          },
          metadata: {
            resourceId: "[parameters('targetResourceId')]",
            resourceName: "[parameters('targetResourceName')]"
          }
        }
      }
    ],
    outputs: {
      connectionName: {
        type: 'string',
        value: "[parameters('connectionName')]"
      }
    }
  };
}
