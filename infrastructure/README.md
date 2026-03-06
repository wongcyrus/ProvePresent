# ProvePresent - Infrastructure as Code

This directory contains Bicep templates and deployment scripts for provisioning all Azure resources required by ProvePresent.

## Overview

The infrastructure is defined using Azure Bicep (Infrastructure as Code) and includes:

- **Azure Functions** - Serverless backend API (Consumption plan, Node.js 22)
- **Azure Table Storage** - Data persistence (16 tables for sessions, attendance, tokens, chains, quizzes, captures)
- **Azure Blob Storage** - Image storage (quiz slides, student captures)
- **Azure SignalR Service** - Real-time updates for teacher dashboard
- **Azure OpenAI (AIServices)** - AI-powered quiz generation and analysis
- **Azure AI Foundry Project** - Agent Service for persistent AI agents
- **Application Insights** - Monitoring and logging
- **Managed Identity** - Secure authentication between Azure services
- **RBAC Role Assignments** - Least-privilege access control

**Note**: Static Web Apps are deployed via CLI in the main deployment scripts, not via Bicep.

## Requirements Mapping

This infrastructure satisfies the following requirements:

- **Requirement 19.1**: Managed Identity for Table Storage authentication
- **Requirement 19.2**: Managed Identity for SignalR Service authentication
- **Requirement 19.3**: Managed Identity for Azure OpenAI authentication
- **Requirement 19.4**: Storage Table Data Contributor role for Function App
- **Requirement 19.5**: SignalR Service Owner role for Function App

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Azure Resources                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐         ┌──────────────────┐        │
│  │ Static Web App   │ ──────► │ Function App     │        │
│  │ (Frontend)       │  proxy  │ (Backend API)    │        │
│  │ [Standard SKU]   │         │ [Managed ID]     │        │
│  └──────────────────┘         └────────┬─────────┘        │
│                                        │                   │
│           ┌────────────────────────────┼───────────────┐  │
│           │                            │               │  │
│           ▼                            ▼               ▼  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────┐ │
│  │ Azure Table      │  │ SignalR Service  │  │ OpenAI  │ │
│  │ Storage          │  │ (Real-time)      │  │ + Foundry│ │
│  │ (16 tables)      │  │                  │  │ Project │ │
│  └──────────────────┘  └──────────────────┘  └─────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
infrastructure/
├── main.bicep                  # Main orchestration template
├── modules/                    # Modular Bicep templates
│   ├── storage.bicep          # Azure Storage Account with Table + Blob Storage
│   ├── signalr.bicep          # Azure SignalR Service
│   ├── functions.bicep        # Azure Functions (Backend)
│   ├── appinsights.bicep      # Application Insights + Log Analytics
│   ├── openai.bicep           # Azure OpenAI + Foundry Project
│   └── rbac.bicep             # RBAC role assignments
├── parameters/                 # Environment-specific parameters
│   ├── dev.bicepparam         # Development environment
│   ├── staging.bicepparam     # Staging environment
│   └── prod.bicepparam        # Production environment
├── deploy.sh                   # Bash deployment script (standalone)
├── deploy.ps1                  # PowerShell deployment script
├── validate.sh                 # Bicep validation script
└── README.md                   # This file
```

## Main Deployment Scripts

The primary deployment scripts are in the project root:

- `deploy-full-production.sh` - Complete production deployment
- `deploy-full-development.sh` - Complete development deployment

These scripts orchestrate Bicep deployment plus additional configuration.

## Prerequisites

Before deploying, ensure you have:

1. **Azure CLI** installed (version 2.50.0 or later)
   ```bash
   az --version
   ```

2. **Azure Functions Core Tools** installed (v4)
   ```bash
   func --version
   ```

3. **Node.js 22** installed (via NVM recommended)
   ```bash
   node --version  # Should be v22.x
   ```

4. **Azure subscription** with appropriate permissions
   - Owner or Contributor role on the subscription
   - User Access Administrator role (for RBAC assignments)

5. **Azure AD External ID** application registered
   - Client ID
   - Client Secret
   - Tenant ID
   - External ID Issuer URL

6. **Logged in to Azure CLI**
   ```bash
   az login
   az account set --subscription "<your-subscription-id>"
   ```

## Quick Start

### 1. Set Up Credentials

Create `.external-id-credentials` in project root:
```bash
AAD_CLIENT_ID=<your-client-id>
AAD_CLIENT_SECRET=<your-client-secret>
TENANT_ID=<your-tenant-id>
EXTERNAL_ID_ISSUER=https://<tenant>.ciamlogin.com/<tenant-id>/v2.0
```

Or run the setup script:
```bash
./setup-azure-ad-app.sh
```

### 2. Deploy to Production

```bash
./deploy-full-production.sh
```

### 3. Deploy to Development

```bash
./deploy-full-development.sh
```

### Using Standalone Bicep Script

For infrastructure-only deployment:

```bash
# Deploy to development
./infrastructure/deploy.sh \
  --environment dev \
  --resource-group rg-qr-attendance-dev

