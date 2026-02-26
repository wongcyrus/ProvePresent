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
param deployAzureOpenAI = true  // Changed to true for Live Quiz feature

// Optional: Deploy SignalR Service for real-time features
param deploySignalR = true  // Enable SignalR for development

param gpt4DeploymentName = 'gpt-4o'
param gpt4ModelName = 'gpt-4o'
param gpt4ModelVersion = '2024-08-06'  // Current GPT-4o version
param gpt4VisionDeploymentName = 'gpt-4o-vision'
param gpt4VisionModelName = 'gpt-4o'
param gpt4VisionModelVersion = '2024-08-06' // GPT-4o has built-in vision
param deployVisionModel = true  // Required for Live Quiz slide analysis
param gpt52ChatDeploymentName = 'gpt-5.2-chat'
param gpt52ChatModelName = 'gpt-5.2-chat'
param gpt52ChatModelVersion = '2026-02-10'
param deployGpt52ChatModel = true

// Tags
param tags = {
  Environment: 'Development'
  Application: 'QR Chain Attendance'
  ManagedBy: 'Bicep'
  CostCenter: 'Engineering'
}
