# QR Chain Attendance - Deployment Guide

## Quick Deployment Commands

### Development Environment
```bash
# Full deployment (infrastructure + backend + frontend)
./deploy-full-development.sh

# Backend only
./deploy-backend-only.sh dev

# Frontend only
./deploy-frontend-only.sh dev

# Redeploy (backend + frontend, no infrastructure changes)
./redeploy-development.sh
```

### Production Environment
```bash
# Full deployment
./deploy-full-production.sh

# Undeploy (cleanup)
./undeploy-production.sh
```

## Deployment Verification

After deployment, verify the system is working:

```bash
./verify-capture-deployment.sh dev
```

This checks:
- Function app status
- Required functions deployed
- Durable Functions configuration
- Storage containers
- Recent error logs

## Common Deployment Scenarios

### 1. Code Changes Only (Fastest)
If you only changed backend or frontend code:

```bash
# Backend changes
cd backend
npm install
npm run build
func azure functionapp publish func-qrattendance-dev --typescript

# Frontend changes
cd frontend
npm install
npm run build
# Deploy via Static Web Apps CLI or GitHub Actions
```

### 2. Configuration Changes
If you changed app settings or environment variables:

```bash
# Update function app settings
az functionapp config appsettings set \
  --name func-qrattendance-dev \
  --resource-group rg-qr-attendance-dev \
  --settings "KEY=VALUE"

# Restart function app
az functionapp restart \
  --name func-qrattendance-dev \
  --resource-group rg-qr-attendance-dev
```

### 3. Infrastructure Changes
If you changed Bicep templates:

```bash
./deploy-full-development.sh
```

## Monitoring Deployment

### View Function Logs
```bash
# Live stream (if supported)
func azure functionapp logstream func-qrattendance-dev --resource-group rg-qr-attendance-dev

# Or via Azure Portal
# Portal > Function App > Log stream
```

### Check Deployment Status
```bash
# Function app state
az functionapp show \
  --name func-qrattendance-dev \
  --resource-group rg-qr-attendance-dev \
  --query "{State:state, LastModified:lastModifiedTimeUtc}"

# List deployed functions
az functionapp function list \
  --name func-qrattendance-dev \
  --resource-group rg-qr-attendance-dev \
  --query "[].{Name:name}" -o table
```

## Troubleshooting

### Backend Deployment Fails
1. Check Node.js version matches (see `.nvmrc`)
2. Ensure dependencies are installed: `cd backend && npm install`
3. Build locally first: `npm run build`
4. Check for TypeScript errors: `npm run build`

### Frontend Deployment Fails
1. Check build succeeds locally: `cd frontend && npm run build`
2. Verify Static Web App deployment token is valid
3. Check GitHub Actions logs if using CI/CD

### Functions Not Working After Deployment
1. Check function app is running: `az functionapp show ...`
2. Verify app settings are correct
3. Check Application Insights for errors
4. Restart function app: `az functionapp restart ...`

## Environment Variables

### Required Backend Settings
- `AzureWebJobsStorage` - Storage account connection string
- `AZURE_OPENAI_ENDPOINT` - OpenAI endpoint URL
- `AZURE_OPENAI_KEY` - OpenAI API key
- `AZURE_OPENAI_DEPLOYMENT` - Deployment name
- `AzureSignalRConnectionString` - SignalR connection string

### Required Frontend Settings
- `NEXT_PUBLIC_API_URL` - Backend API URL (usually `/api`)

## Deployment Checklist

Before deploying to production:

- [ ] All tests pass locally
- [ ] Backend builds without errors
- [ ] Frontend builds without errors
- [ ] Environment variables configured
- [ ] Database migrations applied (if any)
- [ ] CORS settings configured
- [ ] Authentication configured
- [ ] Monitoring/Application Insights enabled
- [ ] Backup strategy in place

## Rollback Procedure

If deployment fails or causes issues:

1. **Backend**: Redeploy previous version
   ```bash
   cd backend
   git checkout <previous-commit>
   func azure functionapp publish func-qrattendance-dev --typescript
   ```

2. **Frontend**: Revert via GitHub Actions or redeploy previous build

3. **Infrastructure**: Revert Bicep changes and redeploy
   ```bash
   git checkout <previous-commit>
   ./deploy-full-development.sh
   ```

## CI/CD Integration

The project uses GitHub Actions for automated deployment:

- **Backend**: Deployed on push to `main` branch
- **Frontend**: Deployed via Static Web Apps GitHub integration
- **Infrastructure**: Manual deployment via scripts

See `.github/workflows/` for workflow definitions.
