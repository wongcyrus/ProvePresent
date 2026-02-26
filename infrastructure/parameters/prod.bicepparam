// Production Environment Parameters
using '../main.bicep'

param environment = 'prod'
param baseName = 'qrattendance'
param location = 'eastus2'

// Frontend URLs for CORS configuration (will be updated by deployment script)
param frontendUrls = [
  'https://agreeable-pebble-05aa6201e.1.azurestaticapps.net'
  'http://localhost:3000'  // For local development
]

// Deploy Azure OpenAI for Live Quiz feature
param deployAzureOpenAI = true

// Deploy SignalR Service with Standard S1 tier for production
param deploySignalR = true

// GPT-4 model configuration
param gpt4DeploymentName = 'gpt-4o'
param gpt4ModelName = 'gpt-4o'
param gpt4ModelVersion = '2024-08-06'  // Latest GPT-4o version
param gpt4VisionDeploymentName = 'gpt-4o-vision'
param gpt4VisionModelName = 'gpt-4o'
param gpt4VisionModelVersion = '2024-08-06'  // GPT-4o has built-in vision
param deployVisionModel = true
param gpt52ChatDeploymentName = 'gpt-5.2-chat'
param gpt52ChatModelName = 'gpt-5.2-chat'
param gpt52ChatModelVersion = '2026-02-10'
param deployGpt52ChatModel = true

// Tags
param tags = {
  Environment: 'Production'
  Application: 'QR Chain Attendance'
  ManagedBy: 'Bicep'
  DeploymentMethod: 'Hybrid'  // Bicep for backend + CLI for Static Web App
  CostCenter: 'Engineering'
}
