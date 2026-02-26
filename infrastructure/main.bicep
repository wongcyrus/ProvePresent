// QR Chain Attendance System - Main Infrastructure Template
// This template orchestrates all Azure resources for the QR Chain Attendance System
// Requirements: 19.1, 19.2, 19.3, 19.4, 19.5

targetScope = 'resourceGroup'

// ============================================================================
// PARAMETERS
// ============================================================================

@description('Environment name (dev, staging, prod)')
@allowed([
  'dev'
  'staging'
  'prod'
])
param environment string = 'dev'

@description('Location for all resources')
param location string = resourceGroup().location

@description('Base name for all resources (will be suffixed with environment)')
@minLength(3)
@maxLength(20)
param baseName string = 'qrattendance'

@description('Frontend URLs for CORS configuration (fallback only - Static Web App uses linked backend)')
param frontendUrls array = [
  'http://localhost:3000'  // For local development only
  // Static Web App URLs not needed when using linked backend (reverse proxy)
  // Add here only if direct Function App access is required
]

@description('Deploy Azure OpenAI resource (optional)')
param deployAzureOpenAI bool = false

@description('Deploy SignalR Service (optional, system works with polling fallback)')
param deploySignalR bool = false

@description('GPT-4 model deployment name')
param gpt4DeploymentName string = 'gpt-4'

@description('GPT-4 model name')
param gpt4ModelName string = 'gpt-4'

@description('GPT-4 model version')
param gpt4ModelVersion string = '0613'

@description('GPT-4 Vision model deployment name')
param gpt4VisionDeploymentName string = 'gpt-4-vision'

@description('GPT-4 Vision model name')
param gpt4VisionModelName string = 'gpt-4'

@description('GPT-4 Vision model version')
param gpt4VisionModelVersion string = 'vision-preview'

@description('Deploy GPT-4 Vision model (required for Live Quiz feature)')
param deployVisionModel bool = true

@description('GPT-5.2-chat model deployment name')
param gpt52ChatDeploymentName string = 'gpt-5.2-chat'

@description('GPT-5.2-chat model name')
param gpt52ChatModelName string = 'gpt-5.2-chat'

@description('GPT-5.2-chat model version')
param gpt52ChatModelVersion string = '2026-02-10'

@description('Deploy GPT-5.2-chat model (preview - most advanced model)')
param deployGpt52ChatModel bool = true

@description('Tags to apply to all resources')
param tags object = {
  Environment: environment
  Application: 'QR Chain Attendance'
  ManagedBy: 'Bicep'
}

// ============================================================================
// VARIABLES
// ============================================================================

var resourceSuffix = '${baseName}-${environment}'
var storageAccountName = replace('st${resourceSuffix}', '-', '')
var signalRName = 'signalr-${resourceSuffix}'
var functionAppName = 'func-${resourceSuffix}'
var appServicePlanName = 'asp-${resourceSuffix}'
var appInsightsName = 'appi-${resourceSuffix}'
var openAIName = 'openai-${resourceSuffix}'

// CORS URLs for Function App (localhost only - Static Web App uses linked backend)
var corsUrls = frontendUrls

// ============================================================================
// MODULES
// ============================================================================

// Storage Account with Table Storage
module storage 'modules/storage.bicep' = {
  name: 'storage-deployment'
  params: {
    storageAccountName: storageAccountName
    location: location
    tags: tags
  }
}

// Azure SignalR Service (Optional)
module signalr 'modules/signalr.bicep' = {
  name: 'signalr-deployment'
  params: {
    signalRName: signalRName
    location: location
    environment: environment
    deploySignalR: deploySignalR
    tags: tags
  }
}

// Application Insights
module appInsights 'modules/appinsights.bicep' = {
  name: 'appinsights-deployment'
  params: {
    appInsightsName: appInsightsName
    location: location
    tags: tags
  }
}

