# JWT and OTP Configuration Guide

## Where to Set Environment Variables

You have **3 options** for configuring JWT and OTP settings:

### Option 1: Environment Variables (Recommended for Local/CI/CD)

Set environment variables before running the deployment script:

```bash
# Required
export JWT_SECRET=$(openssl rand -hex 32)

# Optional (with defaults shown)
export JWT_EXPIRY_HOURS=24
export OTP_EXPIRY_MINUTES=5
export OTP_MAX_ATTEMPTS=3
export OTP_RATE_LIMIT_MINUTES=15
export OTP_RATE_LIMIT_COUNT=3

# Run deployment
./deploy-full-production.sh
```

**Pros:**
- ✅ Works with CI/CD pipelines
- ✅ No files to manage
- ✅ Can be set per deployment

**Cons:**
- ❌ Must set every time
- ❌ Easy to forget

---

### Option 2: Create a Configuration File (Recommended for Production)

Create a file `.jwt-otp-config` in the project root (gitignored):

```bash
# Create the file
cat > .jwt-otp-config << 'EOF'
# JWT Configuration
JWT_SECRET=your-secure-secret-here-at-least-32-characters-long
JWT_EXPIRY_HOURS=24

# OTP Configuration
OTP_EXPIRY_MINUTES=5
OTP_MAX_ATTEMPTS=3
OTP_RATE_LIMIT_MINUTES=15
OTP_RATE_LIMIT_COUNT=3
EOF

# Generate a secure JWT_SECRET
JWT_SECRET=$(openssl rand -hex 32)
sed -i "s/your-secure-secret-here-at-least-32-characters-long/$JWT_SECRET/" .jwt-otp-config

# Load before deployment
source ./.jwt-otp-config
./deploy-full-production.sh
```

**Pros:**
- ✅ Persistent configuration
- ✅ Easy to manage
- ✅ Can be version controlled (if encrypted)

**Cons:**
- ❌ Must remember to source it
- ❌ Security risk if committed to git

---

### Option 3: Configure After Deployment in Azure Portal

Deploy without JWT_SECRET, then configure in Azure:

```bash
# Deploy (will show warning about missing JWT_SECRET)
./deploy-full-production.sh

# Then configure in Azure Portal:
# 1. Go to Azure Portal
# 2. Navigate to Function App: func-qrattendance-prod
# 3. Settings → Configuration → Application settings
# 4. Click "+ New application setting"
# 5. Add each setting:
#    - Name: JWT_SECRET, Value: <your-secret>
#    - Name: JWT_EXPIRY_HOURS, Value: 24
#    - etc.
# 6. Click "Save"
# 7. Restart Function App
```

**Or use Azure CLI:**

```bash
az functionapp config appsettings set \
  --name func-qrattendance-prod \
  --resource-group rg-qr-attendance-prod \
  --settings \
    JWT_SECRET="$(openssl rand -hex 32)" \
    JWT_EXPIRY_HOURS="24" \
    OTP_EXPIRY_MINUTES="5" \
    OTP_MAX_ATTEMPTS="3" \
    OTP_RATE_LIMIT_MINUTES="15" \
    OTP_RATE_LIMIT_COUNT="3"
```

**Pros:**
- ✅ Centralized in Azure
- ✅ Secure (Azure manages secrets)
- ✅ Easy to update without redeployment

**Cons:**
- ❌ Requires manual step after deployment
- ❌ Not automated

---

## Recommended Setup

### For Development/Testing

Use **Option 1** (environment variables):

```bash
# Add to your shell profile (~/.bashrc or ~/.zshrc)
export JWT_SECRET=$(openssl rand -hex 32)
export JWT_EXPIRY_HOURS=24
export OTP_EXPIRY_MINUTES=5
```

### For Production

Use **Option 2** (configuration file) + **Option 3** (Azure Portal):

1. Create `.jwt-otp-config` for initial deployment
2. After deployment, verify settings in Azure Portal
3. Use Azure Key Vault for JWT_SECRET (advanced)

