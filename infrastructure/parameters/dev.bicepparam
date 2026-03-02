// Development Environment Parameters
using '../main.bicep'

param environment = 'dev'
param baseName = 'qrattendance'
param location = 'eastus2'  // Changed from eastus - Static Web Apps not available in eastus

// Frontend URLs for CORS configuration
param frontendUrls = [
  'http://localhost:3000'  // For local development
  'https://localhost:3000' // For HTTPS local development
]

// Optional: Deploy Azure OpenAI for AI insights and Live Quiz feature
param deployAzureOpenAI = true  // Enabled with single model deployment

// Optional: Deploy SignalR Service for real-time features
param deploySignalR = true  // Enable SignalR for development

// Disable GPT-4 models - project only uses GPT-5.2-chat
param gpt4DeploymentName = 'gpt-4o'
param gpt4ModelName = 'gpt-4o'
param gpt4ModelVersion = '2024-08-06'
param gpt4VisionDeploymentName = 'gpt-4o-vision'
param gpt4VisionModelName = 'gpt-4o'
param gpt4VisionModelVersion = '2024-08-06'
param deployVisionModel = false  // Disabled - not used
param deployGpt4Model = false  // Disabled - not used

// ONLY deploy GPT-5.2-chat (the model actually used in the project)
param gpt52ChatDeploymentName = 'gpt-5.2-chat'
param gpt52ChatModelName = 'gpt-5.2-chat'
param gpt52ChatModelVersion = '2026-02-10'
param deployGpt52ChatModel = true  // Enabled - this is the only model we use

// Single deployment with minimal capacity for dev
param gpt4Capacity = 1  // Minimal (not deployed anyway)
param gpt4VisionCapacity = 1  // Minimal (not deployed anyway)
param gpt52ChatCapacity = 3  // ONLY deployment - reduced from 250

// Tags
param tags = {
  Environment: 'Development'
  Application: 'QR Chain Attendance'
  ManagedBy: 'Bicep'
  CostCenter: 'Engineering'
}
