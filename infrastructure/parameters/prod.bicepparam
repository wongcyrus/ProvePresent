// Production Environment Parameters
using '../main.bicep'

param environment = 'prod'
param baseName = 'qrattendance'
param location = 'eastus2'

// Frontend URLs for CORS configuration.
// Leave empty by default for production; deployment scripts configure SWA linkage/CORS.
param frontendUrls = []

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
param deployVisionModel = false
param gpt52ChatDeploymentName = 'gpt-5.2-chat'
param gpt52ChatModelName = 'gpt-5.2-chat'
param gpt52ChatModelVersion = '2026-02-10'
param deployGpt52ChatModel = false

// Production capacity settings
param gpt4Capacity = 10  // 10K TPM (not deployed but kept for compatibility)
param gpt4VisionCapacity = 10  // 10K TPM
param gpt52ChatCapacity = 100  // 100K TPM for production workload

// OTP SMTP settings (read from environment; no secrets committed)
param otpSmtpHost = readEnvironmentVariable('OTP_SMTP_HOST', 'smtp.gmail.com')
param otpSmtpPort = readEnvironmentVariable('OTP_SMTP_PORT', '465')
param otpSmtpSecure = readEnvironmentVariable('OTP_SMTP_SECURE', 'true')
param otpSmtpUsername = readEnvironmentVariable('OTP_SMTP_USERNAME', '')
param otpSmtpPassword = readEnvironmentVariable('OTP_SMTP_PASSWORD', '')
param otpFromEmail = readEnvironmentVariable('OTP_FROM_EMAIL', '')
param otpFromName = readEnvironmentVariable('OTP_FROM_NAME', 'VTC Attendance')
param otpEmailSubject = readEnvironmentVariable('OTP_EMAIL_SUBJECT', 'Your verification code')
param otpAppName = readEnvironmentVariable('OTP_APP_NAME', 'QR Chain Attend')

// Tags
param tags = {
  Environment: 'Production'
  Application: 'ProvePresent'
  ManagedBy: 'Bicep'
  DeploymentMethod: 'Hybrid'  // Bicep for backend + CLI for Static Web App
  CostCenter: 'Engineering'
}
