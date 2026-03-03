# Deployment Verification Checklist

## Pre-Deployment

- [ ] `.external-id-credentials` file exists with valid credentials
- [ ] Node.js 22 is installed and active
- [ ] Azure CLI is logged in (`az login`)
- [ ] All scripts are executable (`chmod +x *.sh`)

## Agent Migration Status

### Quiz Generation Agent
- [x] Script created: `create-persistent-agent.sh`
- [x] Integrated into deployment script
- [x] Uses managed identity (no API key)
- [x] Environment variable: `AZURE_AI_AGENT_ID`

### Position Estimation Agent
- [x] Script created: `create-position-estimation-agent.sh`
- [x] Integrated into deployment script
- [x] Code migrated: `backend/src/utils/gptPositionEstimation.ts`
- [x] Uses managed identity (no API key)
- [x] Environment variable: `AZURE_AI_POSITION_AGENT_ID`

### Slide Analysis
- [ ] Still uses API key (migration pending)
- [ ] Environment variable: `AZURE_OPENAI_KEY`

## Deployment Script Verification

### Agent Creation (Step 3.5)
- [x] Creates quiz agent automatically
- [x] Creates position estimation agent automatically
- [x] Saves agent IDs to `.agent-config.env`
- [x] Updates Function App settings with agent IDs
- [x] Handles errors gracefully (continues on failure)

### Backend Deployment (Step 5)
- [x] Loads `AZURE_AI_AGENT_ID` from config
- [x] Loads `AZURE_AI_POSITION_AGENT_ID` from config
- [x] Adds both agent IDs to `local.settings.json`
- [x] Adds `AZURE_AI_PROJECT_ENDPOINT` to settings
- [x] Deploys with all agent configurations

## Post-Deployment Verification

### 1. Check Agent Creation
```bash
# Verify quiz agent
TOKEN=$(az account get-access-token --resource https://ai.azure.com --query accessToken -o tsv)
curl -s -X GET \
  "https://openai-qrattendance-dev.services.ai.azure.com/api/projects/openai-qrattendance-dev-project/assistants?api-version=2025-05-01" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | select(.name=="QuizQuestionGenerator")'

# Verify position estimation agent
curl -s -X GET \
  "https://openai-qrattendance-dev.services.ai.azure.com/api/projects/openai-qrattendance-dev-project/assistants?api-version=2025-05-01" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | select(.name=="PositionEstimationAgent")'
```

Expected: Both agents should be returned with their IDs and configurations.

### 2. Check Function App Settings
```bash
# Check quiz agent ID
az functionapp config appsettings list \
  --name func-qrattendance-dev \
  --resource-group rg-qr-attendance-dev \
  --query "[?name=='AZURE_AI_AGENT_ID'].value" -o tsv

# Check position agent ID
az functionapp config appsettings list \
  --name func-qrattendance-dev \
  --resource-group rg-qr-attendance-dev \
  --query "[?name=='AZURE_AI_POSITION_AGENT_ID'].value" -o tsv

# Check project endpoint
az functionapp config appsettings list \
  --name func-qrattendance-dev \
  --resource-group rg-qr-attendance-dev \
  --query "[?name=='AZURE_AI_PROJECT_ENDPOINT'].value" -o tsv
```

Expected: All three settings should return valid values (agent IDs start with `asst_`).

### 3. Check Local Config File
```bash
cat .agent-config.env
```

Expected output:
```bash
# Azure AI Foundry Persistent Agent Configuration
# Generated: [timestamp]
# Note: Uses managed identity authentication - no API keys needed

AZURE_AI_PROJECT_ENDPOINT=https://openai-qrattendance-dev.services.ai.azure.com/api/projects/openai-qrattendance-dev-project
AZURE_AI_AGENT_ID=asst_[quiz-agent-id]
AZURE_AI_POSITION_AGENT_ID=asst_[position-agent-id]
AZURE_OPENAI_ENDPOINT=https://openai-qrattendance-dev.cognitiveservices.azure.com/
WORKING_API_VERSION=2025-05-01
```