---

## Complete Configuration Example

### Step 1: Create Configuration File

```bash
cat > .jwt-otp-config << 'EOF'
# JWT Configuration
JWT_SECRET=$(openssl rand -hex 32)
JWT_EXPIRY_HOURS=24

# OTP Configuration  
OTP_EXPIRY_MINUTES=5
OTP_MAX_ATTEMPTS=3
OTP_RATE_LIMIT_MINUTES=15
OTP_RATE_LIMIT_COUNT=3
EOF
```

### Step 2: Add to .gitignore

```bash
echo ".jwt-otp-config" >> .gitignore
```

### Step 3: Load and Deploy

```bash
# Load configuration
source ./.jwt-otp-config

# Verify it's loaded
echo "JWT_SECRET is set: $([ -n "$JWT_SECRET" ] && echo "YES" || echo "NO")"

# Deploy
./deploy-full-production.sh
```

---

## SMTP Configuration (Separate File)

SMTP settings are loaded from `.otp-email-credentials` (already exists):

```bash
cat .otp-email-credentials
```

Should contain:
```
OTP_SMTP_HOST=smtp.gmail.com
OTP_SMTP_PORT=465
OTP_SMTP_SECURE=true
OTP_SMTP_USERNAME=your-smtp-username
OTP_SMTP_PASSWORD=your-smtp-password
OTP_FROM_EMAIL=noreply@example.com
OTP_FROM_NAME=VTC Attendance
OTP_EMAIL_SUBJECT=Your verification code
OTP_APP_NAME=ProvePresent
```

This file is automatically loaded by the deployment script.

---

## Security Best Practices

### 1. Generate Strong JWT_SECRET

```bash
# Good: 64 characters (32 bytes hex)
openssl rand -hex 32

# Better: 128 characters (64 bytes hex)
openssl rand -hex 64

# Best: Use Azure Key Vault
az keyvault secret set \
  --vault-name your-keyvault \
  --name jwt-secret \
  --value "$(openssl rand -hex 64)"
```

### 2. Never Commit Secrets to Git

Add to `.gitignore`:
```
.jwt-otp-config
.otp-email-credentials
.external-id-credentials
*.secret
*.key
```

### 3. Rotate JWT_SECRET Regularly

```bash
# Generate new secret
NEW_SECRET=$(openssl rand -hex 32)

# Update in Azure
az functionapp config appsettings set \
  --name func-qrattendance-prod \
  --resource-group rg-qr-attendance-prod \
  --settings JWT_SECRET="$NEW_SECRET"

# Note: This will invalidate all existing JWT tokens
```

### 4. Use Different Secrets for Different Environments

```bash
# Development
export JWT_SECRET=$(openssl rand -hex 32)

# Staging
export JWT_SECRET=$(openssl rand -hex 32)

# Production (use Azure Key Vault)
export JWT_SECRET=$(az keyvault secret show \
  --vault-name prod-keyvault \
  --name jwt-secret \
  --query value -o tsv)
```

---

## Verification

### Check Environment Variables

```bash
# Before deployment
echo "JWT_SECRET: $([ -n "$JWT_SECRET" ] && echo "SET" || echo "NOT SET")"
echo "JWT_EXPIRY_HOURS: ${JWT_EXPIRY_HOURS:-24} (default: 24)"
echo "OTP_EXPIRY_MINUTES: ${OTP_EXPIRY_MINUTES:-5} (default: 5)"
```

### Check Azure Function App Settings

```bash
# List all JWT/OTP settings
az functionapp config appsettings list \
  --name func-qrattendance-prod \
  --resource-group rg-qr-attendance-prod \
  --query "[?starts_with(name, 'JWT_') || starts_with(name, 'OTP_')].{name:name, value:value}" \
  --output table
```

### Test JWT Token Generation

