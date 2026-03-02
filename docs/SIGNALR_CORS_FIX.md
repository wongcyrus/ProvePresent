# SignalR CORS Configuration Fix

## Problem

The teacher dashboard was experiencing CORS errors when trying to connect to SignalR:

```
Access to fetch at 'https://signalr-qrattendance-dev.service.signalr.net/client/negotiate?hub=dashboard...' 
from origin 'https://wonderful-tree-08b1a860f.1.azurestaticapps.net' has been blocked by CORS policy: 
Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header 
is present on the requested resource.
```

## Root Cause

The SignalR service had CORS set to `["*"]` (allow all), but Azure SignalR Service requires explicit origin configuration even when using wildcard. The Static Web App origins were not explicitly added to the allowed origins list.

## Solution Applied

### 1. Development Environment
Added Static Web App origin to SignalR CORS:
```bash
az signalr cors add \
  --name "signalr-qrattendance-dev" \
  --resource-group "rg-qr-attendance-dev" \
  --allowed-origins "https://wonderful-tree-08b1a860f.1.azurestaticapps.net"
```

**Result:**
```json
{
  "allowedOrigins": [
    "*",
    "https://wonderful-tree-08b1a860f.1.azurestaticapps.net"
  ]
}
```

### 2. Production Environment
Added Static Web App origin to SignalR CORS:
```bash
az signalr cors add \
  --name "signalr-qrattendance-prod" \
  --resource-group "rg-qr-attendance-prod" \
  --allowed-origins "https://victorious-flower-026cba00f.6.azurestaticapps.net"
```

**Result:**
```json
{
  "allowedOrigins": [
    "*",
    "https://victorious-flower-026cba00f.6.azurestaticapps.net"
  ]
}
```

## Automation Script

Created `fix-signalr-cors.sh` to automatically configure CORS for both environments:

```bash
./fix-signalr-cors.sh
```

This script:
1. Discovers Static Web App hostnames in each environment
2. Adds them to SignalR CORS allowed origins
3. Verifies the configuration

## How SignalR Connection Works

### Architecture Flow

```
Browser (Static Web App)
    ↓
    1. POST /api/sessions/{sessionId}/dashboard/negotiate
    ↓
Function App (negotiate endpoint)
    ↓
    2. Generates SignalR access token
    ↓
    3. Returns: { url: "https://signalr-xxx.service.signalr.net/client/?hub=dashboard...", accessToken: "..." }
    ↓
Browser receives connection info
    ↓
    4. Connects directly to SignalR Service (CORS check happens here!)
    ↓
SignalR Service
```

### Why CORS is Needed

Even though the negotiate happens through the Function App (which has proper CORS), the actual SignalR connection is made **directly from the browser to the SignalR service**. This is why SignalR needs its own CORS configuration.

## SignalR Configuration

### Current Settings

**Development (Free Tier):**
- Service Mode: Serverless
- Tier: Free_F1
- Capacity: 1 unit (20 connections, 20K messages/day)
- CORS: `["*", "https://wonderful-tree-08b1a860f.1.azurestaticapps.net"]`
- Public Network Access: Enabled

**Production (Standard Tier):**
- Service Mode: Serverless
- Tier: Standard_S1
- Capacity: 1 unit (1000 connections, 1M messages/day)
- CORS: `["*", "https://victorious-flower-026cba00f.6.azurestaticapps.net"]`
- Public Network Access: Enabled

## Testing

After applying the fix, test the SignalR connection:

1. Open the teacher dashboard
2. Navigate to an active session
3. Check browser console for SignalR connection status
4. Should see: `🟢 Live` status indicator
5. Real-time updates should work (student joins, chain updates, etc.)

## Future Improvements

### 1. Remove Wildcard CORS
For production, remove the `"*"` wildcard and only allow specific origins:

```bash
# Remove wildcard
az signalr cors remove \
  --name "signalr-qrattendance-prod" \
  --resource-group "rg-qr-attendance-prod" \
  --allowed-origins "*"
```

### 2. Update Bicep Template
Modify `infrastructure/modules/signalr.bicep` to accept Static Web App URL as parameter:

```bicep
@description('Static Web App URL for CORS')
param staticWebAppUrl string = ''

resource signalR 'Microsoft.SignalRService/signalR@2023-02-01' = if (deploySignalR) {
  // ...
  properties: {
    cors: {
      allowedOrigins: staticWebAppUrl != '' ? [staticWebAppUrl] : ['*']
    }
    // ...
  }
}
```

### 3. Automate in Deployment Scripts
Add CORS configuration to deployment scripts:

```bash
# In deploy-full-development.sh and deploy-full-production.sh
echo "Configuring SignalR CORS..."
./fix-signalr-cors.sh
```

## Troubleshooting

### CORS Error Still Occurs

1. **Check browser console** for exact error message
2. **Verify SignalR CORS settings:**
   ```bash
   az signalr cors list --name "signalr-qrattendance-dev" --resource-group "rg-qr-attendance-dev"
   ```
3. **Check Static Web App URL** matches exactly (including https://)
4. **Clear browser cache** and hard refresh (Ctrl+Shift+R)
5. **Check SignalR service status:**
   ```bash
   az signalr show --name "signalr-qrattendance-dev" --resource-group "rg-qr-attendance-dev" --query "provisioningState"
   ```

### Connection Timeout

1. Check SignalR service is running
2. Verify Function App has correct `SIGNALR_CONNECTION_STRING`
3. Check network ACLs allow client connections
4. Review SignalR logs in Azure Portal

### Token Errors

1. Verify negotiate endpoint returns valid token
2. Check token expiry (default 1 hour)
3. Ensure hub name is alphanumeric only (no hyphens)

## Related Files

- `backend/src/functions/negotiateDashboard.ts` - SignalR negotiate endpoint
- `frontend/src/components/TeacherDashboardWithTabs.tsx` - SignalR client connection
- `infrastructure/modules/signalr.bicep` - SignalR infrastructure
- `fix-signalr-cors.sh` - CORS configuration script

## References

- [Azure SignalR Service CORS Documentation](https://learn.microsoft.com/en-us/azure/azure-signalr/signalr-howto-cors)
- [SignalR Serverless Mode](https://learn.microsoft.com/en-us/azure/azure-signalr/concept-service-mode)
- [Static Web Apps Authentication](https://learn.microsoft.com/en-us/azure/static-web-apps/authentication-authorization)

---

**Fixed Date:** 2026-03-02
**Status:** ✅ Resolved
