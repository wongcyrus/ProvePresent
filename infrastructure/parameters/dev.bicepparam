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
param deployAzureOpenAI = true

// Optional: Deploy SignalR Service for real-time features
param deploySignalR = true  // Enable SignalR for development

// Primary model deployment for quiz + vision fallback
param gpt4DeploymentName = 'gpt-4.1'
param gpt4ModelName = 'gpt-4.1'
param gpt4ModelVersion = '2025-04-14'
param gpt4VisionDeploymentName = 'gpt-4.1-vision'
param gpt4VisionModelName = 'gpt-4.1'
param gpt4VisionModelVersion = '2025-04-14'
param deployVisionModel = false
param deployGpt4Model = true

// Disable GPT-5.2-chat deployment for dev
param gpt52ChatDeploymentName = 'gpt-5.2-chat'
param gpt52ChatModelName = 'gpt-5.2-chat'
param gpt52ChatModelVersion = '2026-02-10'
param deployGpt52ChatModel = false

// Enable GPT-5.4 deployment for dev (latest model)
param gpt54DeploymentName = 'gpt-5.4'
param gpt54ModelName = 'gpt-5.4'
param gpt54ModelVersion = '2026-03-05'
param deployGpt54Model = true

// Single deployment with adequate capacity for dev
param gpt4Capacity = 50
param gpt4VisionCapacity = 1
param gpt52ChatCapacity = 50
param gpt54Capacity = 200  // 200K TPM for dev

// OTP SMTP settings (read from environment; no secrets committed)
param otpSmtpHost = readEnvironmentVariable('OTP_SMTP_HOST', 'smtp.gmail.com')
param otpSmtpPort = readEnvironmentVariable('OTP_SMTP_PORT', '465')
param otpSmtpSecure = readEnvironmentVariable('OTP_SMTP_SECURE', 'true')
param otpSmtpUsername = readEnvironmentVariable('OTP_SMTP_USERNAME', '')
param otpSmtpPassword = readEnvironmentVariable('OTP_SMTP_PASSWORD', '')
param otpFromEmail = readEnvironmentVariable('OTP_FROM_EMAIL', '')
param otpFromName = readEnvironmentVariable('OTP_FROM_NAME', 'VTC Attendance')
param otpEmailSubject = readEnvironmentVariable('OTP_EMAIL_SUBJECT', 'Your verification code')
param otpAppName = readEnvironmentVariable('OTP_APP_NAME', 'ProvePresent')

// Tags
param tags = {
  Environment: 'Development'
  Application: 'ProvePresent'
  ManagedBy: 'Bicep'
  CostCenter: 'Engineering'
}
