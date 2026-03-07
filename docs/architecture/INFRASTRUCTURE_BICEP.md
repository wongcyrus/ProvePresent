# Infrastructure as Code (Bicep) Architecture

**Last Updated**: March 5, 2026  
**Version**: 3.0

---

## Overview

ProvePresent uses Azure Bicep for Infrastructure as Code (IaC), providing declarative, repeatable deployments across development and production environments.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           main.bicep (Orchestrator)                          │
│                                                                              │
│  Parameters: environment, baseName, location, deployAzureOpenAI,            │
│              deploySignalR, frontendUrls, OTP settings, GPT model configs   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          │                           │                           │
          ▼                           ▼                           ▼
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│  storage.bicep  │       │  signalr.bicep  │       │ appinsights.bicep│
│                 │       │                 │       │                  │
│ • Storage Acct  │       │ • SignalR Svc   │       │ • Log Analytics  │
│ • Table Service │       │ • Free/Standard │       │ • App Insights   │
│ • 16 Tables     │       │ • Serverless    │       │                  │
│ • Blob Service  │       │                 │       │                  │
│ • 2 Containers  │       │                 │       │                  │
└─────────────────┘       └─────────────────┘       └──────────────────┘
          │                           │                           │
          └───────────────────────────┼───────────────────────────┘
                                      │
                                      ▼
                          ┌─────────────────────┐
                          │   openai.bicep      │
                          │   (Conditional)     │
                          │                     │
                          │ • AIServices Acct   │
                          │ • Foundry Project   │
                          │ • GPT-4.1 Deploy    │
                          │ • GPT-5.2 Deploy    │
                          │ • Keyless Auth      │
                          └─────────────────────┘
                                      │
                                      ▼
                          ┌─────────────────────┐
                          │  functions.bicep    │
                          │                     │
                          │ • App Service Plan  │
                          │ • Function App      │
                          │ • System Identity   │
                          │ • App Settings      │
                          │ • Auth Disabled     │
                          └─────────────────────┘
                                      │
                                      ▼
                          ┌─────────────────────┐
                          │    rbac.bicep       │
                          │                     │
                          │ • Storage Table     │
                          │   Data Contributor  │
                          │ • SignalR Owner     │
                          │ • OpenAI User       │
                          │ • Azure AI User     │
                          │   (Account + Proj)  │
                          └─────────────────────┘
