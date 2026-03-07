# Deployment Scripts Architecture

**Last Updated**: March 5, 2026  
**Version**: 3.0

---

## Overview

ProvePresent uses comprehensive bash scripts for automated deployment. These scripts orchestrate Bicep infrastructure deployment, backend function deployment, frontend build/deploy, and post-deployment configuration.

## Script Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Full Deployment Scripts (Entry Points)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  deploy-full-production.sh    │  deploy-full-development.sh                 │
│  • Fail-fast (no retry)       │  • Retry logic (4 attempts)                 │
│  • Standard SWA SKU           │  • Standard SWA SKU                         │
│  • Production parameters      │  • Development parameters                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          │                           │                           │
          ▼                           ▼                           ▼
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│ Infrastructure  │       │    Backend      │       │    Frontend     │
│   Deployment    │       │   Deployment    │       │   Deployment    │
│                 │       │                 │       │                 │
│ • Bicep deploy  │       │ • npm install   │       │ • npm install   │
│ • RBAC setup    │       │ • npm build     │       │ • npm build     │
│ • Foundry proj  │       │ • func publish  │       │ • swa deploy    │
│ • Agent create  │       │ • Settings cfg  │       │ • SWA link      │
└─────────────────┘       └─────────────────┘       └─────────────────┘
```

---

## Main Deployment Scripts

### deploy-full-production.sh

**Purpose**: Complete production deployment with fail-fast behavior.

**Execution Flow**:

```
Step 0: Load JWT configuration
    └── Load .jwt-otp-config (JWT_SECRET, OTP settings)
    └── Load .otp-email-credentials (SMTP settings)
    └── Set defaults for optional values

Step 1: Check prerequisites
    └── Azure CLI, func, npm, curl, jq
    └── Node.js 22 (via NVM)
    └── Static Web Apps CLI

Step 1.5: Validate Azure tenant context
    └── Verify account tenant matches token tenant

Step 2: Create resource group
    └── rg-qr-attendance-prod in eastus2

Step 3: Deploy infrastructure (Bicep)
    └── Single attempt (no retry)
    └── infrastructure/parameters/prod.bicepparam
    └── Handle RoleAssignmentExists gracefully

Step 3.5: Foundry Project Setup
    └── Discover OpenAI account
    └── Find/create Foundry project
    └── Ensure RBAC access (user + project MI)
    └── Create tracing connection to App Insights
    └── Create agents via create-agents.ts

Step 4: Extract deployment outputs
    └── Parse deployment-output.json
    └── Fallback to Azure resource queries

Step 4.5: Configure SignalR CORS
    └── Prepare for SWA URL configuration

Step 5: Deploy backend functions
    └── npm install && npm run build
    └── Create local.settings.json with JWT/OTP settings
    └── func azure functionapp publish

Step 6: Verify database tables
    └── Tables managed by Bicep

Step 7: Build frontend
    └── Resolve Static Web App target
    └── Create .env.production (API URL only)
    └── Link Function App backend
    └── Create .env.production
    └── npm run build

Step 8: Deploy frontend
    └── Get deployment token
    └── swa deploy ./out

Step 8.5: Configure SignalR CORS
    └── Collect all SWA hostnames
    └── Update SignalR allowed origins

Step 8.6: Verify Function App configuration
    └── Ensure auth is disabled

Step 9: Verify deployment
    └── Health checks (Function App, SWA)
    └── Verify External ID login authority
    └── Check database tables

Step 10: Save deployment info
    └── deployment-info.json
