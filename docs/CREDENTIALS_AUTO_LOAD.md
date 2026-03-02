# Automatic Credentials Loading

## Problem

Previously, users had to manually source credentials before running deployment scripts:

```bash
source .external-id-credentials  # Manual step - easy to forget!
./deploy-full-development.sh
```

This was:
- ❌ Easy to forget
- ❌ Not user-friendly
- ❌ Caused confusing errors if skipped
- ❌ Required understanding of bash sourcing

## Solution

Both deployment scripts now automatically load credentials with clear validation:

```bash
# Just run the script - credentials loaded automatically!
./deploy-full-development.sh
./deploy-full-production.sh
```

## How It Works

### Step 0: Load and Validate Credentials

Both scripts now include this at the beginning:

```bash
# Step 0: Load and validate credentials
echo -e "${BLUE}Step 0: Loading credentials...${NC}"

# Check if credentials file exists
if [ ! -f ".external-id-credentials" ]; then
    echo -e "${RED}✗ Missing .external-id-credentials file${NC}"
    echo ""
    echo "This file must exist in the project root and contain:"
    echo "  - AAD_CLIENT_ID"
    echo "  - AAD_CLIENT_SECRET"
    echo "  - TENANT_ID"
    echo "  - EXTERNAL_ID_ISSUER"
    echo ""
    echo "Please create this file before running deployment."
    exit 1
fi

# Load credentials
echo "Loading credentials from .external-id-credentials..."
source ./.external-id-credentials

# Validate required variables
if [ -z "$AAD_CLIENT_ID" ] || [ -z "$AAD_CLIENT_SECRET" ] || [ -z "$TENANT_ID" ]; then
    echo -e "${RED}✗ Missing required credentials in .external-id-credentials${NC}"
    echo ""
    echo "Required variables:"
    echo "  - AAD_CLIENT_ID: ${AAD_CLIENT_ID:-NOT SET}"
    echo "  - AAD_CLIENT_SECRET: ${AAD_CLIENT_SECRET:-NOT SET}"
    echo "  - TENANT_ID: ${TENANT_ID:-NOT SET}"
    exit 1
fi

echo -e "${GREEN}✓ Credentials loaded successfully${NC}"
echo "  Tenant ID: $TENANT_ID"
echo "  Client ID: ${AAD_CLIENT_ID:0:8}..."
```

## Benefits

### 1. User-Friendly
- ✅ No manual sourcing required
- ✅ Just run the script
- ✅ Works like any other script

### 2. Clear Error Messages
If credentials are missing, you get a helpful error:

```
✗ Missing .external-id-credentials file

This file must exist in the project root and contain:
  - AAD_CLIENT_ID
  - AAD_CLIENT_SECRET
  - TENANT_ID
  - EXTERNAL_ID_ISSUER

Please create this file before running deployment.
```

### 3. Validation
The script validates that all required variables are set:

```
✗ Missing required credentials in .external-id-credentials

Required variables:
  - AAD_CLIENT_ID: NOT SET
  - AAD_CLIENT_SECRET: NOT SET
  - TENANT_ID: NOT SET
```

### 4. Confirmation
When successful, you see confirmation:

```
✓ Credentials loaded successfully
  Tenant ID: 12345678-1234-1234-1234-123456789abc
  Client ID: abcd1234...
```

## Usage

### Before (Old Way)
```bash
# Step 1: Source credentials manually
source .external-id-credentials

# Step 2: Run deployment
./deploy-full-development.sh
```

### After (New Way)
```bash
# Just run it - credentials loaded automatically!
./deploy-full-development.sh
```

## Files Modified

1. ✅ `deploy-full-development.sh` - Added automatic credential loading
2. ✅ `deploy-full-production.sh` - Added automatic credential loading
3. ✅ `DEPLOYMENT_SCRIPTS_FIX.md` - Updated documentation
4. ✅ `CREDENTIALS_AUTO_LOAD.md` - This file

## Credential File Format

The `.external-id-credentials` file should contain:

```bash
# Azure AD / External ID Configuration
export AAD_CLIENT_ID="your-client-id"
export AAD_CLIENT_SECRET="your-client-secret"
export TENANT_ID="your-tenant-id"
export EXTERNAL_ID_ISSUER="https://your-tenant.ciamlogin.com/your-tenant-id/v2.0"

# Optional: Azure subscription (if not using default)
# export AZURE_SUBSCRIPTION_ID="your-subscription-id"
```

## Security Notes

### File Location
- ✅ Must be in project root (same directory as deployment scripts)
- ✅ Should be in `.gitignore` (already configured)
- ✅ Never commit this file to version control

### File Permissions
Recommended permissions:
```bash
chmod 600 .external-id-credentials  # Owner read/write only
```

### Template File
A template is provided:
```bash
cp .external-id-credentials.template .external-id-credentials
# Edit with your actual credentials
```

## Troubleshooting

### Error: "Missing .external-id-credentials file"
**Solution:** Create the file in the project root:
```bash
cp .external-id-credentials.template .external-id-credentials
# Edit with your credentials
```

### Error: "Missing required credentials"
**Solution:** Ensure all variables are set in the file:
```bash
cat .external-id-credentials
# Check that AAD_CLIENT_ID, AAD_CLIENT_SECRET, and TENANT_ID are set
```

### Error: "Permission denied"
**Solution:** Make the deployment script executable:
```bash
chmod +x deploy-full-development.sh
chmod +x deploy-full-production.sh
```

## Comparison with Other Scripts

### Scripts That Auto-Load Credentials ✅
- `deploy-full-development.sh` ✅
- `deploy-full-production.sh` ✅

### Scripts That Still Need Manual Sourcing ⚠️
- `deploy-backend-only.sh` - Quick backend updates
- `deploy-frontend-only.sh` - Quick frontend updates
- `fix-signalr-cors.sh` - CORS configuration

**Why?** These are quick utility scripts that assume you're already in a deployment session. They can be updated if needed.

## Future Improvements

1. **Update All Scripts**
   - Add auto-loading to backend-only script
   - Add auto-loading to frontend-only script
   - Add auto-loading to utility scripts

2. **Credential Validation**
   - Check if credentials are expired
   - Validate Azure login status
   - Test connectivity before deployment

3. **Environment Detection**
   - Auto-detect dev vs prod from script name
   - Load environment-specific credentials
   - Support multiple credential files

---

**Updated:** 2026-03-02  
**Status:** ✅ Complete  
**Applies To:** deploy-full-development.sh, deploy-full-production.sh
