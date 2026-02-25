# Azure AD Configuration

This document explains the Azure AD configuration for the QR Chain Attendance System.

## Overview

The system uses Azure AD authentication with the following configuration:

- **App Name**: QR Chain Attendance System  
- **Client ID**: `dc482c34-ebaa-4239-aca3-2810a4f51728`
- **Multi-tenant**: Yes (`organizations`)

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