```

**Key Functions**:

| Function | Purpose |
|----------|---------|
| `load_key_value_file()` | Parse key=value credential files |
| `load_otp_email_credentials()` | Load OTP SMTP settings |
| `discover_project_name()` | Find Foundry project in resource group |
| `discover_working_project_name()` | Find project with working endpoint |
| `build_project_endpoint()` | Construct project API URL |
| `validate_project_endpoint()` | Health check project endpoint |
| `ensure_foundry_rbac_access()` | Assign Azure AI User roles |
| `ensure_foundry_tracing_connection()` | Connect App Insights to Foundry |
| `resolve_runtime_agent_id()` | Resolve agent name to ID |
| `verify_external_id_login()` | Validate SWA auth redirect |
| `recover_ifmatch_conflict()` | Handle OpenAI ETag conflicts |

### deploy-full-development.sh

**Purpose**: Development deployment with retry logic.

**Key Differences from Production**:
- 4 retry attempts for infrastructure deployment
- Uses `dev.bicepparam` parameters
- Resource group: `rg-qr-attendance-dev`
- More lenient error handling

---

## Infrastructure Deployment (infrastructure/deploy.sh)

**Purpose**: Standalone Bicep deployment script.

**Usage**:
```bash
./infrastructure/deploy.sh \
  -e <environment> \
  -g <resource-group> \
  [-l <location>] \
  [-r <repository-url>] \
  [-b <branch>] \
  [-t <github-token>] \
  [-c <client-id>] \
  [-s <client-secret>] \
  [-o <deploy-openai>] \
  [-w]  # what-if mode
```

**Features**:
- Environment validation (dev/staging/prod)
- What-if mode for preview
- Parameter file selection
- Parameter overrides via CLI

---

## Credential Files

### .jwt-otp-config

**Purpose**: JWT and OTP authentication configuration (automatically loaded by deployment script).

**Required Variables**:
```bash
JWT_SECRET=<secure-random-string-64-characters>
JWT_EXPIRY_HOURS=24
OTP_EXPIRY_MINUTES=5
OTP_MAX_ATTEMPTS=3
OTP_RATE_LIMIT_MINUTES=15
OTP_RATE_LIMIT_COUNT=3
```

**Security**: Git-ignored, never committed.  
**Setup**: Run `./setup-jwt-config.sh` to generate automatically.

### .otp-email-credentials

**Purpose**: SMTP settings for OTP email delivery (automatically loaded by deployment script).

**Variables**:
```bash
OTP_SMTP_HOST=smtp.gmail.com
OTP_SMTP_PORT=465
OTP_SMTP_SECURE=true
OTP_SMTP_USERNAME=<email>
OTP_SMTP_PASSWORD=<app-password>
OTP_FROM_EMAIL=<sender-email>
OTP_FROM_NAME=VTC Attendance
OTP_EMAIL_SUBJECT=Your verification code
OTP_APP_NAME=ProvePresent
```

### .agent-config.env

**Purpose**: Generated agent configuration after deployment.

**Variables**:
```bash
AZURE_AI_PROJECT_ENDPOINT=https://<openai>.cognitiveservices.azure.com/api/projects/<project>
AZURE_AI_AGENT_NAME=quiz-question-generator
AZURE_AI_AGENT_VERSION=1
AZURE_AI_POSITION_AGENT_NAME=seating-position-analyzer
AZURE_AI_POSITION_AGENT_VERSION=1
```

---

## Agent Creation (create-agents.ts)

**Purpose**: Create persistent AI agents in Foundry project.

**Usage**:
```bash
npx tsx create-agents.ts <resource-group> <openai-name> <project-name>
```

**Agents Created**:
1. **quiz-question-generator** - Generates quiz questions from slides
2. **seating-position-analyzer** - Analyzes seating positions from photos

**Output**: Writes `.agent-config.env` with agent references.

---

## Static Web App Configuration

### SKU Requirements

| Feature | Free SKU | Standard SKU |
|---------|----------|--------------|
| Linked backends | ❌ | ✅ |
| Custom domains | ✅ | ✅ |
| Enterprise-grade CDN | ❌ | ✅ |

**Note**: Scripts use Standard SKU for linked backend support.

### Backend Linking

```bash
# Link Function App to Static Web App
az staticwebapp backends link \
  --name <swa-name> \
  --resource-group <rg> \
  --backend-resource-id <function-app-id> \
  --backend-region <location>