```

---

## Module Details

### 1. main.bicep (Orchestrator)

**Purpose**: Coordinates all module deployments and manages dependencies.

**Key Parameters**:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `environment` | string | 'dev' | Environment (dev/staging/prod) |
| `baseName` | string | 'qrattendance' | Base name for resources |
| `location` | string | resourceGroup().location | Azure region |
| `deployAzureOpenAI` | bool | false | Deploy Azure OpenAI |
| `deploySignalR` | bool | false | Deploy SignalR Service |
| `frontendUrls` | array | [] | CORS allowed origins |
| `deployGpt4Model` | bool | true | Deploy GPT-4 model |
| `deployVisionModel` | bool | true | Deploy GPT-4 Vision |
| `deployGpt52ChatModel` | bool | true | Deploy GPT-5.2-chat |
| `otpSmtp*` | various | - | OTP email configuration |

**Outputs**:
- Storage account name and endpoints
- SignalR name, endpoint, connection string
- Function App name and URL
- Application Insights connection string
- OpenAI endpoint, keys, deployment names
- Foundry project name and endpoint

### 2. storage.bicep

**Purpose**: Provisions Azure Storage with Table and Blob services.

**Resources Created**:
- Storage Account (Standard_LRS, StorageV2)
- Table Service with 16 tables
- Blob Service with 2 containers

**Tables**:
| Table | Purpose |
|-------|---------|
| Sessions | Session metadata |
| Attendance | Student attendance records |
| Tokens | Chain tokens (10s TTL) |
| Chains | QR chain state |
| ScanLogs | QR scan audit |
| UserSessions | User-session mapping |
| AttendanceSnapshots | Snapshot metadata |
| ChainHistory | Chain transfer audit |
| DeletionLog | Deletion audit trail |
| QuizQuestions | AI-generated questions |
| QuizResponses | Student answers |
| QuizMetrics | Quiz performance |
| CaptureRequests | Image capture requests |
| CaptureUploads | Image uploads |
| CaptureResults | Capture analysis results |

**Blob Containers**:
- `quiz-slides` - Slide images for quiz generation
- `student-captures` - Student image captures

**Security**:
- HTTPS only
- TLS 1.2 minimum
- No public blob access
- Shared key access enabled (required for Table Storage)

### 3. signalr.bicep

**Purpose**: Provisions Azure SignalR Service for real-time communication.

**Configuration by Environment**:
| Environment | SKU | Connections | Messages/Day | Cost |
|-------------|-----|-------------|--------------|------|
| dev | Free_F1 | 20 | 20K | $0 |
| staging/prod | Standard_S1 | 1,000 | 1M | ~$50/mo |

**Features**:
- Serverless mode
- Connectivity and messaging logs enabled
- CORS configured via deployment scripts
- Network ACLs (Standard tier only)

**Conditional Deployment**: Only deployed when `deploySignalR = true`

### 4. appinsights.bicep

**Purpose**: Provisions monitoring and logging infrastructure.

**Resources**:
- Log Analytics Workspace (PerGB2018 SKU)
- Application Insights (web type)

**Configuration**:
- 30-day retention
- 1 GB daily quota
- Public network access enabled

### 5. openai.bicep

**Purpose**: Provisions Azure AI Services with Foundry project for Agent Service.

**Resources**:
- Azure AI Services Account (AIServices kind)
- Foundry Project (for Agent Service)
- Model Deployments (conditional)

**Model Deployments**:
| Deployment | Model | Version | Capacity | Purpose |
|------------|-------|---------|----------|---------|
| gpt-5.4 | gpt-5.4 | 2026-03-05 | 200K TPM (dev), 2M TPM (prod) | Quiz generation, vision analysis, agents |
| gpt-4.1 | gpt-4.1 | 2025-04-14 | 50K TPM | Fallback model (dev only) |
| gpt-4.1-vision | gpt-4.1 | 2025-04-14 | 1K TPM | Slide analysis |
| gpt-5.2-chat | gpt-5.2-chat | 2026-02-10 | 100K TPM | Advanced agents |

**Key Features**:
- `allowProjectManagement: true` - Enables Foundry projects
- `disableLocalAuth: true` - Keyless authentication only
- System-assigned managed identity
- Sequential deployment to avoid conflicts

**API Version**: 2025-04-01-preview

### 6. functions.bicep

**Purpose**: Provisions Azure Functions backend API.

**Resources**:
- App Service Plan (Consumption Y1, Linux)
- Function App (Node.js 22)
- Authentication configuration (disabled)

**Key App Settings**:
| Setting | Purpose |
|---------|---------|
| `FUNCTIONS_EXTENSION_VERSION` | ~4 |
| `FUNCTIONS_WORKER_RUNTIME` | node |
| `WEBSITE_NODE_DEFAULT_VERSION` | ~22 |
| `STORAGE_ACCOUNT_NAME` | Table storage access |
| `SIGNALR_CONNECTION_STRING` | Real-time messaging |
| `AZURE_OPENAI_*` | AI service configuration |
| `OTP_*` | Email OTP settings |
| `CHAIN_TOKEN_TTL_SECONDS` | 25 seconds |
| `QR_ENCRYPTION_KEY` | Auto-generated |

**Security**:
- System-assigned managed identity
- HTTPS only
- FTPS disabled
- TLS 1.2 minimum
- Authentication disabled (handled by Static Web App)

### 7. rbac.bicep

**Purpose**: Assigns RBAC roles for managed identity access.

**Role Assignments**:
| Role | Scope | Purpose |
|------|-------|---------|
| Storage Table Data Contributor | Storage Account | Table CRUD operations |
| SignalR Service Owner | SignalR Service | Message broadcasting |
| Cognitive Services OpenAI User | OpenAI Account | Model inference |
| Azure AI User | OpenAI Account | Agent Service access |
| Azure AI User | Foundry Project | Project-scoped agent ops |

**Idempotency**: Uses deterministic GUIDs for role assignment names.

---

## Parameter Files

### dev.bicepparam

```bicep
param environment = 'dev'
param baseName = 'qrattendance'
param location = 'eastus2'
param frontendUrls = ['http://localhost:3000', 'https://localhost:3000']
param deployAzureOpenAI = true
param deploySignalR = true
param deployGpt4Model = true
param deployVisionModel = false
param deployGpt52ChatModel = false
param gpt4Capacity = 50
```

### prod.bicepparam

```bicep
param environment = 'prod'
param baseName = 'qrattendance'
param location = 'eastus2'
param frontendUrls = []  // Configured via SWA linkage
param deployAzureOpenAI = true
param deploySignalR = true
param deployGpt4Model = false  // Using GPT-4o instead
param deployVisionModel = false
param deployGpt52ChatModel = false
param gpt4Capacity = 10
param gpt52ChatCapacity = 100
```

---

## Resource Naming Convention

```
<resource-type>-<baseName>-<environment>
```

| Resource Type | Prefix | Example (prod) |
|---------------|--------|----------------|
| Storage Account | st | stqrattendanceprod |
| SignalR Service | signalr- | signalr-qrattendance-prod |
| Function App | func- | func-qrattendance-prod |
| App Service Plan | asp- | asp-qrattendance-prod |
| Application Insights | appi- | appi-qrattendance-prod |
| Azure OpenAI | openai- | openai-qrattendance-prod |
| Log Analytics | appi-*-workspace | appi-qrattendance-prod-workspace |

---

## Deployment Dependencies

```
storage ──────────────────────────────────────────┐
                                                  │
