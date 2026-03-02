# OpenAI Single Model Deployment Fix

## Problem

Deployment was failing with error 715-123420 because:
1. Multiple OpenAI models were being deployed (gpt-4o, gpt-4o-vision, gpt-5.2-chat)
2. Total capacity exceeded dev environment quota
3. Project only uses gpt-5.2-chat, but infrastructure was deploying unnecessary models

## Solution

Deploy ONLY gpt-5.2-chat with minimal capacity (3 TPM) for dev environment.

## Changes Made

### 1. Made GPT-4 Deployment Conditional

**infrastructure/modules/openai.bicep:**
- Added `deployGpt4Model` parameter (default: true)
- Made `gpt4Deployment` resource conditional: `= if (deployGpt4Model)`
- Updated dependencies to handle conditional deployments
- Updated outputs to return empty string when not deployed

### 2. Updated Main Template

**infrastructure/main.bicep:**
- Added `deployGpt4Model` parameter
- Passed parameter to openai module

### 3. Configured Dev Environment

**infrastructure/parameters/dev.bicepparam:**
```bicep
param deployAzureOpenAI = true
param deployGpt4Model = false  // Disabled - not used in project
param deployVisionModel = false  // Disabled - not used in project
param deployGpt52ChatModel = true  // ONLY model we use
param gpt52ChatCapacity = 3  // Minimal capacity for dev
```

## Current Deployment

```
Name          Model         Version     Capacity    State
------------  ------------  ----------  ----------  ---------
gpt-5.2-chat  gpt-5.2-chat  2026-02-10  3           Succeeded
```

**Single deployment with capacity 3 TPM**

## Why This Works

1. **Quota Efficient**: Only 1 model × 3 capacity = 3 total capacity units
2. **Project Aligned**: Deploys only the model actually used (gpt-5.2-chat)
3. **Dev Appropriate**: 3K TPM sufficient for development testing
4. **Production Ready**: Can scale up capacity in prod parameters

## Capacity Comparison

| Environment | GPT-4 | GPT-4 Vision | GPT-5.2-chat | Total |
|-------------|-------|--------------|--------------|-------|
| **Production** | 10 | 10 | 250 | 270 |
| **Development (OLD)** | 10 | 10 | 250 | 270 ❌ |
| **Development (NEW)** | - | - | 3 | 3 ✅ |

## Production Configuration

Production can deploy all models with full capacity:

```bicep
// infrastructure/parameters/prod.bicepparam
param deployGpt4Model = true  // Optional
param deployVisionModel = true  // Optional
param deployGpt52ChatModel = true  // Primary model
param gpt4Capacity = 10
param gpt4VisionCapacity = 10
param gpt52ChatCapacity = 250
```

## Testing

Deployment successful:
```bash
az deployment group create \
  --resource-group rg-qr-attendance-dev \
  --template-file infrastructure/main.bicep \
  --parameters infrastructure/parameters/dev.bicepparam \
  --name qr-attendance-dev-deployment

# Result: Succeeded ✅
```

## Files Modified

1. ✅ `infrastructure/modules/openai.bicep`
   - Added `deployGpt4Model` parameter
   - Made GPT-4 deployment conditional
   - Fixed dependencies for conditional deployments

2. ✅ `infrastructure/main.bicep`
   - Added `deployGpt4Model` parameter
   - Passed to openai module

3. ✅ `infrastructure/parameters/dev.bicepparam`
   - Disabled GPT-4 models
   - Enabled only GPT-5.2-chat
   - Set capacity to 3

## Next Steps

1. ✅ OpenAI deployed successfully
2. ⏳ Continue with full deployment script
3. ⏳ Deploy backend functions
4. ⏳ Deploy frontend

---

**Fixed:** 2026-03-02  
**Status:** ✅ Complete  
**Deployment:** Single model (gpt-5.2-chat) with capacity 3