```

**Benefits**:
- No CORS configuration needed
- `/api/*` routes proxied automatically
- Authentication handled by backend

---

## SignalR CORS Configuration

**Process**:
1. Collect all SWA hostnames in resource group
2. Build deduplicated origin list
3. Update SignalR allowed origins
4. Verify configuration

```bash
az signalr cors update \
  --name <signalr-name> \
  --resource-group <rg> \
  --allowed-origins https://swa1.azurestaticapps.net https://swa2.azurestaticapps.net
```

---

## Foundry Project Setup

### RBAC Assignment

```bash
# Account scope
az role assignment create \
  --assignee-object-id <principal-id> \
  --role "Azure AI User" \
  --scope /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.CognitiveServices/accounts/<account>

# Project scope
az role assignment create \
  --assignee-object-id <principal-id> \
  --role "Azure AI User" \
  --scope /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.CognitiveServices/accounts/<account>/projects/<project>
```

### Tracing Connection

Creates Application Insights connection for agent tracing:

```bash
az rest --method put \
  --url "https://management.azure.com/.../connections/appinsights-tracing?api-version=2025-09-01" \
  --body '{
    "properties": {
      "category": "AppInsights",
      "authType": "ApiKey",
      "target": "<app-insights-id>",
      "credentials": { "key": "<instrumentation-key>" }
    }
  }'
```

---

## Error Handling

### Production (Fail-Fast)

```bash
# Single attempt, exit on failure
set -e
set -o pipefail

if [ $DEPLOY_EXIT -ne 0 ]; then
    echo "Deployment failed"
    exit 1
fi
```

### Development (Retry Logic)

```bash
MAX_INFRA_RETRIES=4
INFRA_ATTEMPT=0

while [ $INFRA_ATTEMPT -lt $MAX_INFRA_RETRIES ]; do
    # Attempt deployment
    if [ $DEPLOY_EXIT -eq 0 ]; then
        break
    fi
    
    # Handle specific errors
    if echo "$RESULT" | grep -q "IfMatchPreconditionFailed"; then
        recover_ifmatch_conflict
    fi
    
    sleep 20
done
```

### Common Error Handlers

| Error | Handler |
|-------|---------|
| `RoleAssignmentExists` | Ignore (idempotent) |
| `IfMatchPreconditionFailed` | Delete conflicting resource, retry |
| `DeploymentActive` | Wait or cancel existing deployment |

---

## Verification Steps

### External ID Login Verification

```bash
verify_external_id_login() {
    # Follow login redirect
    final_url=$(curl -s -L -o /dev/null -w '%{url_effective}' "$app_url/.auth/login/aad")
    
    # Check for common endpoint (fallback)
    if echo "$final_url" | grep -qi '/common/oauth2'; then
        return 1  # Auth misconfigured
    fi
    
    # Verify tenant ID in URL
    if [[ "$final_url" == *"$tenant_id"* ]] || [[ "$final_url" == *"ciamlogin.com"* ]]; then
        return 0  # Success
    fi
}
```

### Health Checks

```bash
# Function App
curl -s -o /dev/null -w "%{http_code}" "$FUNCTION_APP_URL/api/health"

# Static Web App
curl -s -o /dev/null -w "%{http_code}" "$STATIC_WEB_APP_URL"

# Database tables
az storage table list --connection-string "$CONN" --query "length(@)"
```

---

## Output Files

### deployment-output.json

Raw Bicep deployment output with all resource information.

### deployment-info.json

Structured deployment summary:

```json
{
  "environment": "production",
  "timestamp": "2026-03-05T10:30:00Z",
  "urls": {
    "frontend": "https://xxx.azurestaticapps.net",
    "backend": "https://func-xxx.azurewebsites.net"
  },
  "azure": {
    "resourceGroup": "rg-qr-attendance-prod",
    "functionApp": "func-qrattendance-prod",
    "storageAccount": "stqrattendanceprod",
    "staticWebApp": "swa-qrattendance-prod",
    "openAI": "openai-qrattendance-prod",
    "signalR": "signalr-qrattendance-prod"
  },
  "features": {
    "azureOpenAI": true,
    "signalR": true,
    "azureAD": true
  },
  "database": {
    "tables": 16,
    "storageAccount": "stqrattendanceprod"
  }
}
```

---

## Related Documentation

- [INFRASTRUCTURE_BICEP.md](./INFRASTRUCTURE_BICEP.md) - Bicep module details
- [SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md) - Overall architecture
- [../deployment/DEPLOYMENT_GUIDE.md](../deployment/DEPLOYMENT_GUIDE.md) - Deployment instructions
