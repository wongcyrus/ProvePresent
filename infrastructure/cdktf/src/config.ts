import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

export type DeploymentEnvironment = 'dev' | 'staging' | 'prod';

export interface EnvironmentConfig {
  readonly environment: DeploymentEnvironment;
  readonly armSubscriptionId: string;
  readonly armTenantId: string;
  readonly armClientId: string;
  readonly armClientSecret: string;
  readonly baseName: string;
  readonly location: string;
  readonly resourceGroupName: string;
  readonly tags: Record<string, string>;
  readonly frontendUrls: string[];
  readonly blobCorsAllowedOrigins: string[];
  readonly deployAzureOpenAI: boolean;
  readonly deploySignalR: boolean;
  readonly gpt54Capacity: number;
  readonly signalrSkuName: string;
  readonly signalrSkuCapacity: number;
  readonly jwtSecret: string;
  readonly otpSmtpHost: string;
  readonly otpSmtpPort: string;
  readonly otpSmtpSecure: string;
  readonly otpSmtpUsername: string;
  readonly otpSmtpPassword: string;
  readonly otpFromEmail: string;
  readonly otpFromName: string;
  readonly otpEmailSubject: string;
  readonly otpAppName: string;
  readonly allowedEmailDomains: string;
  readonly organizationName: string;
  readonly organizerDomain: string;
  readonly attendeeDomain: string;
  readonly staticWebAppName: string;
  readonly enableStaticWebAppBackendLink: boolean;
  readonly staticWebAppLinkedBackendName: string;
  readonly enableFoundryTracingConnection: boolean;
}

export const tableNames = [
  'Sessions',
  'Attendance',
  'Tokens',
  'Chains',
  'ScanLogs',
  'UserSessions',
  'AttendanceSnapshots',
  'ChainHistory',
  'DeletionLog',
  'QuizQuestions',
  'QuizResponses',
  'QuizMetrics',
  'QuizConversations',
  'CaptureRequests',
  'CaptureUploads',
  'CaptureResults',
  'ExternalOrganizers',
  'OtpCodes',
  'AttendeeListEntries',
  'SessionAttendeeEntries'
] as const;

