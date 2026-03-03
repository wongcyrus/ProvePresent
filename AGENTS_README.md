# Azure AI Foundry Agents

## Current Status: New Agents API ✅

Agents are deployed using the **New Agents API** via TypeScript SDK (`@azure/ai-projects@^2.0.0-beta.5`).

## Your Agents

| Agent | Purpose |
|-------|---------|
| **QuizQuestionGenerator** | Generates quiz questions from lecture content |
| **PositionEstimationAgent** | Estimates student seating positions from photos |

## Quick Start

```bash
# Create/update agents
npx tsx create-agents.ts rg-qr-attendance-dev openai-qrattendance-dev
```

Re-running creates a **new version** of each agent (versioned agents).

## Configuration

Agents are configured in `.agent-config.env`:
```bash
AZURE_AI_PROJECT_ENDPOINT=https://openai-qrattendance-dev.services.ai.azure.com/api/projects/openai-qrattendance-dev-project
AZURE_AI_AGENT_ID=QuizQuestionGenerator:1
AZURE_AI_POSITION_AGENT_ID=PositionEstimationAgent:1
```

## Infrastructure

The Bicep template (`infrastructure/modules/openai.bicep`) creates:
- AI Services account with `allowProjectManagement: true`
- Foundry Project with managed identity
- Model deployment (gpt-4o)

Key settings per [Microsoft sample](https://github.com/microsoft-foundry/foundry-samples/blob/main/infrastructure/infrastructure-setup-bicep/40-basic-agent-setup/main.bicep):
- API Version: `2025-04-01-preview`
- `disableLocalAuth: true` (keyless auth)
- Project with `SystemAssigned` identity

## Authentication

- **Token Scope**: `https://ai.azure.com/.default`
- **RBAC**: Azure AI User role at PROJECT scope
- **Method**: Managed identity (no API keys)

## Scripts

| Script | Purpose |
|--------|---------|
| `create-agents.ts` | Create/update agents via TypeScript SDK |
| `undeploy-and-redeploy.sh` | Clean redeploy for testing Bicep changes |

## Backend Usage

- `backend/src/functions/generateQuestions.ts` - Quiz generation
- `backend/src/utils/gptPositionEstimation.ts` - Position estimation

## References

- [New Agents Quickstart](https://learn.microsoft.com/azure/foundry/quickstarts/get-started-code)
- [Azure AI Projects SDK](https://www.npmjs.com/package/@azure/ai-projects)
- [Basic Agent Setup Bicep](https://github.com/microsoft-foundry/foundry-samples/tree/main/infrastructure/infrastructure-setup-bicep/40-basic-agent-setup)
