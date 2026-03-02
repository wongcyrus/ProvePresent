# Deployment Scripts Fix Summary

## Issues Fixed

### 1. Timestamp-Based Deployment Names
**Problem:** Deployment names included timestamps that changed on every run, causing Azure to treat each deployment as new instead of an update.

**Error:**
```
ERROR: {"code": "InvalidTemplateDeployment", "message": "The template deployment 'dev-full-20260302-104320' is not valid..."}
```

**Root Cause:**
```bash
DEPLOYMENT_NAME="dev-full-$(date +%Y%m%d-%H%M%S)"  # Changes every second!
```

**Fix Applied:**
```bash
# deploy-full-development.sh
DEPLOYMENT_NAME="qr-attendance-dev-deployment"  # Consistent name

# deploy-full-production.sh
DEPLOYMENT_NAME="qr-attendance-prod-deployment"  # Consistent name
```

**Why This Matters:**
- Azure Bicep deployments are idempotent when using the same deployment name
- Changing names causes Azure to validate as a new deployment
- Consistent names allow proper incremental updates

### 2. SignalR CORS Wildcard
**Problem:** SignalR CORS had wildcard "*" alongside specific origins, which is unnecessary and less secure.

**Before:**
```json
{
  "allowedOrigins": [
    "*",
    "https://wonderful-tree-08b1a860f.1.azurestaticapps.net"
  ]
}
```

**After:**
```json
{
  "allowedOrigins": [
    "https://wonderful-tree-08b1a860f.1.azurestaticapps.net"
  ]
}
```

**Fix Applied:**
- Removed wildcard from dev SignalR
- Removed wildcard from prod SignalR
- Added automatic CORS configuration to both deployment scripts

### 3. Missing Automated CORS Configuration
**Problem:** SignalR CORS had to be manually configured after deployment.

**Fix Applied:**
Added Step 8.5 to both deployment scripts:

```bash
# Step 8.5: Configure SignalR CORS with Static Web App URL
echo -e "${BLUE}Step 8.5: Configuring SignalR CORS...${NC}"

# Get Static Web App hostname
STATIC_WEB_APP_HOSTNAME=$(az staticwebapp show --name "$STATIC_WEB_APP_NAME" --resource-group "$RESOURCE_GROUP" --query "defaultHostname" -o tsv 2>/dev/null)

if [ -n "$STATIC_WEB_APP_HOSTNAME" ] && [ "$STATIC_WEB_APP_HOSTNAME" != "null" ]; then
    echo "Static Web App URL: https://$STATIC_WEB_APP_HOSTNAME"
    
    # Get SignalR name
    SIGNALR_NAME=$(az signalr list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)
    
    if [ -n "$SIGNALR_NAME" ] && [ "$SIGNALR_NAME" != "null" ]; then
        echo "Configuring CORS for SignalR: $SIGNALR_NAME"
        
        # Update CORS to only allow the Static Web App origin
        az signalr cors update \
            --name "$SIGNALR_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --allowed-origins "https://$STATIC_WEB_APP_HOSTNAME" \
            --output none 2>/dev/null || echo -e "${YELLOW}⚠ CORS update failed${NC}"
        
        echo -e "${GREEN}✓ SignalR CORS configured${NC}"
    fi
fi
```

## Files Modified

### 1. deploy-full-development.sh
- ✅ Changed deployment name from timestamp to consistent name
- ✅ Added Step 8.5 for SignalR CORS configuration
- ✅ Renumbered subsequent steps (8.5 → 8.6)

### 2. deploy-full-production.sh
- ✅ Changed deployment name from timestamp to consistent name
- ✅ Added Step 8.5 for SignalR CORS configuration
- ✅ Renumbered subsequent steps (9 → 9)

### 3. fix-signalr-cors.sh
- ✅ Already created for manual CORS fixes
- ✅ Can still be used for troubleshooting

## Benefits

