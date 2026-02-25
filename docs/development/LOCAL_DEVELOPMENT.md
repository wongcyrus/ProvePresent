# Local Development Guide

Complete guide for all local development scenarios.

---

## Quick Start

Choose your development environment:

```bash
# Pure local (Azurite, no production)
./scripts/start-local-dev.sh

# Local + Production OpenAI (test Live Quiz safely)
./start-local-with-openai.sh

# Local frontend + Production backend
./start-local-with-prod.sh

# Local backend + frontend + Production Azure
./start-local-prod.sh
```

---

## Environment Options

### 1. Pure Local Development (Recommended for Learning)

**Script**: `./scripts/start-local-dev.sh`

**What runs locally**:
- Frontend (port 3000)
- Backend (port 7071)
- Azurite (local Azure emulator)

**Use when**:
- Learning the system
- No internet needed
- Safe testing without affecting production

**URLs**:
- Frontend: http://localhost:3000
- Backend: http://localhost:7071/api
- Dev Config: http://localhost:3000/dev-config

---

### 2. Local with Production OpenAI (Test Live Quiz)

**Script**: `./start-local-with-openai.sh`

**What runs locally**:
- Frontend (port 3000)
- Backend (port 7071)
- Azurite (local database)

**What uses production**:
- Azure OpenAI only

**Use when**:
- Testing Live Quiz feature
- Safe testing with production AI
- No production data affected
- Learning AI features

**URLs**:
- Frontend: http://localhost:3000
- Backend: http://localhost:7071/api
- Azurite: http://127.0.0.1:10002

---

### 3. Local Frontend + Production Backend

**Script**: `./start-local-with-prod.sh`

**What runs locally**:
- Frontend only (port 3002)

**What uses production**:
- Backend API
- Database
- SignalR
- Azure OpenAI

**Use when**:
- Frontend development only
- Testing UI with real data
- No backend code changes needed

**URLs**:
- Frontend: http://localhost:3002
- Backend: https://func-qrattendance-prod.azurewebsites.net/api

---

### 4. Local Backend + Frontend with Production Azure

**Script**: `./start-local-prod.sh`

**What runs locally**:
- Frontend (port 3001)
- Backend (port 7071)

**What uses production**:
- Storage Account
- SignalR Service
- Azure OpenAI
- Database Tables

**Use when**:
- Backend development
- Testing with production data
- Debugging backend issues
- Testing before deployment

**URLs**:
- Frontend: http://localhost:3001
- Backend: http://localhost:7071/api

⚠️ **Warning**: Connects to production Azure resources!

---

## Prerequisites

### Required Tools
```bash
# Node.js 20+
node --version

# Azure Functions Core Tools
npm install -g azure-functions-core-tools@4

# Azure CLI (for production connections)
az login
```

### Install Dependencies
```bash
# Backend
cd backend && npm install

# Frontend
cd frontend && npm install --legacy-peer-deps
```

---

## Configuration Files

### Pure Local Dev

**backend/local.settings.json**:
```json
{
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "STORAGE_ACCOUNT_NAME": "devstoreaccount1",
    "SIGNALR_CONNECTION_STRING": "<dev-signalr>"
  }
}
```

**frontend/.env.local**:
```env
NEXT_PUBLIC_API_URL=http://localhost:7071/api
NEXT_PUBLIC_ENVIRONMENT=local
```

### Local with Production Backend

**frontend/.env.local**:
```env
NEXT_PUBLIC_API_URL=https://func-qrattendance-prod.azurewebsites.net/api
NEXT_PUBLIC_AAD_REDIRECT_URI=http://localhost:3002/.auth/login/aad/callback
```

### Local with Production Azure

**backend/local.settings.json** (auto-generated):
```json
{
  "Values": {
    "AzureWebJobsStorage": "<prod-storage-connection>",
    "STORAGE_ACCOUNT_NAME": "stqrattendanceprod",
    "SIGNALR_CONNECTION_STRING": "<prod-signalr-connection>",
    "AZURE_OPENAI_ENDPOINT": "<prod-openai-endpoint>",
    "AZURE_OPENAI_KEY": "<prod-openai-key>"
  }
}
```

**frontend/.env.local** (auto-generated):
```env
NEXT_PUBLIC_API_URL=http://localhost:7071/api
NEXT_PUBLIC_AAD_REDIRECT_URI=http://localhost:3001/.auth/login/aad/callback
```

---

## Mock Authentication (Local Only)

### Default Login
When `NEXT_PUBLIC_ENVIRONMENT=local`:
- Click "Login with Azure AD"
- Auto-login as Teacher (teacher@vtc.edu.hk)

