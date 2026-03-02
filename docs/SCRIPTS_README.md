# Deployment Scripts Guide

Complete guide to all deployment and management scripts.

---

## Azure AD Management

### setup-azure-ad-app.sh
**Purpose**: Create or configure Azure AD app registration for authentication

**Usage**:
```bash
./setup-azure-ad-app.sh
```

**What it does**:
- Checks for existing "QR Chain Attendance" app
- Creates new app or reuses existing one
- Configures redirect URIs for ALL environments:
  - Production: `https://ashy-desert-0fc9a700f.6.azurestaticapps.net/.auth/login/aad/callback`
  - Local dev: `http://localhost:3000/.auth/login/aad/callback`
  - SWA CLI: `http://localhost:4280/.auth/login/aad/callback`
- Creates 2-year client secret
- Saves credentials to `.external-id-credentials`

**Output**:
- `.external-id-credentials` file with environment variables
- Client ID, Secret, and Tenant ID
- Single app works for dev, staging, and production

**When to use**:
- First time setup (creates app for all environments)
- When client secret expires (every 2 years)
- When updating redirect URIs

**Best Practice**: Use ONE Azure AD app for all environments by configuring multiple redirect URIs

---

### add-redirect-uri.sh
**Purpose**: Add additional redirect URI to existing Azure AD app

**Usage**:
```bash
# Interactive
source .external-id-credentials
./add-redirect-uri.sh

# Direct
./add-redirect-uri.sh <client-id> <redirect-uri>

# Example: Add staging environment
./add-redirect-uri.sh dc482c34-ebaa-4239-aca3-2810a4f51728 \
  "https://my-staging-app.azurestaticapps.net/.auth/login/aad/callback"
```

**What it does**:
- Shows current redirect URIs
- Adds new URI without removing existing ones
- Verifies URI was added

**When to use**:
- Adding new environment (staging, testing)
- Adding new Static Web App URL
- Supporting multiple deployment targets

---

### cleanup-azure-ad-app.sh
**Purpose**: Delete Azure AD app registration

**Usage**:
```bash
# Interactive (searches by name)
./cleanup-azure-ad-app.sh

# Direct (by Client ID)
./cleanup-azure-ad-app.sh <client-id>
```

**What it does**:
- Finds app by name or uses provided Client ID
- Shows app details for confirmation
- Deletes app registration
- Removes `.external-id-credentials` file (when matching app ID)

**When to use**:
- Complete cleanup after deleting production
- Removing old/unused app registrations
- Starting fresh with new app

---

## Production Deployment

### deploy-full-production.sh
**Purpose**: Deploy complete production environment

**Usage**:
```bash
# Preferred credentials file
source .external-id-credentials
./deploy-full-production.sh

# Or with environment variables
export AAD_CLIENT_ID="..."
export AAD_CLIENT_SECRET="..."
./deploy-full-production.sh

# Interactive (prompts for credentials)
./deploy-full-production.sh
```

**Duration**: 10-15 minutes

**Credential loading order**:
1. `.external-id-credentials` (preferred)

**What it deploys**:
1. Resource group
2. Storage account (12 tables)
3. SignalR Standard S1
4. Azure OpenAI (gpt-4o, gpt-4o-vision)
5. Function App (44 functions)
6. Static Web App
7. Azure AD configuration
8. CORS settings

**Output files**:
- `deployment-output.json` - Raw deployment output
- `deployment-info.json` - Deployment summary
- `frontend/.env.production` - Frontend config

**When to use**:
- Initial production deployment
- Redeploying after infrastructure changes
- Updating to new Bicep templates

---

### cleanup-production.sh
**Purpose**: Delete all Azure resources

**Usage**:
```bash
./cleanup-production.sh
```

**What it deletes**:
- Entire resource group (rg-qr-attendance-prod)
- All resources within the group
- Local deployment files

**What it keeps**:
- Azure AD app registration (delete separately)
- Source code
- Configuration files

**When to use**:
- Tearing down production environment
- Starting fresh deployment
- Cost savings (deletes all billable resources)

**Note**: Azure AD app persists - use `cleanup-azure-ad-app.sh` to remove it

---

## Configuration

### configure-azure-ad.sh
**Purpose**: Update Azure AD credentials on existing Static Web App

**Usage**:
```bash
./configure-azure-ad.sh <client-id> <client-secret>
```

**What it does**:
- Updates Static Web App settings
- Sets AAD_CLIENT_ID, AAD_CLIENT_SECRET, TENANT_ID
- Verifies configuration

**When to use**:
- Fixing 403 Forbidden errors
- Rotating client secrets
- Updating credentials without full redeployment

---

## Verification

### verify-production.sh
**Purpose**: Check production deployment status

