# Azure AD Configuration

This document explains the Azure AD configuration for the QR Chain Attendance System.

## Overview

The system uses Azure AD authentication with the following configuration:

- **App Name**: QR Chain Attendance System  
- **Client ID**: `dc482c34-ebaa-4239-aca3-2810a4f51728`
- **Multi-tenant**: Yes (`organizations`)

## Custom OTP Email (External ID) - Quick Runbook

Use this section when you want Microsoft Entra to send OTP through your own mail server (SMTP in this project).

### Important scope

- The `EmailOtpSend` custom authentication extension is for **Microsoft Entra External ID**.
- If you are using **classic Azure AD B2C custom policies (IEF)**, use REST API technical profiles instead. Do not reuse `b2c-extensions-app` for this extension flow.

### Prerequisites in this repo

1. Deploy backend and infrastructure:
	- `./deploy-full-development.sh`
2. Ensure local OTP credentials file exists (gitignored):
	- `.otp-email-credentials`
3. Confirm function endpoint exists after deploy:
	- `/api/auth/on-otp-send-email`

### Portal steps (External ID)

1. Go to **External Identities** → **Custom authentication extensions** → **Create custom extension**.
2. **Basics**:
	- Event: `EmailOtpSend`
3. **Endpoint Configuration**:
	- Target URL: Function URL for `/api/auth/on-otp-send-email` including function key.
	- Timeout: use `5000` to `10000` ms (recommended for SMTP reliability).
	- Error handling: optionally enable fallback to Microsoft provider.
4. **API Authentication**:
	- Select **Create new app registration**.
	- Suggested name: `qrattend-emailotp-events-api`.
5. **Applications**:
	- Add only your sign-in app (for this project: `QRChainAttend External Login`).
	- Do not select `b2c-extensions-app`.
6. **Review** → **Create**.
7. Open the created extension and run **Grant permission / Admin consent**.

### Validation checklist

- Custom extension created with Event `EmailOtpSend`.
- API auth app registration exists and consent is granted.
- Extension is assigned to the correct app registration.
- OTP test sign-in sends email from configured sender.
- If email send fails, check Function App logs and verify OTP app settings exist.

### Common mistakes

- Choosing **Select existing app registration** and picking the login client app.
- Using `b2c-extensions-app` as the resource app.
- Setting timeout too low (for example `2000` ms) causing fallback.

## Security Model

### ✅ Safe to Store in Git (Public Information)
- `AAD_CLIENT_ID` - This is meant to be public and is included in frontend code
- `TENANT_ID` - Multi-tenant identifier (`organizations`)
- App Name and other metadata

### ❌ Never Store in Git (Sensitive Information)
- `AAD_CLIENT_SECRET` - This must be kept secure at all times
- User tokens and session data
- Deployment tokens for Azure services

## Configuration Files

### `.external-id-credentials` ❌ Not Committed (Preferred)
Primary credentials file used by deployment and helper scripts.

```bash
export AAD_CLIENT_ID="your-client-id"
export AAD_CLIENT_SECRET="your-secret"
export TENANT_ID="your-tenant-id-or-organizations"
```

Use `.external-id-credentials.template` as the starting point, then create a local `.external-id-credentials` file.

### Client Secret ❌ Never Store in Git
The client secret must only exist in local secure files, environment variables, or CI/CD secrets.

```bash
AAD_CLIENT_ID="dc482c34-ebaa-4239-aca3-2810a4f51728"
TENANT_ID="organizations"
```

The client secret can be provided during deployment via:
- Via environment variable: `export AAD_CLIENT_SECRET="your-secret"`
- Interactive prompt during deployment
- CI/CD secrets (GitHub Secrets, Azure DevOps Variables, etc.)

## Deployment Usage

The deployment scripts automatically:
1. Load credentials from `.external-id-credentials` (preferred)
2. Configure Azure resources with proper authentication

```bash
# Preferred
source .external-id-credentials
./deploy-full-production.sh  

# Or set Client Secret via environment
export AAD_CLIENT_SECRET="your-secret"
./deploy-full-production.sh
```

## Current Redirect URIs

The Azure AD app is configured with these redirect URIs:
- **Dev Environment**: `https://red-grass-0f8bc910f.4.azurestaticapps.net/.auth/login/aad/callback`
- **Local Development**: `http://localhost:3000/.auth/login/aad/callback`
- **Production**: Added automatically during deployment

## Maintenance

Use the cleanup scripts to manage redirect URIs:
- `./list-resources.sh` - View current configuration
- `./undeploy-production.sh` - Clean up production URLs from AD app

The undeploy script preserves dev and localhost URLs while removing production URLs.