# Deploy to production with Azure OpenAI
./infrastructure/deploy.sh \
  --environment prod \
  --resource-group rg-qr-attendance-prod \
  --deploy-openai true
```

## Deployment Options

### What-If Mode

Preview changes before deploying:

```bash
# Bash
./infrastructure/deploy.sh \
  --environment dev \
  --resource-group rg-qr-attendance-dev \
  --what-if

# PowerShell
.\infrastructure\deploy.ps1 `
  -Environment dev `
  -ResourceGroup rg-qr-attendance-dev `
  -WhatIf
```

### Environment-Specific Deployments

The infrastructure supports three environments:

#### Development (dev)
- Free tier SignalR Service (20 concurrent connections)
- No Azure OpenAI by default
- Minimal monitoring
- Cost-optimized for testing

#### Staging (staging)
- Standard tier SignalR Service
- Azure OpenAI enabled
- Full monitoring and logging
- Production-like configuration

#### Production (prod)
- Standard tier SignalR Service
- Azure OpenAI enabled
- Full monitoring and alerting
- High availability configuration

### Custom Parameters

Override default parameters:

```bash
./infrastructure/deploy.sh \
  --environment dev \
  --resource-group rg-qr-attendance-dev \
  --location westus2 \
  --branch develop \
  --deploy-openai true
```

## Resource Naming Convention

Resources are named using the pattern: `<resource-type>-<base-name>-<environment>`

Examples:
- Storage Account: `stqrattendancedev` (no hyphens, lowercase)
- SignalR Service: `signalr-qrattendance-dev`
- Function App: `func-qrattendance-dev`
- App Service Plan: `asp-qrattendance-dev`
- Application Insights: `appi-qrattendance-dev`
- Azure OpenAI: `openai-qrattendance-dev`
- Foundry Project: `openai-qrattendance-dev-project`

## Managed Identity and RBAC

The deployment automatically configures:

### Function App Managed Identity
- **Storage Table Data Contributor** on Storage Account
  - Read, write, delete table entities
  - Primary backend data access
- **SignalR Service Owner** on SignalR Service
  - Full access to send messages
  - Manage connections and groups
- **Cognitive Services OpenAI User** on Azure OpenAI
  - Read access to OpenAI resources
  - Call OpenAI API endpoints
- **Azure AI User** on OpenAI Account and Foundry Project
  - Agent Service operations
  - Project-scoped permissions

Role assignments may take 5-10 minutes to propagate after deployment.

## Post-Deployment Steps

After infrastructure deployment:

1. **Update GitHub Secrets**
   - Add `AZURE_STATIC_WEB_APPS_API_TOKEN` to repository secrets
   - Token is available in deployment outputs

2. **Configure Static Web App**
   - Update `staticwebapp.config.json` with tenant ID
   - Configure route rules and authentication

3. **Deploy Application Code**
   - Push code to GitHub to trigger deployment
   - Or manually deploy using Azure CLI

4. **Verify Managed Identity**
   - Run verification script: `./scripts/verify-managed-identity.sh`
   - Check role assignments in Azure Portal

5. **Test Authentication**
   - Navigate to Static Web App URL
   - Sign in with @vtc.edu.hk or @stu.edu.hk account
   - Verify role-based access

6. **Configure Monitoring**
   - Set up Application Insights alerts
   - Configure log retention policies
   - Enable diagnostic settings

## Updating Infrastructure

To update existing infrastructure:

```bash
# Deploy with same parameters - Bicep will update only changed resources
./infrastructure/deploy.sh \
  --environment dev \
  --resource-group rg-qr-attendance-dev \
  --repository-url "https://github.com/your-org/your-repo" \
  --token "ghp_your_github_token"
```

Bicep deployments are idempotent - running the same deployment multiple times produces the same result.

## Deleting Resources

To delete all resources:

```bash
# Delete entire resource group (WARNING: This deletes ALL resources)
az group delete --name rg-qr-attendance-dev --yes --no-wait

# Or delete specific resources
az staticwebapp delete --name swa-qrattendance-dev --resource-group rg-qr-attendance-dev
az functionapp delete --name func-qrattendance-dev --resource-group rg-qr-attendance-dev
```

## Troubleshooting