**Usage**:
```bash
./verify-production.sh
```

**What it checks**:
- ✅ SignalR tier (Standard S1)
- ✅ Function App state (Running)
- ✅ Azure OpenAI provisioning
- ✅ Static Web App deployment
- ✅ Table count (12 tables)
- ✅ SignalR connection string

**When to use**:
- After deployment
- Troubleshooting issues
- Verifying configuration

---

## Complete Workflows

### First Time Deployment
```bash
# 1. Create Azure AD app
./setup-azure-ad-app.sh

# 2. Deploy everything
source .external-id-credentials
./deploy-full-production.sh

# 3. Verify
./verify-production.sh

# 4. Test
# Open: https://ashy-desert-0fc9a700f.6.azurestaticapps.net
```

---

### Update Deployment
```bash
# Use existing credentials
source .external-id-credentials
./deploy-full-production.sh
```

---

### Complete Cleanup
```bash
# 1. Delete Azure resources
./cleanup-production.sh

# 2. Delete Azure AD app
./cleanup-azure-ad-app.sh

# 3. Clean local files
rm .external-id-credentials
rm deployment-*.json
rm frontend/.env.production
```

---

### Fix 403 Error
```bash
# Option 1: Reconfigure existing app
./configure-azure-ad.sh <client-id> <client-secret>

# Option 2: Create new app and redeploy
./setup-azure-ad-app.sh
source .external-id-credentials
./deploy-full-production.sh
```

---

### Rotate Client Secret
```bash
# 1. Create new secret in Azure Portal
# 2. Update Static Web App
./configure-azure-ad.sh <client-id> <new-secret>

# 3. Update credentials file
./setup-azure-ad-app.sh  # Reuse existing app
```

---

## File Reference

### Generated Files

**`.external-id-credentials`**
- Contains: AAD_CLIENT_ID, AAD_CLIENT_SECRET, TENANT_ID
- Created by: `setup-azure-ad-app.sh`
- Usage: `source .external-id-credentials`
- Security: In .gitignore, chmod 600

**`deployment-output.json`**
- Contains: Raw Azure deployment output
- Created by: `deploy-full-production.sh`
- Usage: Parsed for resource names and URLs

**`deployment-info.json`**
- Contains: Deployment summary (URLs, names, dates)
- Created by: `deploy-full-production.sh`
- Usage: Reference for deployed resources

**`frontend/.env.production`**
- Contains: Frontend environment variables
- Created by: `deploy-full-production.sh`
- Usage: Next.js production build

---

## Troubleshooting

### "App already exists"
```bash
# Reuse existing app
./setup-azure-ad-app.sh
# Choose "yes" when prompted

# Or delete and recreate
./cleanup-azure-ad-app.sh
./setup-azure-ad-app.sh
```

### "Invalid JSON in deployment-output.json"
- Script has automatic fallback
- Queries Azure directly for outputs
- Should continue without manual intervention

### "403 Forbidden"
```bash
# Check if credentials are set
az staticwebapp appsettings list \
  --name swa-qrattendance-prod2 \
  --resource-group rg-qr-attendance-prod

# Reconfigure
./configure-azure-ad.sh <client-id> <client-secret>
```

### "SignalR not connecting"
```bash
# Check tier
az signalr show \
  --name signalr-qrattendance-prod \
  --resource-group rg-qr-attendance-prod \
  --query "sku"

# Should be: Standard_S1
```

---

## Security Best Practices

1. **Never commit credentials**
   - `.external-id-credentials` is in .gitignore
   - Always use environment variables or secure files

2. **Rotate secrets regularly**
   - Client secrets expire in 2 years
   - Set calendar reminder to rotate

3. **Use least privilege**
   - Azure AD app only has User.Read permission
   - Function App uses managed identity

4. **Audit access**
   - Check Azure AD sign-in logs
   - Monitor Function App logs

5. **Backup credentials**
   - Store client secret in Azure Key Vault
   - Document Client ID in secure location

---

## Cost Management

### Current Costs (~$55-70/month)
- SignalR Standard S1: ~$50/month
- Azure OpenAI: ~$5-20/month (usage-based)
- Other services: Minimal (consumption-based)

### Cost Optimization

**Disable SignalR** (saves $50/month):
```bash
# Edit infrastructure/parameters/prod.bicepparam
param deploySignalR = false

# Redeploy
source .external-id-credentials
./deploy-full-production.sh
```

**Delete when not in use**:
```bash
./cleanup-production.sh
# Redeploy when needed
```

---

## Support

For issues or questions:
1. Check `DEPLOYMENT_GUIDE.md`
2. Check `DOCUMENTATION_INDEX.md`
3. Review Azure Portal logs
4. Check Function App logs: `az functionapp log tail`