// Azure OpenAI (Optional) - Must be deployed before Functions
module openai 'modules/openai.bicep' = if (deployAzureOpenAI) {
  name: 'openai-deployment'
  params: {
    openAIName: openAIName
    location: location
    gpt4DeploymentName: gpt4DeploymentName
    gpt4ModelName: gpt4ModelName
    gpt4ModelVersion: gpt4ModelVersion
    gpt4VisionDeploymentName: gpt4VisionDeploymentName
    gpt4VisionModelName: gpt4VisionModelName
    gpt4VisionModelVersion: gpt4VisionModelVersion
    deployVisionModel: deployVisionModel
    gpt52ChatDeploymentName: gpt52ChatDeploymentName
    gpt52ChatModelName: gpt52ChatModelName
    gpt52ChatModelVersion: gpt52ChatModelVersion
    deployGpt52ChatModel: deployGpt52ChatModel
    tags: tags
  }
}

// Azure Functions (Backend API)
module functions 'modules/functions.bicep' = {
  name: 'functions-deployment'
  params: {
    functionAppName: functionAppName
    appServicePlanName: appServicePlanName
    location: location
    storageAccountName: storage.outputs.storageAccountName
    storageAccountUri: storage.outputs.tableEndpoint
    signalRConnectionString: signalr.outputs.connectionString
    appInsightsConnectionString: appInsights.outputs.connectionString
    azureOpenAIEndpoint: deployAzureOpenAI ? openai.outputs.endpoint : ''
    azureOpenAIKey: deployAzureOpenAI ? openai.outputs.primaryKey : ''
    azureOpenAIDeployment: deployAzureOpenAI ? (deployGpt52ChatModel ? openai.outputs.gpt52ChatDeploymentName : 'gpt-4o') : ''
    azureOpenAIVisionDeployment: deployAzureOpenAI ? 'gpt-4o' : ''
    frontendUrls: corsUrls
    tags: tags
  }
}

// RBAC Role Assignments
module rbac 'modules/rbac.bicep' = {
  name: 'rbac-deployment'
  params: {
    storageAccountName: storage.outputs.storageAccountName
    signalRName: signalr.outputs.signalRName
    functionAppPrincipalId: functions.outputs.principalId
    deployAzureOpenAI: deployAzureOpenAI
    openAIName: deployAzureOpenAI ? openai.outputs.openAIName : ''
  }
  dependsOn: [
    storage
    signalr
    functions
  ]
}

// ============================================================================
// OUTPUTS
// ============================================================================

@description('Storage Account name')
output storageAccountName string = storage.outputs.storageAccountName

@description('Storage Account Table endpoint')
output storageTableEndpoint string = storage.outputs.tableEndpoint

@description('SignalR Service name')
output signalRName string = signalr.outputs.signalRName

@description('SignalR Service endpoint')
output signalREndpoint string = signalr.outputs.endpoint

@description('SignalR Service connection string')
output signalRConnectionString string = signalr.outputs.connectionString

@description('Frontend URL (manually deployed)')
output frontendUrl string = 'https://agreeable-pebble-05aa6201e.1.azurestaticapps.net'

@description('Function App name')
output functionAppName string = functions.outputs.functionAppName

@description('Function App default hostname')
output functionAppUrl string = functions.outputs.defaultHostname

@description('Application Insights name')
output appInsightsName string = appInsights.outputs.appInsightsName

@description('Application Insights instrumentation key')
output appInsightsInstrumentationKey string = appInsights.outputs.instrumentationKey

@description('Azure OpenAI name (if deployed)')
output openAIName string = deployAzureOpenAI ? openai.outputs.openAIName : ''

@description('Azure OpenAI endpoint (if deployed)')
output openAIEndpoint string = deployAzureOpenAI ? openai.outputs.endpoint : ''

@description('GPT-4 deployment name (if deployed)')
output gpt4DeploymentName string = deployAzureOpenAI ? openai.outputs.gpt4DeploymentName : ''

@description('GPT-4 Vision deployment name (if deployed)')
output gpt4VisionDeploymentName string = deployAzureOpenAI ? openai.outputs.gpt4VisionDeploymentName : ''

@description('GPT-5.2-chat deployment name (if deployed)')
output gpt52ChatDeploymentName string = deployAzureOpenAI ? openai.outputs.gpt52ChatDeploymentName : ''

@description('Deployment summary')
output deploymentSummary object = {
  environment: environment
  location: location
  storageAccount: storage.outputs.storageAccountName
  signalR: signalr.outputs.signalRName
  frontend: 'CLI-deployed (https://agreeable-pebble-05aa6201e.1.azurestaticapps.net)'
  functionApp: functions.outputs.functionAppName
  appInsights: appInsights.outputs.appInsightsName
}
