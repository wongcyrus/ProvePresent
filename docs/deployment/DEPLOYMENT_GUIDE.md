# Production Deployment Guide

**Last Deployment**: February 11, 2026 at 12:33 UTC  
**Status**: ✅ Live and Running

---

## Quick Start

### First Time Setup

**1. Create Azure AD App Registration**
```bash
./setup-azure-ad-app.sh
```

This creates the Azure AD app and saves credentials to `.external-id-credentials`.

**2. Deploy to Production**
```bash
source .external-id-credentials
./deploy-full-production.sh
```

### Subsequent Deployments

```bash
source .external-id-credentials
./deploy-full-production.sh
```

### Clean Up Everything

**Delete Azure resources:**
```bash
./cleanup-production.sh
```

**Delete Azure AD app:**
```bash
./cleanup-azure-ad-app.sh
```

Or delete both at once:
```bash
./cleanup-production.sh && ./cleanup-azure-ad-app.sh
```

### Verify Deployment
```bash
./verify-production.sh
```

### Access Production
- **Frontend**: https://ashy-desert-0fc9a700f.6.azurestaticapps.net
- **Backend**: https://func-qrattendance-prod.azurewebsites.net

---

## Current Production Configuration

### Azure Resources
| Resource | Name | Tier/SKU | Status |
|----------|------|----------|--------|
| SignalR | signalr-qrattendance-prod | Standard S1 (1000 connections) | ✅ Active |
| Azure OpenAI | openai-qrattendance-prod | S0 (AIServices, API 2024-10-01) | ✅ Active |
| Function App | func-qrattendance-prod | Consumption (44 functions) | ✅ Running |
| Static Web App | swa-qrattendance-prod2 | Free | ✅ Running |
| Storage | stqrattendanceprod | Standard LRS (12 tables) | ✅ Active |

### Cost
**Estimated**: ~$55-70/month
- SignalR Standard S1: ~$50/month
- Azure OpenAI: ~$5-20/month (usage-based)
- Other services: Minimal

---

## Deployment Process

### Prerequisites
```bash
# Check required tools
az --version          # Azure CLI
func --version        # Azure Functions Core Tools
npm --version         # Node.js
jq --version          # JSON processor

# Login to Azure
az login
```

### Complete Deployment Workflow

**Step 1: Create Azure AD App (First Time Only)**
```bash
./setup-azure-ad-app.sh
```

This script will:
- Check for existing "QR Chain Attendance" app
- Create new app or reuse existing one
- Configure redirect URIs for Static Web App
- Create client secret (2-year expiry)
- Save credentials to `.external-id-credentials` (preferred)

**Step 2: Deploy Infrastructure and Application**
```bash
source .external-id-credentials
./deploy-full-production.sh
```

**Duration**: 10-15 minutes

**What it does**:
- Creates resource group
- Deploys infrastructure (Storage, SignalR S1, Functions, OpenAI, Static Web App)
- Builds and deploys backend (44 functions)
- Creates database tables (12 tables)
- Configures CORS
- Configures Azure AD authentication (Client ID, Secret, Tenant ID)
- Builds and deploys frontend
- Verifies deployment

**Step 3: Verify Deployment**
```bash
./verify-production.sh
```

**Checks**:
- ✅ SignalR Standard S1 tier
- ✅ Function App running
- ✅ Azure OpenAI (AIServices kind)
- ✅ Static Web App deployed
- ✅ All 12 tables created
- ✅ Azure AD configured

**Step 4: Test Production**
- ✅ All 12 tables created
- ✅ SignalR connection configured

**Step 4: Test Production**
1. Wait 2-3 minutes for Azure AD settings to propagate
2. Open: https://ashy-desert-0fc9a700f.6.azurestaticapps.net
3. You should be redirected to Azure AD login
4. Login with VTC credentials
5. Check browser console for "SignalR connected"
6. Create a session and test quiz feature

### Clean Up Production

**Delete all Azure resources:**
```bash
./cleanup-production.sh
```

**Delete Azure AD app registration:**
```bash
./cleanup-azure-ad-app.sh
```

**Delete everything:**
```bash
./cleanup-production.sh && ./cleanup-azure-ad-app.sh
```

This ensures complete cleanup with no lingering resources or AD apps.

---

## Recent Fixes & Improvements

### February 11, 2026 Deployment

**Infrastructure Updates**:
- ✅ Updated Azure OpenAI to API 2024-10-01 with AIServices kind
- ✅ Enabled SignalR Standard S1 tier (1000 connections)
- ✅ Fixed deployment JSON parsing with better error handling
- ✅ Made SignalR optional (can disable to save costs)

**Backend Improvements**:
- ✅ Cleaned up quiz broadcasting code
- ✅ Removed unused fair selection algorithm
- ✅ Improved logging for SignalR broadcasts
- ✅ Fixed quiz question expiry filtering

**Frontend Optimizations**:
- ✅ Reduced API polling (5s quiz, 15s status)
- ✅ Proper SignalR connection detection
- ✅ Auth header caching (30 minutes)
- ✅ Automatic fallback to polling if SignalR unavailable

---

## SignalR Configuration

### Current Setup: Standard S1 (Enabled)

**Capacity**:
- 1,000 concurrent connections
- 1,000,000 messages per day
- Cost: ~$50/month