### 4. Test Quiz Generation
```bash
# Test via Function App
curl -X POST "https://func-qrattendance-dev.azurewebsites.net/api/sessions/test-session/quiz/generate-questions" \
  -H "Content-Type: application/json" \
  -d '{
    "slideAnalysis": {
      "topic": "Azure",
      "keyPoints": ["Cloud computing", "Scalability"],
      "difficulty": "BEGINNER"
    },
    "count": 1,
    "difficulty": "BEGINNER"
  }'
```

Expected: JSON response with generated questions (no API key errors).

### 5. Test Position Estimation
This requires a capture session with uploaded images. Check Function App logs:
```bash
az functionapp logs tail \
  --name func-qrattendance-dev \
  --resource-group rg-qr-attendance-dev
```

Look for:
- "Using position estimation agent: asst_..."
- "Created thread: ..."
- "Agent run completed"
- No "AZURE_OPENAI_KEY" errors

## Troubleshooting

### Agent Not Found Error
**Symptom**: `AZURE_AI_POSITION_AGENT_ID environment variable is required`

**Solution**:
1. Check if agent was created: `cat .agent-config.env`
2. If missing, run manually: `./create-position-estimation-agent.sh rg-qr-attendance-dev openai-qrattendance-dev`
3. Redeploy backend: `cd backend && func azure functionapp publish func-qrattendance-dev --typescript`

### 401 Unauthorized Error
**Symptom**: `Failed to get Azure AD token`

**Solution**:
1. Check RBAC roles are assigned (see `AGENT_SERVICE_GUIDE.md`)
2. Wait 1-2 minutes for role propagation
3. Restart Function App: `az functionapp restart --name func-qrattendance-dev --resource-group rg-qr-attendance-dev`

### API Key Error (Position Estimation)
**Symptom**: `AZURE_OPENAI_KEY is required`

**Solution**:
1. Verify migration is complete: `grep -n "getAgentClient" backend/src/utils/gptPositionEstimation.ts`
2. Check Function App has position agent ID
3. Rebuild and redeploy backend

### Old Endpoint Format
**Symptom**: Endpoint contains "hyena.infra.ai.azure.com"

**Solution**:
1. Delete `.agent-config.env`
2. Run agent creation scripts again
3. Redeploy backend

## Success Criteria

- [ ] Both agents created successfully
- [ ] Both agent IDs in Function App settings
- [ ] Quiz generation works without API key
- [ ] Position estimation works without API key
- [ ] No authentication errors in logs
- [ ] `.agent-config.env` contains no API keys

## Rollback Plan

If deployment fails:

1. **Revert backend code**:
   ```bash
   git checkout HEAD~1 backend/src/utils/gptPositionEstimation.ts
   cd backend && npm run build
   func azure functionapp publish func-qrattendance-dev --typescript
   ```

2. **Ensure API key is set**:
   ```bash
   az functionapp config appsettings set \
     --name func-qrattendance-dev \
     --resource-group rg-qr-attendance-dev \
     --settings "AZURE_OPENAI_KEY=<key>"
   ```

3. **Restart Function App**:
   ```bash
   az functionapp restart \
     --name func-qrattendance-dev \
     --resource-group rg-qr-attendance-dev
   ```

## Documentation

- [AGENT_SERVICE_GUIDE.md](./AGENT_SERVICE_GUIDE.md) - Complete agent service guide
- [API_KEY_REMOVAL_SUMMARY.md](./API_KEY_REMOVAL_SUMMARY.md) - Migration overview
- [POSITION_ESTIMATION_MIGRATION.md](./POSITION_ESTIMATION_MIGRATION.md) - Detailed migration guide
- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) - General deployment guide

## Next Steps

After successful deployment:

1. Monitor Function App logs for any errors
2. Test all features thoroughly
3. Migrate slide analysis to agent service (Phase 3)
4. Remove API key from infrastructure (Phase 4)
