# Security Guidelines

Complete security guide for the QR Chain Attendance System.

---

## Git Security - VERIFIED ✓

### Files Properly Ignored

All sensitive files are correctly ignored by `.gitignore`:
- `.env`, `.env.local` - Environment variables
- `backend/local.settings.json` - Azure Functions settings
- `*.secret` - Secret files
- `deployment*.log`, `deployment*.json` - Deployment outputs
- `github-token.txt` - GitHub tokens
- `credential.json`, `ad-apps.json` - Azure credentials

### Safe to Commit

**Public Values** (in `frontend/.env.production`):
- `NEXT_PUBLIC_AAD_CLIENT_ID` - Azure AD Client ID (public)
- `NEXT_PUBLIC_AAD_TENANT_ID` - Azure AD Tenant ID (public)
- `NEXT_PUBLIC_API_URL` - Public API endpoint
- `NEXT_PUBLIC_SIGNALR_URL` - Public SignalR endpoint

These are meant to be exposed to browsers and are safe to commit.

**Template Files**:
- `backend/local.settings.json.template` - Placeholders only
- `backend/.env.example` - Documentation only

### Never Commit

**Secrets** (must never be in Git):
- `AAD_CLIENT_SECRET` - Azure AD client secret
- `AZURE_OPENAI_KEY` - OpenAI API key
- `SIGNALR_CONNECTION_STRING` - SignalR connection (contains AccessKey)
- `STORAGE_ACCOUNT_KEY` - Storage access key
- `AzureWebJobsStorage` - Storage connection string

---

## Verification Commands

### Check Git Ignore
```bash
# Verify files are ignored
git check-ignore -v .env frontend/.env.local backend/local.settings.json

# Find tracked sensitive files
git ls-files | grep -E '\.(env|secret|key|credential|token)' | grep -v '.example' | grep -v '.template'

# Should only return: frontend/.env.production (which is safe)
```

### Check for Secrets
```bash
# Search for potential secrets in tracked files
git ls-files | xargs grep -l "password\|secret\|key" 2>/dev/null | grep -v ".md"

# Check Git history
git log --all --full-history --source --find-renames --diff-filter=D -- "*.env" "local.settings.json"
```

---

## Azure Security

### Managed Identity (Recommended)

Use Managed Identity instead of connection strings in production:

```bash
# Enable Managed Identity
az functionapp identity assign \
  --name func-qrattendance-prod \
  --resource-group rg-qr-attendance-prod

# Grant access to Storage
az role assignment create \
  --assignee <managed-identity-id> \
  --role "Storage Table Data Contributor" \
  --scope /subscriptions/.../stqrattendanceprod
```

### Key Vault (Recommended)

Store secrets in Azure Key Vault:

```bash
# Create Key Vault
az keyvault create \
  --name kv-qrattendance-prod \
  --resource-group rg-qr-attendance-prod

# Store secret
az keyvault secret set \
  --vault-name kv-qrattendance-prod \
  --name "OpenAI-Key" \
  --value "your-key"

# Reference in Function App
az functionapp config appsettings set \
  --name func-qrattendance-prod \
  --resource-group rg-qr-attendance-prod \
  --settings AZURE_OPENAI_KEY="@Microsoft.KeyVault(SecretUri=https://kv-qrattendance-prod.vault.azure.net/secrets/OpenAI-Key/)"
```

---

## Session Security

### QR Code Requirements

**Students MUST scan QR code to initially join sessions.**

**First Time Join**:
1. Student scans teacher's entry QR code
2. Backend validates token (10-second expiry)
3. Student marked as joined
4. Session ID stored in localStorage

**After Refresh**:
1. localStorage restores session view
2. No QR code needed (already joined)
3. Cannot join new sessions without QR code

### Token Security

**QR Tokens**:
- Encrypted with `QR_ENCRYPTION_KEY`
- 10-second expiry
- Single-use (validated on backend)
- Cannot be reused or shared

**Chain Tokens**:
- 20-second TTL (configurable)
- Rotates after each scan
- Prevents screenshot sharing

