# Development Script Migration Complete

## Date
March 7, 2026

## Summary
Successfully migrated `deploy-full-development.sh` from Azure AD authentication to JWT/OTP authentication by replacing it with a clean version based on the production script.

## Changes Made

### 1. Backup
✅ Backed up old script to `.archive/deploy-full-development-with-azuread-YYYYMMDD-HHMMSS.sh`

### 2. Script Replacement
✅ Copied `deploy-full-production.sh` as the base
✅ Updated all production references to development

### 3. Resource Names Updated
- Resource Group: `rg-qr-attendance-prod` → `rg-qr-attendance-dev`
- Deployment Name: `qr-attendance-prod-deployment` → `qr-attendance-dev-deployment`
- Function App: `func-qrattendance-prod` → `func-qrattendance-dev`
- Static Web App: `swa-qrattendance-prod` → `swa-qrattendance-dev`
- OpenAI: `openai-qrattendance-prod` → `openai-qrattendance-dev`
- SignalR: `signalr-qrattendance-prod` → `signalr-qrattendance-dev`
- App Insights: `appi-qrattendance-prod` → `appi-qrattendance-dev`
- Storage: `stqrattendanceprod` → `stqrattendancedev`

### 4. Configuration Updated
- Bicep parameters: `parameters/prod.bicepparam` → `parameters/dev.bicepparam`
- Environment: `prod` → `dev`
- Tags: `Environment=Production` → `Environment=Development`
- Deployment messages: All "Production" → "Development"

### 5. JWT/OTP Configuration
✅ JWT configuration loading included
✅ OTP email configuration included
✅ All environment variables properly set in `local.settings.json`

## Removed Features

The following Azure AD features were removed:
- ❌ `.external-id-credentials` file loading
- ❌ `TENANT_ID`, `AAD_CLIENT_ID`, `AAD_CLIENT_SECRET` validation
- ❌ External ID issuer validation
- ❌ Azure AD login verification
- ❌ Static Web App Azure AD settings configuration
- ❌ Frontend Azure AD environment variables

## New Authentication Flow

The development script now uses the same JWT/OTP authentication as production:

1. **Configuration Files Required:**
   - `.jwt-otp-config` - JWT secret and OTP settings
   - `.otp-email-credentials` - SMTP email settings

2. **Authentication Flow:**
   - User requests OTP via email
   - User verifies OTP code
   - Backend creates JWT token
   - JWT stored in HttpOnly cookie
   - All API requests authenticated via JWT

## Usage

### Prerequisites
```bash
# 1. Create JWT configuration
./setup-jwt-config.sh

# 2. Ensure email credentials exist
cp .otp-email-credentials.example .otp-email-credentials
# Edit with your SMTP settings
```

### Deploy Development Environment
```bash
./deploy-full-development.sh
```

### What Gets Deployed
1. Azure infrastructure (Bicep)
2. Backend functions with JWT/OTP auth
3. Database tables
4. Frontend with OTP login
5. SignalR for real-time updates
6. Application Insights monitoring

## Verification

After deployment, verify:

1. ✅ Frontend loads at development URL
2. ✅ Login page shows email OTP form (not Azure AD)
3. ✅ OTP email is received
4. ✅ Login succeeds with valid OTP
5. ✅ API calls return 200 (not 401)
6. ✅ Teacher/student features work

## Configuration Files

### .jwt-otp-config
```bash
JWT_SECRET=<generated-secret>
JWT_EXPIRY_HOURS=24
OTP_EXPIRY_MINUTES=5
OTP_MAX_ATTEMPTS=3
OTP_RATE_LIMIT_MINUTES=15
OTP_RATE_LIMIT_COUNT=3
```

### .otp-email-credentials
```bash
OTP_SMTP_HOST=smtp.gmail.com
OTP_SMTP_PORT=465
OTP_SMTP_SECURE=true
OTP_SMTP_USERNAME=your-email@gmail.com
OTP_SMTP_PASSWORD=your-app-password
OTP_FROM_EMAIL=your-email@gmail.com
OTP_FROM_NAME=VTC Attendance
OTP_EMAIL_SUBJECT=Your verification code
OTP_APP_NAME=ProvePresent
```

## Differences from Production Script

The development script is now identical to production except for:
- Resource names (dev vs prod)
- Bicep parameters file (dev.bicepparam vs prod.bicepparam)
- Environment tags and labels

## Related Files
- `deploy-full-production.sh` - Production deployment (reference)
- `deploy-full-development.sh` - Development deployment (updated)
- `.archive/deploy-full-development-with-azuread-*` - Old script backup
- `JWT_OTP_CONFIGURATION_GUIDE.md` - Authentication configuration guide
- `BACKEND_AUTH_MIGRATION.md` - Backend migration details

## Next Steps

1. Test the development deployment
2. Verify authentication works correctly
3. Update any CI/CD pipelines that reference the development script
4. Archive `DEV_SCRIPT_UPDATE_NEEDED.md` (no longer needed)
