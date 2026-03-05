// Azure Functions (Backend API)
// Requirements: 19.1, 19.2, 19.3, 19.4, 19.5

@description('Function App name')
param functionAppName string

@description('App Service Plan name')
param appServicePlanName string

@description('Location for the Function App')
param location string

@description('Storage Account name for Function App')
param storageAccountName string

@description('Storage Account Table URI')
param storageAccountUri string

@description('SignalR Service connection string')
@secure()
param signalRConnectionString string

@description('Application Insights connection string')
@secure()
param appInsightsConnectionString string

@description('Azure OpenAI endpoint (optional)')
param azureOpenAIEndpoint string = ''

@description('Azure OpenAI key (optional)')
@secure()
param azureOpenAIKey string = ''

@description('Azure OpenAI GPT-4 deployment name (optional)')
param azureOpenAIDeployment string = ''

@description('Azure OpenAI vision deployment name')
param azureOpenAIVisionDeployment string = 'gpt-4.1'

@description('OTP SMTP host for custom email OTP delivery')
param otpSmtpHost string = 'smtp.gmail.com'

@description('OTP SMTP port for custom email OTP delivery')
param otpSmtpPort string = '465'

@description('OTP SMTP secure flag for custom email OTP delivery')
param otpSmtpSecure string = 'true'

@description('OTP SMTP username for custom email OTP delivery')
@secure()
param otpSmtpUsername string = ''

@description('OTP SMTP password for custom email OTP delivery')
@secure()
param otpSmtpPassword string = ''

@description('OTP from email address (defaults to SMTP username when empty)')
param otpFromEmail string = ''

@description('OTP from display name')
param otpFromName string = 'VTC Attendance'

@description('OTP email subject')
param otpEmailSubject string = 'Your verification code'

@description('OTP app name used in email body')
param otpAppName string = 'QR Chain Attend'

@description('Frontend URLs for CORS configuration (fallback only - Static Web App uses linked backend)')
param frontendUrls array = []

@description('Tags to apply to the resource')
param tags object

var otpFromEmailResolved = empty(otpFromEmail) ? otpSmtpUsername : otpFromEmail

// ============================================================================
// APP SERVICE PLAN (Consumption)
// ============================================================================

resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: appServicePlanName
  location: location
  tags: tags
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
    size: 'Y1'
    family: 'Y'
  }
  properties: {
    reserved: true // Required for Linux
  }
  kind: 'functionapp'
}

// ============================================================================
// FUNCTION APP
// ============================================================================

resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
  name: functionAppName
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    reserved: true
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'NODE|22'
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccountName};EndpointSuffix=${az.environment().suffixes.storage};AccountKey=${listKeys(resourceId('Microsoft.Storage/storageAccounts', storageAccountName), '2023-01-01').keys[0].value}'
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccountName};EndpointSuffix=${az.environment().suffixes.storage};AccountKey=${listKeys(resourceId('Microsoft.Storage/storageAccounts', storageAccountName), '2023-01-01').keys[0].value}'
        }
        {
          name: 'WEBSITE_CONTENTSHARE'
          value: toLower(functionAppName)
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME_VERSION'
          value: '~4'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~22'
        }
        {
          name: 'FUNCTIONS_NODE_BLOCK_ON_ENTRY_POINT_ERROR'
          value: 'true'
        }
        {
          name: 'WEBSITE_MOUNT_ENABLED'
          value: '1'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'false'
        }
        {
          name: 'ENABLE_ORYX_BUILD'
          value: 'false'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
        // Application-specific settings
        {
          name: 'STORAGE_ACCOUNT_NAME'
          value: storageAccountName
        }
        {
          name: 'STORAGE_ACCOUNT_URI'
          value: storageAccountUri
        }
        {
          name: 'SIGNALR_CONNECTION_STRING'
          value: signalRConnectionString
        }
        {
          name: 'LATE_ROTATION_SECONDS'
          value: '60'
        }
        {
          name: 'EARLY_LEAVE_ROTATION_SECONDS'
          value: '60'
        }
        {
          name: 'CHAIN_TOKEN_TTL_SECONDS'
          value: '25'
        }
        {
          name: 'OWNER_TRANSFER'
          value: 'true'
        }
        {
          name: 'WIFI_SSID_ALLOWLIST'
          value: ''
        }
        {
          name: 'AZURE_OPENAI_ENDPOINT'
          value: azureOpenAIEndpoint
        }
        {
          name: 'AZURE_OPENAI_KEY'
          value: azureOpenAIKey
        }
        {
          name: 'AZURE_OPENAI_DEPLOYMENT'
          value: azureOpenAIDeployment
        }
        {
          name: 'AZURE_OPENAI_VISION_DEPLOYMENT'
          value: azureOpenAIVisionDeployment
        }
        {
          name: 'AZURE_OPENAI_API_VERSION'
          value: '2025-04-01-preview'
        }
        // Legacy AOAI settings (kept for backward compatibility)
        {
          name: 'AOAI_ENDPOINT'
          value: azureOpenAIEndpoint
        }
        {
          name: 'AOAI_KEY'
          value: azureOpenAIKey
        }
        {
          name: 'AOAI_DEPLOYMENT'
          value: azureOpenAIDeployment
        }
        {
          name: 'QR_ENCRYPTION_KEY'
          value: uniqueString(resourceGroup().id, functionAppName, 'qr-encryption')
        }
        {
          name: 'OTP_SMTP_HOST'
          value: otpSmtpHost
        }
        {
          name: 'OTP_SMTP_PORT'
          value: otpSmtpPort
        }
        {
          name: 'OTP_SMTP_SECURE'
          value: otpSmtpSecure
        }
        {
          name: 'OTP_SMTP_USERNAME'
          value: otpSmtpUsername
        }
        {
          name: 'OTP_SMTP_PASSWORD'
          value: otpSmtpPassword
        }
        {
          name: 'OTP_FROM_EMAIL'
          value: otpFromEmailResolved
        }
        {
          name: 'OTP_FROM_NAME'
          value: otpFromName
        }
        {
          name: 'OTP_EMAIL_SUBJECT'
          value: otpEmailSubject
        }
        {
          name: 'OTP_APP_NAME'
          value: otpAppName
        }
      ]
      cors: {
        allowedOrigins: length(frontendUrls) > 0 ? frontendUrls : [
          '*' // Fallback to all origins if no frontend URLs provided
        ]
        supportCredentials: true
      }
      use32BitWorkerProcess: false
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
    }
  }
}

// ============================================================================
// FUNCTION APP AUTHENTICATION (DISABLED)
// ============================================================================
// Per Microsoft Learn: When using with Static Web Apps, 
// authentication should be handled by SWA, not the Function App
// https://learn.microsoft.com/azure/static-web-apps/functions-bring-your-own

resource functionAppAuth 'Microsoft.Web/sites/config@2023-01-01' = {
  parent: functionApp
  name: 'authsettingsV2'
  properties: {
    platform: {
      enabled: false
    }
    globalValidation: {
      requireAuthentication: false
      unauthenticatedClientAction: 'AllowAnonymous'
    }
  }
}

// ============================================================================
// OUTPUTS
// ============================================================================

@description('Function App name')
output functionAppName string = functionApp.name

@description('Function App ID')
output functionAppId string = functionApp.id

@description('Function App default hostname')
output defaultHostname string = functionApp.properties.defaultHostName

@description('Function App principal ID (Managed Identity)')
output principalId string = functionApp.identity.principalId