### Deployment Fails with "Principal not found"

**Cause**: Managed identity hasn't propagated through Azure AD yet.

**Solution**: Wait 30-60 seconds and retry the deployment.

### Role Assignment Fails

**Cause**: Insufficient permissions to assign roles.

**Solution**: Ensure you have Owner or User Access Administrator role on the subscription.

### Static Web App Deployment Fails

**Cause**: Invalid GitHub token or repository URL.

**Solution**: 
- Verify GitHub token has `repo` scope
- Ensure repository URL is correct
- Check repository is accessible

### SignalR Connection Issues

**Cause**: Role assignment not propagated or incorrect configuration.

**Solution**:
- Wait 5-10 minutes for role propagation
- Verify role assignment: `az role assignment list --assignee <principal-id>`
- Check SignalR connection string in Function App settings

### Storage Access Denied

**Cause**: Managed identity not enabled or role not assigned.

**Solution**:
- Verify managed identity is enabled: `az functionapp identity show`
- Check role assignment on storage account
- Ensure Storage Table Data Contributor role is assigned

## Cost Estimation

### Development Environment
- Function App: Consumption plan (~$5-10/month for light usage)
- Storage Account: ~$2/month
- SignalR Service: Free tier ($0/month, 20 connections)
- Application Insights: ~$2-5/month
- Azure OpenAI: ~$10-30/month (if enabled)
- **Total: ~$19-47/month**

### Production Environment
- Function App: Consumption plan (~$20-50/month for moderate usage)
- Storage Account: ~$5-10/month
- SignalR Service: Standard tier (~$50/month, 1000 connections)
- Application Insights: ~$10-20/month
- Azure OpenAI: ~$50-100/month
- Static Web App: Standard tier (~$9/month)
- **Total: ~$144-239/month**

Costs vary based on actual usage. Monitor costs in Azure Cost Management.

## Security Best Practices

1. **Use Managed Identity** - Never store credentials in code or configuration
2. **Least Privilege** - Assign only required roles
3. **Resource Scope** - Scope role assignments to specific resources, not subscription
4. **Secure Secrets** - Store sensitive values in Azure Key Vault
5. **Network Security** - Configure network ACLs and firewall rules
6. **Monitoring** - Enable diagnostic logs and alerts
7. **Regular Audits** - Review role assignments and access logs monthly

## CI/CD Integration

### GitHub Actions

The deployment can be integrated into GitHub Actions:

```yaml
name: Deploy Infrastructure

on:
  push:
    branches: [main]
    paths:
      - 'infrastructure/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      
      - name: Deploy Infrastructure
        run: |
          ./infrastructure/deploy.sh \
            --environment prod \
            --resource-group rg-qr-attendance-prod \
            --repository-url "${{ github.server_url }}/${{ github.repository }}" \
            --token "${{ secrets.GH_PAT }}" \
            --client-id "${{ secrets.AAD_CLIENT_ID }}" \
            --client-secret "${{ secrets.AAD_CLIENT_SECRET }}"
```

### Azure DevOps

```yaml
trigger:
  branches:
    include:
      - main
  paths:
    include:
      - infrastructure/*

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: AzureCLI@2
    displayName: 'Deploy Infrastructure'
    inputs:
      azureSubscription: 'Azure-Subscription'
      scriptType: 'bash'
      scriptLocation: 'scriptPath'
      scriptPath: 'infrastructure/deploy.sh'
      arguments: >
        --environment prod
        --resource-group rg-qr-attendance-prod
        --repository-url "$(Build.Repository.Uri)"
        --token "$(GH_PAT)"
        --client-id "$(AAD_CLIENT_ID)"
        --client-secret "$(AAD_CLIENT_SECRET)"
```

## Related Documentation

- [docs/architecture/INFRASTRUCTURE_BICEP.md](../docs/architecture/INFRASTRUCTURE_BICEP.md) - Detailed Bicep module documentation
- [docs/architecture/DEPLOYMENT_SCRIPTS.md](../docs/architecture/DEPLOYMENT_SCRIPTS.md) - Deployment script architecture
- [docs/deployment/DEPLOYMENT_GUIDE.md](../docs/deployment/DEPLOYMENT_GUIDE.md) - Complete deployment guide
- [docs/architecture/SYSTEM_ARCHITECTURE.md](../docs/architecture/SYSTEM_ARCHITECTURE.md) - System architecture

## Support

For issues or questions:

1. Check the troubleshooting section above
2. Review Azure deployment logs: `az deployment group show`
3. Check Application Insights for runtime errors
4. Consult the related documentation

## License

This infrastructure code is part of the QR Chain Attendance System project.