**Benefits**:
- Real-time quiz delivery (<1 second)
- Instant session updates
- Supports large classes

**Fallback**:
- System automatically falls back to polling if SignalR unavailable
- Quiz polling: 5 seconds
- Status polling: 15 seconds

### To Disable SignalR (Save $50/month)

Edit `infrastructure/parameters/prod.bicepparam`:
```bicep
param deploySignalR = false
```

Then redeploy:
```bash
./deploy-full-production.sh
```

**Trade-off**: 5-second average latency vs instant delivery

---

## Troubleshooting

### 403 Forbidden Error

**Problem**: Getting "403: Forbidden - You don't have permissions for this page"

**Cause**: Azure AD authentication not configured properly

**Solution**:
```bash
# Check if AAD_CLIENT_SECRET is set
az staticwebapp appsettings list \
  --name swa-qrattendance-prod2 \
  --resource-group rg-qr-attendance-prod \
  --query "properties.{AAD_CLIENT_ID:AAD_CLIENT_ID, TENANT_ID:TENANT_ID}"

# If AAD_CLIENT_SECRET is empty, configure it:
./configure-azure-ad.sh <your-client-secret>
```

**Get the client secret**:
1. Azure Portal > Azure Active Directory > App registrations
2. Find app: `dc482c34-ebaa-4239-aca3-2810a4f51728`
3. Certificates & secrets > New client secret
4. Copy the value and run the configure script

### Deployment Issues

**Problem**: jq parsing error during deployment

**Solution**: Script has automatic fallback to query Azure directly. If you see this error, the script will continue and retrieve outputs from Azure.

**Problem**: SignalR not connecting

**Check**:
```bash
# Verify SignalR tier
az signalr show \
  --name signalr-qrattendance-prod \
  --resource-group rg-qr-attendance-prod \
  --query "sku"
```

**Expected**: Standard S1

**Problem**: Quiz questions not appearing

**Check**:
1. Browser console - SignalR status
2. Network tab - API calls
3. Function logs - broadcast messages

**Solution**: System should fall back to polling automatically (5-second intervals)

### View Logs
```bash
# Function App logs
az functionapp log tail \
  --name func-qrattendance-prod \
  --resource-group rg-qr-attendance-prod

# SignalR metrics
az signalr show \
  --name signalr-qrattendance-prod \
  --resource-group rg-qr-attendance-prod
```

---

## Performance

### With SignalR Standard S1 (Current)
- Quiz delivery: <1 second
- Status updates: <1 second
- Concurrent students: Up to 1,000
- API calls: ~12/student/hour

### Fallback Mode (If SignalR Unavailable)
- Quiz delivery: 0-5 seconds (avg 2.5s)
- Status updates: 0-15 seconds (avg 7.5s)
- Concurrent students: Unlimited
- API calls: ~360/student/hour

---

## Database Schema

**12 Tables** in Azure Table Storage:
1. Sessions - Class sessions
2. Attendance - Student attendance records
3. Chains - QR chain state
4. Tokens - QR tokens for chain passing
5. UserSessions - User session tracking
6. AttendanceSnapshots - Instant attendance captures
7. ChainHistory - Chain scan history
8. ScanLogs - Detailed scan logs
9. QuizQuestions - Generated quiz questions
10. QuizResponses - Student answers
11. QuizMetrics - Quiz performance metrics
12. DeletionLog - Deletion audit trail

---

## Monitoring

### Set Up Alerts
```bash
# SignalR connection failures
az monitor metrics alert create \
  --name "SignalR Connection Failures" \
  --resource-group rg-qr-attendance-prod \
  --scopes $(az signalr show --name signalr-qrattendance-prod --resource-group rg-qr-attendance-prod --query id -o tsv) \
  --condition "count ConnectionCloseCount > 10" \
  --window-size 5m

# Function App errors
az monitor metrics alert create \
  --name "Function App Errors" \
  --resource-group rg-qr-attendance-prod \
  --scopes $(az functionapp show --name func-qrattendance-prod --resource-group rg-qr-attendance-prod --query id -o tsv) \
  --condition "count Http5xx > 10" \
  --window-size 5m
```

### Cost Management
```bash
# Set budget alert
az consumption budget create \
  --budget-name "QR-Attendance-Monthly" \
  --amount 100 \
  --time-grain Monthly \
  --resource-group rg-qr-attendance-prod
```

---

## Additional Documentation

- **System Architecture**: `SYSTEM_ARCHITECTURE.md`
- **Database Details**: `DATABASE_TABLES.md`
- **Live Quiz Feature**: `LIVE_QUIZ.md`
- **Security Guidelines**: `SECURITY.md`
- **Local Development**: `LOCAL_DEVELOPMENT.md`
- **All Documentation**: `DOCUMENTATION_INDEX.md`

---

## Quick Commands

```bash
# Deploy production
./deploy-full-production.sh

# Verify deployment
./verify-production.sh

# Check SignalR status
az signalr show --name signalr-qrattendance-prod --resource-group rg-qr-attendance-prod

# Check Function App
az functionapp show --name func-qrattendance-prod --resource-group rg-qr-attendance-prod

# View logs
az functionapp log tail --name func-qrattendance-prod --resource-group rg-qr-attendance-prod

# List all resources
az resource list --resource-group rg-qr-attendance-prod --output table
```

---

**Production is live and ready to use!** 🚀
