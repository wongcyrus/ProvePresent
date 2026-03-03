# Azure AI Foundry Agent Service Guide

## Overview

This project uses the **New Agents API** via TypeScript SDK for quiz generation and position estimation.

## Architecture

```
Azure AI Services Account (AIServices)
  └── Foundry Project (with managed identity)
        └── Agents (QuizQuestionGenerator, PositionEstimationAgent)
              └── Model: gpt-4o
```

## Setup Requirements

### Bicep Configuration

Per [Microsoft's basic agent setup](https://github.com/microsoft-foundry/foundry-samples/blob/main/infrastructure/infrastructure-setup-bicep/40-basic-agent-setup/main.bicep):

```bicep
// Account
resource account 'Microsoft.CognitiveServices/accounts@2025-04-01-preview' = {
  kind: 'AIServices'
  identity: { type: 'SystemAssigned' }
  properties: {
    allowProjectManagement: true
    disableLocalAuth: true  // Keyless auth
  }
}

// Project
resource project 'Microsoft.CognitiveServices/accounts/projects@2025-04-01-preview' = {
  parent: account
  identity: { type: 'SystemAssigned' }
}

// Model deployment (required for agents)
resource modelDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: account
  name: 'gpt-4o'
  properties: {
    model: { name: 'gpt-4o', format: 'OpenAI', version: '2024-11-20' }
  }
}
```

### RBAC

Azure AI User role at **PROJECT** scope (not account scope).

## TypeScript SDK Usage

### Create Agent
```typescript
import { AIProjectClient } from '@azure/ai-projects';
import { DefaultAzureCredential } from '@azure/identity';

const client = new AIProjectClient(projectEndpoint, new DefaultAzureCredential());

const agent = await client.agents.createVersion('MyAgent', {
  kind: 'prompt',
  model: 'gpt-4o',
  instructions: 'You are a helpful assistant...'
});
// Returns: { id: 'MyAgent:1', name: 'MyAgent', version: 1 }
```

### List Agents
```typescript
for await (const agent of client.agents.list()) {
  console.log(agent.name, agent.version);
}
```

## Authentication

| Setting | Value |
|---------|-------|
| Token Scope | `https://ai.azure.com/.default` |
| API Version | `2025-05-01` (GA) |
| Endpoint Format | `https://<resource>.services.ai.azure.com/api/projects/<project>` |

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| 401 Unauthorized | Wrong token scope | Use `https://ai.azure.com/.default` |
| 404 Project not found | Missing RBAC or project not ready | Assign Azure AI User at project scope, wait 2-5 min |
| No model deployment | Model not deployed | Enable model deployment in Bicep parameters |

## Files

| File | Purpose |
|------|---------|
| `infrastructure/modules/openai.bicep` | AI Services + Project + Model |
| `create-agents.ts` | Agent creation script |
| `.agent-config.env` | Agent IDs and endpoints |

## References

- [Microsoft Foundry Samples](https://github.com/microsoft-foundry/foundry-samples)
- [SDK Overview](https://learn.microsoft.com/azure/foundry/how-to/develop/sdk-overview)
