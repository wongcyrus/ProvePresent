# Azure AI Agent Setup Guide

## Overview

This project uses Azure AI Foundry Agents for AI-powered features. Four agents are configured:

1. **QuizQuestionGenerator** - Generates quiz questions from lecture slides
2. **SlideAnalysisAgent** - Analyzes slide images into structured quiz context
3. **PositionEstimationAgent** - Estimates attendee seating positions from photos
4. **ImageAnalysisAgent** - Analyzes attendee images with custom prompts

## Agent Creation

### Automated Setup (Recommended)

The `create-agents.ts` script automatically creates all four agents:

```bash
# Get resource information
RESOURCE_GROUP="your-resource-group"
OPENAI_NAME="your-openai-resource"
PROJECT_NAME="your-project-name"  # Optional, defaults to {OPENAI_NAME}-project

# Create agents
npx tsx create-agents.ts $RESOURCE_GROUP $OPENAI_NAME $PROJECT_NAME
```

The script will:
1. Verify Azure AI Foundry project exists
2. Create all four agents with proper configurations
3. Generate `.agent-config.env` with agent references
4. Optionally update Function App settings

### Manual Setup

If automated setup fails, create agents manually in Azure AI Foundry portal:

1. Navigate to [Azure AI Foundry](https://ai.azure.com)
2. Select your project
3. Go to "Agents" section
4. Create each agent with configurations below

#### Quiz Question Generator

```yaml
Name: QuizQuestionGenerator
Model: gpt-4o or gpt-5.4
Instructions: |
  You are a quiz question generator. Your ONLY job is to return valid JSON with quiz questions.
  
  CRITICAL RULES:
  1. DO NOT repeat or echo the user's message
  2. DO NOT include any explanatory text before or after the JSON
  3. ONLY return the JSON object, nothing else
  
  QUESTION REQUIREMENTS:
  - Keep questions SHORT (maximum 15 words)
  - Use simple, clear language
  - ONLY create MULTIPLE_CHOICE questions with 4 options
  - Match the specified difficulty level
  - Test comprehension, not memorization
  
  JSON FORMAT (return EXACTLY this structure):
  {
    "questions": [
      {
        "text": "Short question?",
        "type": "MULTIPLE_CHOICE",
        "difficulty": "EASY" or "MEDIUM" or "HARD",
        "options": ["Option A", "Option B", "Option C", "Option D"],
        "correctAnswer": "Option A",
        "explanation": "Brief explanation"
      }
    ]
  }
```

#### Position Estimation Agent

```yaml
Name: PositionEstimationAgent
Model: gpt-4o or gpt-5.4
Instructions: |
  You are a seating position estimation AI. Analyze venue photos to estimate attendee seating positions.
  
  CRITICAL RULES:
  1. DO NOT repeat or echo the user's message
  2. DO NOT include any explanatory text before or after the JSON
  3. ONLY return the JSON object, nothing else
  
  ANALYSIS CRITERIA:
  - Projector screen visibility and angle (larger screen = closer to front)
  - Projector screen size in frame (larger = lower row number)
  - Classroom features in background
  - Relative positions compared to other students
  
  POSITION ASSIGNMENT:
  - Row 1 = closest to projector (front)
  - Higher row numbers = further back
  - Column 1 = leftmost from teacher's perspective
  - Higher column numbers = further right
  
  CONFIDENCE LEVELS:
  - HIGH: Clear projector visibility, distinct viewing angle
  - MEDIUM: Some projector visibility or venue features visible
  - LOW: No projector visible, limited classroom context
  
  JSON FORMAT (return EXACTLY this structure):
  {
    "positions": [
      {
        "attendeeId": "attendee@email.com",
        "estimatedRow": 2,
        "estimatedColumn": 3,
        "confidence": "HIGH" | "MEDIUM" | "LOW",
        "reasoning": "Brief explanation of position estimate"
      }
    ],
    "analysisNotes": "Overall observations about venue layout"
  }
```

#### Slide Analysis Agent

```yaml
Name: SlideAnalysisAgent
Model: gpt-4o or gpt-5.4
Instructions: |
  You are a slide analysis AI. Your ONLY job is to analyze a presentation slide image and return valid JSON.

  CRITICAL RULES:
  1. DO NOT repeat or echo the user's message
  2. DO NOT include any explanatory text before or after the JSON
  3. ONLY return the JSON object, nothing else

  JSON FORMAT (return EXACTLY this structure):
  {
    "topic": "Main topic or concept (1-2 words)",
    "title": "Slide title if visible",
    "keyPoints": ["Key point 1", "Key point 2"],
    "codeExamples": [],
    "formulas": [],
    "difficulty": "BEGINNER" | "INTERMEDIATE" | "ADVANCED",
    "subject": "Subject area",
    "summary": "Brief 1-2 sentence summary"
  }
```

#### Image Analysis Agent

```yaml
Name: ImageAnalysisAgent
Model: gpt-4o or gpt-5.4
Instructions: |
  You are an image analysis AI that answers questions about student-submitted venue photos.
  
  CRITICAL RULES:
  1. DO NOT repeat or echo the user's message
  2. DO NOT include any explanatory text before or after the JSON
  3. ONLY return the JSON object, nothing else
  
  YOUR TASK:
  - Analyze each image based on the organizer's custom prompt/question
  - Provide clear, concise, factual answers
  - Be specific about what you observe in each image
  - If you cannot determine something, say "Unable to determine" rather than guessing
  
  JSON FORMAT (return EXACTLY this structure):
  [
    {
      "imageNumber": 1,
      "attendeeId": "attendee@email.com",
      "analysis": "Your clear, concise answer to the organizer's question based on this image"
    },
    {
      "imageNumber": 2,
      "attendeeId": "attendee2@email.com",
      "analysis": "Your answer for the second image"
    }
  ]
```

## Environment Variables

After creating agents, configure these environment variables:

### Required
```bash
AZURE_AI_PROJECT_ENDPOINT=https://{openai-resource}.services.ai.azure.com/api/projects/{project-name}
```

### Agent References
```bash
# Quiz Agent
AZURE_AI_AGENT_NAME=QuizQuestionGenerator
AZURE_AI_AGENT_VERSION=1

# Slide Analysis Agent
# Hardcoded in backend as SlideAnalysisAgent, so it must exist in the project

# Position Estimation Agent
AZURE_AI_POSITION_AGENT_NAME=PositionEstimationAgent
AZURE_AI_POSITION_AGENT_VERSION=1

# Image Analysis Agent
AZURE_AI_ANALYSIS_AGENT_NAME=ImageAnalysisAgent
AZURE_AI_ANALYSIS_AGENT_VERSION=1
```

### Optional
```bash
AZURE_OPENAI_API_VERSION=2025-04-01-preview
AZURE_OPENAI_VISION_DEPLOYMENT=gpt-4o
```

## Deployment Integration

The deployment scripts automatically handle agent setup:

### CDKTF Full Deployment

```bash
cd infrastructure/cdktf
./deploy-full.sh staging
```

This flow:
1. deploys CDKTF infrastructure
2. publishes the backend
3. deploys the frontend to the SWA production environment
4. runs `create-agents.ts`
5. updates the Function App with the generated AI agent settings

### Development Deployment
```bash
./deploy-full-development.sh
```

This script:
1. Deploys infrastructure
2. Runs `create-agents.ts` automatically
3. Loads agent config from `.agent-config.env`
4. Configures Function App with agent settings

### Production Deployment
```bash
./deploy-full-production.sh
```

Same process as development with production parameters.

## Verification

### Check Agent Creation

```bash
# View generated config
cat .agent-config.env

# Expected output:
# AZURE_AI_PROJECT_ENDPOINT=https://...
# AZURE_AI_AGENT_NAME=QuizQuestionGenerator
# AZURE_AI_AGENT_VERSION=1
# SlideAnalysisAgent must also exist in the Foundry project
# AZURE_AI_POSITION_AGENT_NAME=PositionEstimationAgent
# AZURE_AI_POSITION_AGENT_VERSION=1
# AZURE_AI_ANALYSIS_AGENT_NAME=ImageAnalysisAgent
# AZURE_AI_ANALYSIS_AGENT_VERSION=1
```

### Test Agents

```bash
# Check Function App settings
az functionapp config appsettings list \
  --name your-function-app \
  --resource-group your-rg \
  --query "[?name=='AZURE_AI_AGENT_NAME'].value" -o tsv
```

### View in Portal

1. Go to [Azure AI Foundry](https://ai.azure.com)
2. Select your project
3. Navigate to "Agents"
4. Verify all four agents are listed

## Troubleshooting

### Agent Creation Fails

**Symptom**: `create-agents.ts` fails with "Project not found"

**Solutions**:
1. Wait 5-10 minutes after Bicep deployment for project provisioning
2. Verify project exists: `az resource show --ids "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.CognitiveServices/accounts/{openai}/projects/{project}"`
3. Check provisioning state is "Succeeded"

**Symptom**: "Unauthorized" or "Forbidden" errors

**Solutions**:
1. Run `az login` to refresh credentials
2. Ensure you have "Azure AI User" role on the project resource
3. Check RBAC in Azure Portal

### Function App Can't Access Agents

**Symptom**: Functions fail with "Agent not found"

**Solutions**:
1. Verify Function App has Managed Identity enabled
2. Assign "Azure AI User" role to Function App's managed identity
3. Check environment variables are set correctly

### Agent Responses Are Incorrect

**Symptom**: Agent returns wrong format or unexpected content

**Solutions**:
1. Review agent instructions in Azure AI Foundry
2. Update agent version if instructions changed
3. Test agent directly in Azure AI Foundry playground

## Best Practices

1. **Use Agent Versions**: Always specify agent version for consistency
2. **Monitor Usage**: Track agent calls in Application Insights
3. **Update Instructions**: Modify agent instructions in portal, then update version
4. **Test Before Deploy**: Test agents in Azure AI Foundry before deploying
5. **Keep Config Fresh**: Regenerate `.agent-config.env` when agents are recreated; do not rely on stale local copies

## Cost Optimization

- Agents use Azure OpenAI tokens
- Monitor usage in Azure Portal
- Set appropriate `maxTokens` limits in code
- Use caching where possible
- Consider batch processing for multiple requests

## Related Documentation

- [Batch Image Analysis Feature](../features/BATCH_IMAGE_ANALYSIS.md)
- [Deployment Guide](DEPLOYMENT_GUIDE.md)
- [Azure AI Foundry Documentation](https://learn.microsoft.com/azure/ai-studio/)

---

**Last Updated**: July 28, 2026
