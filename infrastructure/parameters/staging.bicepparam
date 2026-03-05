// Staging Environment Parameters
using '../main.bicep'

param environment = 'staging'
param baseName = 'qrattendance'
param location = 'eastus2'  // Changed from eastus - Static Web Apps not available in eastus

// GitHub repository configuration
// These should be provided at deployment time or via environment variables
param repositoryUrl = ''
param repositoryBranch = 'staging'
param repositoryToken = ''

// Azure AD configuration
// These should be provided at deployment time or via environment variables
param aadClientId = ''
param aadClientSecret = ''

// Optional: Deploy Azure OpenAI for AI insights
param deployAzureOpenAI = true
param openAIModelDeployment = 'gpt-4'
param openAIModelName = 'gpt-4'
param openAIModelVersion = '0613'

// Staging capacity settings (moderate for testing)
param gpt52ChatCapacity = 50  // 50K TPM for staging environment

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
  Environment: 'Staging'
  Application: 'QR Chain Attendance'
  ManagedBy: 'Bicep'
  CostCenter: 'Engineering'
}