### Switch Roles
Visit: http://localhost:3000/dev-config
- 👨‍🏫 Teacher - Create sessions, view attendance
- 👨‍🎓 Student - Join sessions, scan QR codes

### How It Works
- `/.auth/login/aad` → `/api/auth/mock-login`
- `/.auth/me` → `/api/auth/me`
- User info stored in HTTP-only cookie

---

## Testing

### Test as Teacher
1. Open frontend URL
2. Click "Login with Azure AD"
3. Click "Teacher Dashboard"
4. Create a session

### Test as Student
1. Go to /dev-config
2. Select "Student" role
3. Click "Set User & Login"
4. Join a session

### Test API
```bash
# Get user info
curl http://localhost:3000/api/auth/me

# Backend health
curl http://localhost:7071/api/health
```

---

## Development Workflow

### Making Changes

**Frontend Changes**:
1. Edit files in `frontend/src/`
2. Changes hot-reload automatically
3. Test in browser

**Backend Changes**:
1. Edit files in `backend/src/`
2. Restart backend (Ctrl+C, then `npm start`)
3. Test API endpoints

### Debugging

**Frontend**:
- Browser DevTools (F12)
- React DevTools extension
- Console logs

**Backend**:
- Terminal logs
- Add `console.log()` statements
- Azure Functions Core Tools output

---

## Troubleshooting

### Port Already in Use
```bash
# Kill process on port
lsof -ti:3000 | xargs kill -9  # Frontend
lsof -ti:7071 | xargs kill -9  # Backend
```

### Frontend Won't Start
```bash
rm -rf frontend/.next frontend/node_modules
cd frontend && npm install --legacy-peer-deps
```

### Backend Won't Start
```bash
rm -rf backend/dist backend/node_modules
cd backend && npm install
```

### Mock Auth Not Working
- Check `NEXT_PUBLIC_ENVIRONMENT=local` in `.env.local`
- Clear browser cookies
- Restart frontend

### Can't Connect to Production Azure
- Run `az login`
- Check network connectivity
- Verify resource access permissions

### Azurite Issues
```bash
# Install Azurite
npm install -g azurite

# Start Azurite
azurite --silent --location ./azurite
```

---

## Environment Comparison

| Feature | Pure Local | Local + OpenAI | Local + Prod BE | Local + Prod Azure |
|---------|------------|----------------|-----------------|-------------------|
| **Frontend** | Local (3000) | Local (3000) | Local (3002) | Local (3001) |
| **Backend** | Local (7071) | Local (7071) | Production | Local (7071) |
| **Database** | Azurite | Azurite | Production | Production |
| **SignalR** | Local/Dev | Local | Production | Production |
| **OpenAI** | N/A | Production | Production | Production |
| **Internet** | Optional | Required | Required | Required |
| **Safe** | ✅ Yes | ✅ Yes | ⚠️ Careful | ⚠️ Careful |

---

## Safety Guidelines

### Safe to Test (Pure Local)
- ✅ All features
- ✅ Destructive operations
- ✅ Mass updates
- ✅ Learning/experimenting

### Be Careful (Production Connections)
- ⚠️ Database writes
- ⚠️ Deleting data
- ⚠️ Testing with real users
- ⚠️ Mass operations

### Best Practices
1. Test in pure local first
2. Use test accounts, not real users
3. Create isolated test sessions
4. Verify before writing to production
5. Monitor logs for errors

---

## Stopping Services

```bash
# Stop all services
./dev-tools.sh stop

# Or press Ctrl+C in each terminal
```

---

## Key Files

```
backend/
  local.settings.json          # Backend configuration
  src/functions/               # API endpoints

frontend/
  .env.local                   # Frontend configuration
  src/pages/dev-config.tsx     # Role switcher
  src/pages/api/auth/          # Mock auth

scripts/
  start-local-dev.sh           # Pure local startup
  setup-local-dev.sh           # Setup script

start-local-with-prod.sh       # Local FE + Prod BE
start-local-prod.sh            # Local + Prod Azure
```

---

## Related Documentation

- **DEPLOYMENT.md** - Deploy to Azure
- **ENVIRONMENTS.md** - Environment scripts reference
- **DEV_TOOLS.md** - Development commands
- **DATABASE_MANAGEMENT.md** - Database operations

---

## Quick Reference

```bash
# Pure local development
./scripts/start-local-dev.sh

# Local with production OpenAI (test Live Quiz)
./start-local-with-openai.sh

# Frontend dev with production backend
./start-local-with-prod.sh

# Backend dev with production Azure
./start-local-prod.sh

# Stop all services
./dev-tools.sh stop

# Switch user role (pure local only)
open http://localhost:3000/dev-config
```

---

**You're ready to develop!** Choose your environment and start coding. 🚀