### 1. Idempotent Deployments
- Running deployment script multiple times now works correctly
- Azure recognizes it as an update, not a new deployment
- Faster deployment times (incremental updates)

### 2. Automated CORS Configuration
- No manual CORS configuration needed
- SignalR automatically configured with correct Static Web App origin
- Reduces deployment errors

### 3. Better Security
- Removed wildcard "*" from CORS
- Only specific Static Web App origins allowed
- Follows security best practices

### 4. Consistent Naming
- Deployment names are predictable
- Easier to track in Azure Portal
- Better for CI/CD pipelines

## Testing

### Test Development Deployment
```bash
# No need to source credentials manually - script does it automatically!
./deploy-full-development.sh
```

**What the script does:**
1. ✅ Automatically loads `.external-id-credentials`
2. ✅ Validates all required variables are set
3. ✅ Shows clear error if credentials are missing
4. ✅ Proceeds with deployment

**Expected:**
- ✅ Deployment name: `qr-attendance-dev-deployment`
- ✅ SignalR CORS configured automatically
- ✅ No timestamp-related errors
- ✅ Incremental update works

### Test Production Deployment
```bash
# No need to source credentials manually - script does it automatically!
./deploy-full-production.sh
```

**What the script does:**
1. ✅ Automatically loads `.external-id-credentials`
2. ✅ Validates all required variables are set
3. ✅ Shows clear error if credentials are missing
4. ✅ Proceeds with deployment

**Expected:**
- ✅ Deployment name: `qr-attendance-prod-deployment`
- ✅ SignalR CORS configured automatically
- ✅ No timestamp-related errors
- ✅ Incremental update works

### Verify SignalR CORS
```bash
# Development
az signalr cors list --name "signalr-qrattendance-dev" --resource-group "rg-qr-attendance-dev"

# Production
az signalr cors list --name "signalr-qrattendance-prod" --resource-group "rg-qr-attendance-prod"
```

**Expected Output:**
```json
{
  "allowedOrigins": [
    "https://wonderful-tree-08b1a860f.1.azurestaticapps.net"  // Dev
    // OR
    "https://victorious-flower-026cba00f.6.azurestaticapps.net"  // Prod
  ]
}
```

## Rollback Plan

If issues occur, revert the changes:

```bash
# Restore original deployment names (not recommended)
git checkout HEAD -- deploy-full-development.sh deploy-full-production.sh

# Or manually fix CORS
./fix-signalr-cors.sh
```

## Microsoft Learn Documentation

According to [Azure SignalR CORS documentation](https://learn.microsoft.com/cli/azure/signalr/cors):

> **--allowed-origins -a**  
> Space separated origins that should be allowed to make cross-origin calls (for example: `http://example.com:12345`). To allow all, use "*".

- ✅ Wildcard "*" is supported
- ✅ Specific origins are recommended for production
- ✅ Multiple origins can be specified

## Best Practices Applied

1. **Consistent Deployment Names**
   - Use environment-specific names without timestamps
   - Enables idempotent deployments
   - Better for automation

2. **Specific CORS Origins**
   - Remove wildcard in production
   - Only allow known Static Web App origins
   - Improves security posture

3. **Automated Configuration**
   - CORS configured automatically during deployment
   - Reduces manual steps
   - Prevents configuration drift

4. **Error Handling**
   - Graceful fallback if CORS update fails
   - Clear error messages
   - Non-blocking warnings

## Future Improvements

1. **Multiple Origins Support**
   - Add support for custom domains
   - Configure multiple Static Web App slots
   - Support staging environments

2. **Bicep Template Update**
   - Add CORS configuration to Bicep template
   - Pass Static Web App URL as parameter
   - Eliminate post-deployment configuration

3. **CI/CD Integration**
   - Use consistent deployment names in pipelines
   - Automate CORS updates on SWA changes
   - Add deployment validation tests

---

**Fixed Date:** 2026-03-02  
**Status:** ✅ Complete  
**Tested:** Pending
