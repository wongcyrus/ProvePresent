# Deployment Guide

## Overview

This guide covers deploying the QR Chain Attendance system to Azure.

## Prerequisites

- Azure subscription
- Azure CLI installed and authenticated
- Node.js 18+ and npm
- Bicep CLI (for infrastructure)

### Authentication SKU Requirement

For Microsoft Entra External ID / Azure AD B2C custom authentication in Static Web Apps, **Standard SKU is required**. Free SKU can fall back to default auth behavior and ignore custom provider registration settings.

- Official reference: https://learn.microsoft.com/azure/static-web-apps/authentication-custom
- This project enforces Standard SKU in deployment scripts when External ID is configured.

## Infrastructure Deployment

### 1. Deploy Infrastructure

```bash
cd infrastructure

# Validate Bicep templates
./validate.sh

# Deploy to environment (dev/staging/prod)
./deploy.sh dev

# Or using PowerShell
./deploy.ps1 -Environment dev
```

### 2. Configure Managed Identity

After infrastructure deployment, configure RBAC permissions:

```bash
cd scripts
./configure-managed-identity.sh <resource-group> <function-app-name>
./verify-managed-identity.sh <resource-group> <function-app-name>
```

This grants the Function App managed identity access to:
- Storage Account (Table Data Contributor)
- SignalR Service (Contributor)
- Azure OpenAI (Cognitive Services User)

## Application Deployment

### Backend (Azure Functions)

Deployed automatically via GitHub Actions on push to main branch.

Manual deployment:

```bash
cd backend
npm install
npm run build
func azure functionapp publish <function-app-name>
```

### Frontend (Static Web App)

Deployed automatically via GitHub Actions on push to main branch.

Manual deployment:

```bash
cd frontend
npm install
npm run build
# Deploy via Azure Static Web Apps CLI or portal
```

## CI/CD Pipeline

### GitHub Actions Workflows

1. **Test Workflow** (`.github/workflows/test.yml`)
   - Runs on all PRs and pushes
   - Executes backend and frontend tests
   - Generates coverage reports

2. **Infrastructure Deploy** (`.github/workflows/infrastructure-deploy.yml`)
   - Deploys Bicep templates
   - Configures managed identity
   - Sets up monitoring

3. **Backend Deploy** (`.github/workflows/backend-deploy.yml`)
   - Builds and deploys Azure Functions
   - Updates app settings
   - Runs smoke tests

### Required Secrets

Configure in GitHub repository settings:

- `AZURE_CREDENTIALS` - Service principal for Azure authentication
- `AZURE_SUBSCRIPTION_ID` - Azure subscription ID
- `AZURE_RESOURCE_GROUP` - Target resource group name

### Environment Variables

Set in Azure Function App settings:

- `AzureWebJobsStorage` - Storage account connection (use managed identity)
- `SignalRConnectionString` - SignalR connection string
- `AZURE_OPENAI_ENDPOINT` - OpenAI endpoint URL
- `AZURE_OPENAI_API_KEY` - OpenAI API key (or use managed identity)
- `ALLOWED_ORIGINS` - CORS allowed origins

## Post-Deployment Configuration

### 1. Configure Static Web App

Update `staticwebapp.config.json` with production API URL if needed.

### 2. Set Up Monitoring

```bash
cd scripts
./configure-monitoring.sh <resource-group>

# Or using PowerShell
./configure-monitoring.ps1 -ResourceGroup <resource-group>
```

This configures:
- Application Insights
- Log Analytics workspace
- Alert rules
- Monitoring dashboard

### 3. Verify Deployment

1. Check Function App health: `https://<function-app>.azurewebsites.net/api/health`
2. Test Static Web App: `https://<static-web-app>.azurestaticapps.net`
3. Verify SignalR connectivity via negotiate endpoint
4. Check Application Insights for telemetry

## Monitoring

See [MONITORING.md](./MONITORING.md) for details on:
- Metrics and dashboards
- Alert rules and responses
- Log queries
- Performance monitoring

## Rollback Procedures

### Infrastructure
```bash
# Redeploy previous version
az deployment group create \
  --resource-group <rg-name> \
  --template-file infrastructure/main.bicep \
  --parameters @infrastructure/parameters/<env>.bicepparam
```

### Backend
```bash
# Revert to previous deployment slot
az functionapp deployment slot swap \
  --resource-group <rg-name> \
  --name <function-app-name> \
  --slot staging \
  --action swap
```

### Frontend
Use Azure Static Web Apps portal to revert to previous deployment.

## Troubleshooting

### Common Issues

1. **Function App not starting**
   - Check managed identity permissions
   - Verify app settings are configured
   - Review Application Insights logs

2. **SignalR connection failures**
   - Verify SignalR service is running
   - Check connection string configuration
   - Ensure CORS is properly configured

3. **Storage access errors**
   - Verify managed identity has Table Data Contributor role
   - Check storage account firewall rules
   - Ensure storage account is accessible

### Debug Commands

```bash
# View Function App logs
az functionapp log tail --name <function-app-name> --resource-group <rg-name>

# Check managed identity status
az functionapp identity show --name <function-app-name> --resource-group <rg-name>

# List role assignments
az role assignment list --assignee <principal-id>
```

## Security Considerations

- Use managed identities instead of connection strings where possible
- Enable HTTPS only
- Configure appropriate CORS origins
- Implement rate limiting
- Regular security updates via Dependabot
- Monitor for suspicious activity in Application Insights

## Cost Optimization

- Use consumption plan for Functions (pay per execution)
- Configure appropriate retention policies for logs
- Use Free tier for SignalR during development
- Monitor and optimize storage usage
- Set up budget alerts in Azure Cost Management
