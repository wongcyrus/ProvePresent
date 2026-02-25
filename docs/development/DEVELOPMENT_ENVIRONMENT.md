# Development Environment Guide

This guide explains how to set up and use the development environment for QR Chain Attendance.

## 🚀 Quick Start

### 1. Deploy Development Environment to Azure
```bash
./deploy-full-development.sh
```

### 2. Configure Local Development
```bash
./setup-local-dev-env.sh
```

### 3. Start Local Development Servers
```bash
./start-local-dev.sh
```

## 📋 Environment Scripts

### Development Deployment
- **`deploy-full-development.sh`** - Deploys complete development environment to Azure
  - Uses `infrastructure/parameters/dev.bicepparam` for dev-specific settings
  - Creates `rg-qr-attendance-dev` resource group
  - Deploys with development-optimized configurations
  - Enables Azure OpenAI and Live Quiz features
  - Creates all database tables

### Local Development Setup
- **`setup-local-dev-env.sh`** - Configures local development to connect to dev environment
  - Connects to development Azure resources
  - Creates `backend/local.settings.json` with dev connection strings
  - Creates `frontend/.env.local` for local development
  - Installs all dependencies

### Development Server Management
- **`start-local-dev.sh`** - Starts both frontend and backend servers locally
  - Backend runs on `http://localhost:7071`
  - Frontend runs on `http://localhost:3000`
  - Handles dependencies and port checking

### Environment Cleanup
- **`undeploy-development.sh`** - Completely removes development environment
  - Deletes all Azure resources
  - Removes Azure AD redirect URIs
  - Purges soft-deleted resources
  - Cleans up local configuration files

## 🏗️ Architecture Differences

### Development Environment
- **Resource Group**: `rg-qr-attendance-dev`
- **Function App**: `func-qrattendance-dev`
- **Storage**: `stqrattendancedev`
- **Static Web App**: `swa-qrattendance-dev`
- **Azure OpenAI**: `openai-qrattendance-dev` (enabled)
- **SignalR**: `signalr-qrattendance-dev` (enabled)

### Bicep Parameters (dev.bicepparam)
```bicep
param environment = 'dev'
param deployAzureOpenAI = true    // Enabled for Live Quiz
param deploySignalR = true        // Enabled for real-time features
param gpt4ModelVersion = '1106-Preview'  // Latest dev version
param tags = {
  Environment: 'Development'
  Application: 'QR Chain Attendance'
  ManagedBy: 'Bicep'
  CostCenter: 'Engineering'
}
```

## 🔧 Development Workflow

### Initial Setup
1. **Deploy to Azure**: `./deploy-full-development.sh`
   - Creates all Azure resources
   - Deploys backend functions
   - Builds and deploys frontend
   - Initializes database tables

2. **Configure Local**: `./setup-local-dev-env.sh`
   - Retrieves connection strings from Azure
   - Sets up local development configuration
   - Installs dependencies

3. **Start Development**: `./start-local-dev.sh`
   - Starts local servers
   - Backend connects to dev database
   - Frontend connects to local backend

### Daily Development
```bash
# Start development servers
./start-local-dev.sh

# Frontend: http://localhost:3000
# Backend:  http://localhost:7071
```

### Reset Development Environment
```bash
# Clean up everything
./undeploy-development.sh

# Deploy fresh environment  
./deploy-full-development.sh

# Reconfigure local development
./setup-local-dev-env.sh
```

## 🌐 URL Structure

### Local Development URLs
- **Frontend**: http://localhost:3000
- **Backend**: http://localhost:7071
- **Function Health**: http://localhost:7071/api/health

### Azure Development URLs  
- **Frontend**: https://swa-qrattendance-dev.azurestaticapps.net
- **Backend**: https://func-qrattendance-dev.azurewebsites.net
- **Function Health**: https://func-qrattendance-dev.azurewebsites.net/api/health

## 🔐 Authentication & Configuration

### Azure AD Configuration
- Uses same Azure AD app as production
- Redirect URIs automatically managed
- Local development uses `http://localhost:3000/api/auth/callback`
- Azure deployment uses generated Static Web App URL

### Environment Variables

#### Backend Local Settings
```json
{
  "Values": {
    "StorageConnectionString": "dev-azure-storage-connection",
    "AzureOpenAI__Endpoint": "https://openai-qrattendance-dev.cognitiveservices.azure.com/",
    "Environment": "local-dev",
    "DEBUG": "*"
  }
}
```

#### Frontend Local Environment
```bash
NEXT_PUBLIC_API_URL=http://localhost:7071
NEXT_PUBLIC_ENVIRONMENT=local-dev
NEXT_PUBLIC_AAD_CLIENT_ID=your-azure-ad-client-id
NEXT_PUBLIC_AAD_REDIRECT_URI=http://localhost:3000/api/auth/callback
```

## 🗄️ Database & Storage

### Development Database
- **Storage Account**: `stqrattendancedev`
- **Tables**: 12 tables (same as production)
- **Data**: Isolated from production
- **Connection**: Local backend connects to dev Azure storage

### Table Structure
Same as production:
- Attendance
- AttendanceSnapshots  
- ChainHistory
- Chains
- DeletionLog
- QuizMetrics
- QuizQuestions
- QuizResponses
- ScanLogs
- Students
- Teachers
- Sessions

## 🤖 AI Features

### Azure OpenAI Integration
- **Service**: `openai-qrattendance-dev`
- **Models**: 
  - GPT-4: `gpt-4` (version: 1106-Preview)
  - GPT-4 Vision: `gpt-4-vision` (vision-preview)
- **Features**: Live Quiz slide analysis, AI insights

### SignalR Integration
- **Service**: `signalr-qrattendance-dev`
- **Purpose**: Real-time quiz updates, live attendance
- **Fallback**: Polling if SignalR unavailable

## 🔍 Development Tips

### Debugging
- Backend logs available in terminal when running `npm run start`
- Frontend logs in browser console
- Azure Function logs in Azure portal
- Application Insights for Azure debugging

### Testing
- Use development environment for feature testing
- Local environment for rapid iteration
- Production environment for final validation

### Hot Reload
- Frontend: Automatic reload on code changes
- Backend: Restart required for function changes (`func start`)

### Port Configuration
- Backend: Port 7071 (Azure Functions default)
- Frontend: Port 3000 (Next.js default)  
- Alternative frontend port: `npm run dev -- --port 3001`

## 📝 Troubleshooting

### Common Issues

**Backend not starting**
```bash
cd backend
npm install
npm run build
npm run start
```

**Frontend build errors**
```bash
cd frontend
npm install
rm -rf .next
npm run dev
```

**Database connection issues**
```bash
# Reconfigure local development
./setup-local-dev-env.sh
```

**Azure resource conflicts**
```bash
# Clean up and redeploy
./undeploy-development.sh
./deploy-full-development.sh
```

### Configuration Files

**Check backend configuration**
```bash
cat backend/local.settings.json
```

**Check frontend configuration**  
```bash
cat frontend/.env.local
```

**Check deployment info**
```bash
cat deployment-info.json
```

## 🚀 Deployment Promotion

### From Development to Production
1. Test thoroughly in development environment
2. Commit code changes to main branch
3. Deploy to production: `./deploy-full-production.sh`
4. Verify production deployment
5. Update production documentation

### Environment Parity
- Both use same bicep infrastructure templates
- Same Azure services and configurations
- Only resource names and settings differ
- Database schemas identical