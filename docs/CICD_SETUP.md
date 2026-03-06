# CI/CD Setup Guide

This guide explains how to set up Azure credentials for GitHub Actions workflows with minimal required permissions.

## Overview

The CI/CD pipelines require Azure credentials to:
- Deploy infrastructure using Bicep templates
- Deploy Azure Functions (backend)
- Deploy to Azure Static Web Apps (frontend)
- Manage Azure resources

## Prerequisites

1. **Azure CLI** installed and configured
   ```bash
   # Install Azure CLI
   # Visit: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli
   
   # Login to Azure
   az login
   ```

2. **GitHub CLI** (optional, for automatic secret setup)
   ```bash
   # Install GitHub CLI
   # Visit: https://cli.github.com/
   
   # Login to GitHub
   gh auth login
   ```

3. **Required Azure Permissions**
   - Owner or User Access Administrator role on the subscription
   - Or at minimum: ability to create service principals and assign roles

## Quick Setup

### Step 1: Run the Setup Script

```bash
# Make the script executable
chmod +x scripts/setup-cicd-credentials.sh

# Run the script
./scripts/setup-cicd-credentials.sh \
  "<your-subscription-id>" \
  "<your-resource-group-name>" \
  "<github-owner/repo>"

# Example:
./scripts/setup-cicd-credentials.sh \
  "12345678-1234-1234-1234-123456789012" \
  "rg-qr-attendance" \
  "wongcyrus/ProvePresent"
```

### Step 2: Verify GitHub Secrets

Go to your GitHub repository settings:
```
https://github.com/<owner>/<repo>/settings/secrets/actions
```

Verify these secrets are set:
- `AZURE_CREDENTIALS` - Full credentials JSON
- `AZURE_CLIENT_ID` - Service principal client ID
- `AZURE_TENANT_ID` - Azure AD tenant ID
- `AZURE_SUBSCRIPTION_ID` - Azure subscription ID

### Step 3: Clean Up

After setting up GitHub secrets, delete the credentials file:
```bash
rm azure-cicd-credentials.json
```

## What the Script Does

1. **Creates a Service Principal** with minimal permissions
2. **Assigns Roles**:
   - `Contributor` - Deploy and manage resources in the resource group
   - `User Access Administrator` - Assign managed identities
3. **Generates Credentials** in the format required by GitHub Actions
4. **Optionally Sets GitHub Secrets** automatically using GitHub CLI

## Service Principal Permissions

The service principal is created with **least privilege** access:

| Role | Scope | Purpose |
|------|-------|---------|
| Contributor | Resource Group | Deploy and manage Azure resources |
| User Access Administrator | Resource Group | Assign managed identities to resources |

**Security Benefits:**
- ✅ Scoped to specific resource group only
- ✅ Cannot access other subscriptions or resource groups
- ✅ Cannot modify subscription-level settings
- ✅ Cannot create or delete resource groups
- ✅ Minimal permissions required for CI/CD operations

## Manual Setup (Alternative)

If you prefer to set up manually:

### 1. Create Service Principal

```bash
# Set variables
SUBSCRIPTION_ID="your-subscription-id"
RESOURCE_GROUP="your-resource-group"
SP_NAME="sp-qr-attendance-cicd"

# Create service principal
az ad sp create-for-rbac \
  --name "${SP_NAME}" \
  --role Contributor \
  --scopes "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}" \
  --sdk-auth
```

### 2. Assign Additional Roles

```bash
# Get service principal ID
SP_ID=$(az ad sp list --display-name "${SP_NAME}" --query "[0].appId" -o tsv)

# Assign User Access Administrator role
az role assignment create \
  --assignee "${SP_ID}" \
  --role "User Access Administrator" \
  --scope "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}"
```

### 3. Set GitHub Secrets

Copy the output from step 1 and add it as `AZURE_CREDENTIALS` secret in GitHub.

Also add individual secrets:
- `AZURE_CLIENT_ID` - From `clientId` in the JSON
- `AZURE_TENANT_ID` - From `tenantId` in the JSON
- `AZURE_SUBSCRIPTION_ID` - From `subscriptionId` in the JSON

## Troubleshooting

### Service Principal Already Exists

If you get an error that the service principal already exists:

```bash
# List existing service principals
az ad sp list --display-name "sp-qr-attendance-cicd"

# Delete existing service principal
az ad sp delete --id <app-id>

# Re-run the setup script
```

### Permission Denied Errors

If you get permission errors during deployment:

1. **Check role assignments:**
   ```bash
   az role assignment list \
     --assignee <client-id> \
     --resource-group <resource-group>
   ```

2. **Verify the service principal has propagated:**
   - Wait 5-10 minutes after creation
   - Azure AD replication can take time

3. **Check resource group exists:**
   ```bash
   az group show --name <resource-group>
   ```

### Reset Service Principal Credentials

If you need to reset the client secret:

```bash
# Reset credentials
az ad sp credential reset --id <client-id>

# Update GitHub secrets with new credentials
```

## Workflow Configuration

The credentials are used in these workflows:

### Infrastructure Deployment
```yaml
- uses: azure/login@v2
  with:
    creds: ${{ secrets.AZURE_CREDENTIALS }}
```

### Backend Deployment
```yaml
- uses: azure/login@v2
  with:
    client-id: ${{ secrets.AZURE_CLIENT_ID }}
    tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```

### Frontend Deployment
Uses `AZURE_STATIC_WEB_APPS_API_TOKEN` (separate token from Azure Portal)

## Security Best Practices

1. **Rotate Credentials Regularly**
   ```bash
   az ad sp credential reset --id <client-id>
   ```

2. **Use Separate Service Principals** for different environments
   - `sp-qr-attendance-dev`
   - `sp-qr-attendance-staging`
   - `sp-qr-attendance-prod`

3. **Monitor Service Principal Usage**
   ```bash
   az monitor activity-log list \
     --caller <client-id> \
     --start-time 2024-01-01
   ```

4. **Set Credential Expiration**
   ```bash
   az ad sp credential reset \
     --id <client-id> \
     --years 1
   ```

5. **Enable Conditional Access** (if using Azure AD Premium)
   - Restrict access by IP
   - Require MFA for sensitive operations

## Cleanup

To remove the service principal when no longer needed:

```bash
# Get service principal ID
SP_ID=$(az ad sp list --display-name "sp-qr-attendance-cicd" --query "[0].appId" -o tsv)

# Delete service principal
az ad sp delete --id "${SP_ID}"

# Remove GitHub secrets
gh secret remove AZURE_CREDENTIALS --repo <owner/repo>
gh secret remove AZURE_CLIENT_ID --repo <owner/repo>
gh secret remove AZURE_TENANT_ID --repo <owner/repo>
gh secret remove AZURE_SUBSCRIPTION_ID --repo <owner/repo>
```

## Additional Resources

- [Azure Service Principals](https://docs.microsoft.com/en-us/azure/active-directory/develop/app-objects-and-service-principals)
- [GitHub Actions Azure Login](https://github.com/Azure/login)
- [Azure RBAC Roles](https://docs.microsoft.com/en-us/azure/role-based-access-control/built-in-roles)
- [GitHub Encrypted Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)

## Support

If you encounter issues:
1. Check the [Troubleshooting](#troubleshooting) section
2. Review Azure Activity Logs in the portal
3. Check GitHub Actions workflow logs
4. Verify all secrets are correctly set