signalr ──────────────────────────────────────────┤
                                                  │
appInsights ──────────────────────────────────────┤
                                                  ├──► functions ──► rbac
openai (conditional) ─────────────────────────────┤
  └── gpt4Deployment                              │
        └── gpt4VisionDeployment                  │
              └── gpt52ChatDeployment             │
```

---

## Security Architecture

### Managed Identity Flow

```
┌─────────────────┐     System Identity     ┌─────────────────┐
│  Function App   │ ──────────────────────► │  Azure RBAC     │
└─────────────────┘                         └────────┬────────┘
                                                     │
                                                     │ Token
                                                     ▼
┌─────────────────┐     RBAC Validation     ┌─────────────────┐
│  Table Storage  │ ◄────────────────────── │  Azure RBAC     │
│  SignalR        │                         │                 │
│  OpenAI         │                         │                 │
└─────────────────┘                         └─────────────────┘
```

### Authentication Architecture

```
┌─────────────────┐                         ┌─────────────────┐
│  Browser        │ ──── Login ────────────►│  Backend API    │
└────────┬────────┘                         │  (OTP Auth)     │
         │                                  └────────┬────────┘
         │ JWT Cookie                                │
         ▼                                           │
┌─────────────────┐                                  │
│  Static Web App │ ◄──── JWT Validation ────────────┘
│  (Standard SKU) │
└────────┬────────┘
         │ x-ms-client-principal
         │ (Reverse Proxy)
         ▼
┌─────────────────┐
│  Function App   │  ◄── No direct auth (anonymous)
│  (Backend API)  │
└─────────────────┘
```

---

## Cost Estimation

### Development Environment
| Resource | SKU | Monthly Cost |
|----------|-----|--------------|
| Storage Account | Standard LRS | ~$2 |
| SignalR Service | Free | $0 |
| Function App | Consumption | ~$5-10 |
| Application Insights | Pay-as-you-go | ~$2-5 |
| Azure OpenAI | S0 | ~$10-30 |
| **Total** | | **~$19-47** |

### Production Environment
| Resource | SKU | Monthly Cost |
|----------|-----|--------------|
| Storage Account | Standard LRS | ~$5-10 |
| SignalR Service | Standard S1 | ~$50 |
| Function App | Consumption | ~$20-50 |
| Application Insights | Pay-as-you-go | ~$10-20 |
| Azure OpenAI | S0 | ~$50-100 |
| Static Web App | Standard | ~$9 |
| **Total** | | **~$144-239** |

---

## Related Documentation

- [DEPLOYMENT_SCRIPTS.md](./DEPLOYMENT_SCRIPTS.md) - Deployment script details
- [SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md) - Overall system architecture
- [../deployment/DEPLOYMENT_GUIDE.md](../deployment/DEPLOYMENT_GUIDE.md) - Deployment instructions