export function loadEnvironmentConfig(environment: DeploymentEnvironment): EnvironmentConfig | undefined {
  const envFile = loadEnvFile(environment);
  if (!envFile) {
    return undefined;
  }

  const baseName = required(envFile, 'CDKTF_BASE_NAME');
  const location = required(envFile, 'CDKTF_LOCATION');
  const enableStaticWebAppBackendLink = readBoolean(envFile, 'CDKTF_ENABLE_STATIC_WEB_APP_BACKEND_LINK', false);
  const staticWebAppName = enableStaticWebAppBackendLink
    ? required(envFile, 'CDKTF_STATIC_WEB_APP_NAME')
    : read(envFile, 'CDKTF_STATIC_WEB_APP_NAME', '');
  const staticWebAppLinkedBackendName = enableStaticWebAppBackendLink
    ? required(envFile, 'CDKTF_STATIC_WEB_APP_LINKED_BACKEND_NAME')
    : read(envFile, 'CDKTF_STATIC_WEB_APP_LINKED_BACKEND_NAME', '');

  return {
    environment,
    armSubscriptionId: read(envFile, 'ARM_SUBSCRIPTION_ID', ''),
    armTenantId: read(envFile, 'ARM_TENANT_ID', ''),
    armClientId: read(envFile, 'ARM_CLIENT_ID', ''),
    armClientSecret: read(envFile, 'ARM_CLIENT_SECRET', ''),
    baseName,
    location,
    resourceGroupName: required(envFile, 'CDKTF_RESOURCE_GROUP_NAME'),
    tags: compactObject({
      Environment: required(envFile, 'CDKTF_TAG_ENVIRONMENT'),
      Application: required(envFile, 'CDKTF_TAG_APPLICATION'),
      ManagedBy: required(envFile, 'CDKTF_TAG_MANAGED_BY'),
      CostCenter: read(envFile, 'CDKTF_TAG_COST_CENTER', ''),
      DeploymentMethod: read(envFile, 'CDKTF_TAG_DEPLOYMENT_METHOD', '')
    }),
    frontendUrls: readCsv(envFile, 'CDKTF_FRONTEND_URLS'),
    blobCorsAllowedOrigins: readCsv(envFile, 'CDKTF_BLOB_CORS_ALLOWED_ORIGINS'),
    deployAzureOpenAI: readBoolean(envFile, 'CDKTF_DEPLOY_AZURE_OPENAI', true),
    deploySignalR: readBoolean(envFile, 'CDKTF_DEPLOY_SIGNALR', false),
    gpt54Capacity: readNumber(envFile, 'CDKTF_GPT54_CAPACITY', 200),
    signalrSkuName: required(envFile, 'CDKTF_SIGNALR_SKU_NAME'),
    signalrSkuCapacity: readNumber(envFile, 'CDKTF_SIGNALR_SKU_CAPACITY', 1),
    jwtSecret: read(envFile, 'CDKTF_JWT_SECRET', ''),
    otpSmtpHost: read(envFile, 'CDKTF_OTP_SMTP_HOST', 'smtp.gmail.com'),
    otpSmtpPort: read(envFile, 'CDKTF_OTP_SMTP_PORT', '465'),
    otpSmtpSecure: read(envFile, 'CDKTF_OTP_SMTP_SECURE', 'true'),
    otpSmtpUsername: read(envFile, 'CDKTF_OTP_SMTP_USERNAME', ''),
    otpSmtpPassword: read(envFile, 'CDKTF_OTP_SMTP_PASSWORD', ''),
    otpFromEmail: read(envFile, 'CDKTF_OTP_FROM_EMAIL', ''),
    otpFromName: read(envFile, 'CDKTF_OTP_FROM_NAME', 'VTC Attendance'),
    otpEmailSubject: read(envFile, 'CDKTF_OTP_EMAIL_SUBJECT', 'Your verification code'),
    otpAppName: read(envFile, 'CDKTF_OTP_APP_NAME', 'ProvePresent'),
    allowedEmailDomains: read(envFile, 'CDKTF_ALLOWED_EMAIL_DOMAINS', ''),
    organizationName: read(envFile, 'CDKTF_ORGANIZATION_NAME', ''),
    organizerDomain: read(envFile, 'CDKTF_ORGANIZER_DOMAIN', 'vtc.edu.hk'),
    attendeeDomain: read(envFile, 'CDKTF_ATTENDEE_DOMAIN', ''),
    staticWebAppName,
    enableStaticWebAppBackendLink,
    staticWebAppLinkedBackendName,
    enableFoundryTracingConnection: readBoolean(envFile, 'CDKTF_ENABLE_FOUNDRY_TRACING_CONNECTION', true)
  };
}

function loadEnvFile(environment: DeploymentEnvironment): Record<string, string> | undefined {
  const filePath = resolve(__dirname, '..', `.env.${environment}`);
  if (!existsSync(filePath)) {
    return undefined;
  }

  return parse(readFileSync(filePath));
}

function required(values: Record<string, string>, key: string): string {
  const value = values[key];
  if (value === undefined || value === '') {
    throw new Error(`Missing required ${key} in environment file`);
  }
  return value;
}

function read(values: Record<string, string>, key: string, fallback: string): string {
  const value = values[key];
  return value === undefined ? fallback : value;
}

function readBoolean(values: Record<string, string>, key: string, fallback: boolean): boolean {
  const value = values[key];
  if (value === undefined || value === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function readNumber(values: Record<string, string>, key: string, fallback: number): number {
  const value = values[key];
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid number for ${key}: ${value}`);
  }
  return parsed;
}

function readCsv(values: Record<string, string>, key: string): string[] {
  const value = values[key];
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function compactObject(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''));
}