---

## Authentication Security

### Azure AD Integration

**Production**:
- Uses Azure Static Web Apps built-in auth
- `/.auth/login/aad` - Login endpoint
- `/.auth/me` - User info endpoint
- HTTP-only cookies (secure)

**Local Development**:
- Mock authentication for testing
- Disabled in production
- Uses `NEXT_PUBLIC_ENVIRONMENT=local` flag

### Role-Based Access

**Teacher Role**:
- Email domain: `@vtc.edu.hk` (excluding `@stu.vtc.edu.hk`)
- Can create sessions, view attendance, export data

**Student Role**:
- Email domain: `@stu.vtc.edu.hk`
- Can join sessions, scan QR codes

---

## API Security

### CORS Configuration

**Function App CORS**:
```bash
az functionapp cors add \
  --name func-qrattendance-prod \
  --resource-group rg-qr-attendance-prod \
  --allowed-origins "https://ashy-desert-0fc9a700f.6.azurestaticapps.net"
```

### Authentication Headers

All API calls include:
- `x-ms-client-principal` - User identity
- `x-ms-client-principal-id` - User ID
- `x-ms-client-principal-name` - User email

---

## Best Practices

### Development

1. **Never commit secrets** - Use `.gitignore`
2. **Use templates** - `.env.example`, `local.settings.json.template`
3. **Local secrets** - Keep in `.env.local` (ignored)
4. **Test accounts** - Use test users, not real students

### Production

1. **Managed Identity** - Avoid connection strings
2. **Key Vault** - Store all secrets
3. **HTTPS only** - Enforce SSL/TLS
4. **Monitor logs** - Watch for suspicious activity
5. **Regular updates** - Keep dependencies current

### Deployment

1. **Automated scripts** - Use `deploy-full-production.sh`
2. **No manual secrets** - Fetch from Azure automatically
3. **Verify deployment** - Check all resources
4. **Rollback plan** - Keep previous versions

---

## Incident Response

### If Secrets Are Exposed

1. **Rotate immediately**:
   ```bash
   # Rotate Storage key
   az storage account keys renew \
     --account-name stqrattendanceprod \
     --key primary
   
   # Rotate SignalR key
   az signalr key renew \
     --name signalr-qrattendance-prod \
     --resource-group rg-qr-attendance-prod \
     --key-type primary
   
   # Rotate OpenAI key
   az cognitiveservices account keys regenerate \
     --name oai-qrattendance-prod \
     --resource-group rg-qr-attendance-prod \
     --key-name key1
   ```

2. **Update Function App settings** with new keys

3. **Remove from Git history**:
   ```bash
   # Use BFG Repo-Cleaner
   bfg --delete-files credential.json
   git reflog expire --expire=now --all
   git gc --prune=now --aggressive
   git push --force
   ```

4. **Notify team** and review access logs

---

## Security Checklist

### Before Deployment
- [ ] No secrets in code
- [ ] `.gitignore` properly configured
- [ ] Environment variables set in Azure
- [ ] CORS configured correctly
- [ ] Authentication working
- [ ] Role-based access tested

### After Deployment
- [ ] All resources running
- [ ] Secrets in Key Vault
- [ ] Managed Identity enabled
- [ ] Logs monitored
- [ ] Backup configured

---

## Related Documentation

- **DEPLOYMENT.md** - Deployment guide
- **AZURE_ENVIRONMENT.md** - Azure resources
- **LOCAL_DEVELOPMENT.md** - Local dev setup

---

## Quick Reference

```bash
# Verify Git security
git check-ignore -v .env backend/local.settings.json

# Rotate Storage key
az storage account keys renew --account-name stqrattendanceprod --key primary

# Rotate SignalR key
az signalr key renew --name signalr-qrattendance-prod --resource-group rg-qr-attendance-prod --key-type primary

# Check Function App settings
az functionapp config appsettings list --name func-qrattendance-prod --resource-group rg-qr-attendance-prod
```

---

**Your repository is secure!** ✓