```bash
# In backend directory
cd backend
node -e "
const jwt = require('jsonwebtoken');
const secret = process.env.JWT_SECRET || 'test-secret';
const token = jwt.sign({ userId: 'test@vtc.edu.hk' }, secret, { expiresIn: '24h' });
console.log('JWT Token generated successfully');
console.log('Token length:', token.length);
"
```

---

## Troubleshooting

### JWT_SECRET Not Set Warning

If you see this during deployment:
```
⚠ JWT_SECRET not set in environment
  JWT_SECRET will need to be configured in Function App settings
```

**Solution:**
```bash
# Set it now
export JWT_SECRET=$(openssl rand -hex 32)

# Or configure after deployment in Azure Portal
```

### Invalid JWT Secret Error

If backend logs show "Invalid JWT secret":
```
Error: secretOrPrivateKey must have a value
```

**Solution:**
```bash
# Verify it's set in Azure
az functionapp config appsettings list \
  --name func-qrattendance-prod \
  --resource-group rg-qr-attendance-prod \
  --query "[?name=='JWT_SECRET'].value" -o tsv

# If empty, set it
az functionapp config appsettings set \
  --name func-qrattendance-prod \
  --resource-group rg-qr-attendance-prod \
  --settings JWT_SECRET="$(openssl rand -hex 32)"
```

### OTP Settings Not Applied

If OTP settings aren't working:

```bash
# Check if they're set
az functionapp config appsettings list \
  --name func-qrattendance-prod \
  --resource-group rg-qr-attendance-prod \
  --query "[?starts_with(name, 'OTP_')].{name:name, value:value}" \
  --output table

# If missing, set them
az functionapp config appsettings set \
  --name func-qrattendance-prod \
  --resource-group rg-qr-attendance-prod \
  --settings \
    OTP_EXPIRY_MINUTES="5" \
    OTP_MAX_ATTEMPTS="3" \
    OTP_RATE_LIMIT_MINUTES="15" \
    OTP_RATE_LIMIT_COUNT="3"
```

---

## Quick Reference

### Minimal Setup (Just JWT_SECRET)

```bash
export JWT_SECRET=$(openssl rand -hex 32)
./deploy-full-production.sh
```

### Full Setup (All Options)

```bash
export JWT_SECRET=$(openssl rand -hex 32)
export JWT_EXPIRY_HOURS=24
export OTP_EXPIRY_MINUTES=5
export OTP_MAX_ATTEMPTS=3
export OTP_RATE_LIMIT_MINUTES=15
export OTP_RATE_LIMIT_COUNT=3
./deploy-full-production.sh
```

### Configuration File Setup

```bash
# Create config
cat > .jwt-otp-config << EOF
export JWT_SECRET=$(openssl rand -hex 32)
export JWT_EXPIRY_HOURS=24
export OTP_EXPIRY_MINUTES=5
export OTP_MAX_ATTEMPTS=3
export OTP_RATE_LIMIT_MINUTES=15
export OTP_RATE_LIMIT_COUNT=3
EOF

# Load and deploy
source ./.jwt-otp-config && ./deploy-full-production.sh
```

---

## Summary

**Recommended approach:**

1. **For first deployment:** Use environment variables
   ```bash
   export JWT_SECRET=$(openssl rand -hex 32)
   ./deploy-full-production.sh
   ```

2. **For production:** Create `.jwt-otp-config` file
   ```bash
   source ./.jwt-otp-config
   ./deploy-full-production.sh
   ```

3. **For security:** Use Azure Key Vault (advanced)
   ```bash
   # Store in Key Vault
   az keyvault secret set --vault-name your-kv --name jwt-secret --value "$(openssl rand -hex 64)"
   
   # Reference in Function App
   az functionapp config appsettings set \
     --name func-qrattendance-prod \
     --resource-group rg-qr-attendance-prod \
     --settings JWT_SECRET="@Microsoft.KeyVault(SecretUri=https://your-kv.vault.azure.net/secrets/jwt-secret/)"
   ```

**All other OTP settings have sensible defaults and are optional!**
