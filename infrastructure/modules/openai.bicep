// Azure OpenAI Service (Optional)
// Requirements: 19.3
// Updated: Support for Live Quiz feature with GPT-4 and GPT-4 Vision
// API Version: 2024-10-01 (updated from 2023-05-01 for better compatibility)
// Kind: AIServices (updated from OpenAI for unified AI services)

@description('Azure OpenAI resource name')
param openAIName string

@description('Location for Azure OpenAI')
param location string

@description('GPT-4 model deployment name')
param gpt4DeploymentName string = 'gpt-4'

@description('GPT-4 model name')
param gpt4ModelName string = 'gpt-4'

@description('GPT-4 model version')
param gpt4ModelVersion string = '0613'

@description('GPT-4 Vision model deployment name')
param gpt4VisionDeploymentName string = 'gpt-4-vision'

@description('GPT-4 Vision model name')
param gpt4VisionModelName string = 'gpt-4'

@description('GPT-4 Vision model version')
param gpt4VisionModelVersion string = 'vision-preview'

@description('Deploy GPT-4 Vision model (required for Live Quiz feature)')
param deployVisionModel bool = true

@description('Deploy GPT-4 base model')
param deployGpt4Model bool = true

@description('GPT-5.2-chat model deployment name')
param gpt52ChatDeploymentName string = 'gpt-5.2-chat'

@description('GPT-5.2-chat model name')
param gpt52ChatModelName string = 'gpt-5.2-chat'

@description('GPT-5.2-chat model version')
param gpt52ChatModelVersion string = '2026-02-10'

@description('Deploy GPT-5.2-chat model (preview - most advanced model, supported by agents)')
param deployGpt52ChatModel bool = false

@description('GPT-5.4 model deployment name')
param gpt54DeploymentName string = 'gpt-5.4'

@description('GPT-5.4 model name')
param gpt54ModelName string = 'gpt-5.4'

@description('GPT-5.4 model version')
param gpt54ModelVersion string = '2026-03-05'

@description('Deploy GPT-5.4 model (latest model with highest capabilities)')
param deployGpt54Model bool = true

@description('GPT-4 deployment capacity (TPM in thousands)')
param gpt4Capacity int = 10

@description('GPT-4 Vision deployment capacity (TPM in thousands)')
param gpt4VisionCapacity int = 10

@description('GPT-5.2-chat deployment capacity (TPM in thousands)')
param gpt52ChatCapacity int = 250

@description('GPT-5.4 deployment capacity (TPM in thousands)')
param gpt54Capacity int = 200

@description('Default model for agents (format: "model, version" e.g. "gpt-4o, 2024-11-20")')
param defaultAgentModel string = 'gpt-4o, 2024-11-20' // Recommended for eastus2, no registration required

@description('Tags to apply to the resource')
param tags object

// ============================================================================
// AZURE AI FOUNDRY ACCOUNT (with Project Management)
// ============================================================================

resource openAI 'Microsoft.CognitiveServices/accounts@2025-04-01-preview' = {
  name: openAIName
  location: location
  tags: tags
  kind: 'AIServices'
  identity: {
    type: 'SystemAssigned'
  }
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: openAIName
    publicNetworkAccess: 'Enabled'
    allowProjectManagement: true  // Enable Foundry projects for Agent Service
    disableLocalAuth: true  // Use keyless authentication (managed identity)
    networkAcls: {
      defaultAction: 'Allow'
      ipRules: []
      virtualNetworkRules: []
    }
  }
}

// ============================================================================
// FOUNDRY PROJECT (for Agent Service)
// ============================================================================

resource foundryProject 'Microsoft.CognitiveServices/accounts/projects@2025-04-01-preview' = {
  parent: openAI
  name: '${openAIName}-project'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    displayName: 'ProvePresent Project'
    description: 'Project for ProvePresent application with Agent Service'
  }
}

// ============================================================================
// GPT-4 DEPLOYMENT (for question generation and answer evaluation)
// ============================================================================

resource gpt4Deployment 'Microsoft.CognitiveServices/accounts/deployments@2025-04-01-preview' = if (deployGpt4Model) {
  parent: openAI
  name: gpt4DeploymentName
  sku: {
    name: 'Standard'
    capacity: gpt4Capacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: gpt4ModelName
      version: gpt4ModelVersion
    }
  }
}

// ============================================================================
// GPT-4 VISION DEPLOYMENT (for slide analysis)
// ============================================================================

resource gpt4VisionDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-04-01-preview' = if (deployVisionModel) {
  parent: openAI
  name: gpt4VisionDeploymentName
  sku: {
    name: 'Standard'
    capacity: gpt4VisionCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: gpt4VisionModelName
      version: gpt4VisionModelVersion
    }
  }
  dependsOn: deployGpt4Model ? [
    gpt4Deployment  // Deploy sequentially to avoid conflicts
  ] : []
}

// ============================================================================
// GPT-5.2-CHAT DEPLOYMENT (preview - most advanced model)
// ============================================================================

resource gpt52ChatDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-04-01-preview' = if (deployGpt52ChatModel) {
  parent: openAI
  name: gpt52ChatDeploymentName
  sku: {
    name: 'GlobalStandard'
    capacity: gpt52ChatCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: gpt52ChatModelName
      version: gpt52ChatModelVersion
    }
  }
  dependsOn: deployVisionModel ? [
    gpt4VisionDeployment
  ] : (deployGpt4Model ? [
    gpt4Deployment
  ] : [])
}

// ============================================================================
// GPT-5.4 DEPLOYMENT (latest model with highest capabilities)
// ============================================================================

resource gpt54Deployment 'Microsoft.CognitiveServices/accounts/deployments@2025-04-01-preview' = if (deployGpt54Model) {
  parent: openAI
  name: gpt54DeploymentName
  sku: {
    name: 'GlobalStandard'
    capacity: gpt54Capacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: gpt54ModelName
      version: gpt54ModelVersion
    }
  }
  dependsOn: deployGpt52ChatModel ? [
    gpt52ChatDeployment
  ] : (deployVisionModel ? [
    gpt4VisionDeployment
  ] : (deployGpt4Model ? [
    gpt4Deployment
  ] : []))
}

// ============================================================================
// NOTE: Foundry Projects and Agent Creation
// ============================================================================
// The Foundry project is now created via Bicep above.
// 
// After deployment, create agents using the REST API:
// 1. Run: ./create-persistent-agent.sh <resource-group> <openai-name>
// 2. The script will create an agent in the Foundry project
// 3. Agents will be visible in the Azure AI Foundry portal UI
// 4. The agent will use the Foundry Agent Service API
// ============================================================================

// ============================================================================
// PERSISTENT AGENT - Quiz Question Generator
// ============================================================================

@description('Instructions for the quiz question generator agent')
param agentInstructions string = '''You are a university professor creating quiz questions to test student attention and understanding.

IMPORTANT FORMATTING RULES:
- Keep questions SHORT and DIRECT (one sentence when possible)
- Use simple, clear language
- Avoid long, complex sentences
- Break multi-part questions into separate questions
- For options, keep them concise (5-10 words max)

Generate questions that:
- Test comprehension, not just memorization
- Are clear and concise
- Match the specified difficulty level
- Can be answered based on the slide content
- Help identify if students are paying attention

ONLY create MULTIPLE CHOICE questions with 4 options and 1 correct answer.

ALWAYS respond with valid JSON in this exact format (no markdown, no code blocks):
{
  "questions": [
    {
      "text": "Short, clear question?",
      "type": "MULTIPLE_CHOICE",
      "difficulty": "EASY" or "MEDIUM" or "HARD",
      "options": ["Brief option A", "Brief option B", "Brief option C", "Brief option D"],
      "correctAnswer": "Brief option A",
      "explanation": "Why this is the correct answer"
    }
  ]
}'''

// Note: Agent creation via Bicep is not yet supported in the API version
// Agents must be created via REST API or SDK after infrastructure deployment
// See the deployment script for agent creation

// ============================================================================
// OUTPUTS
// ============================================================================

@description('Azure OpenAI name')
output openAIName string = openAI.name

@description('Azure OpenAI ID')
output openAIId string = openAI.id

@description('Azure OpenAI endpoint')
output endpoint string = openAI.properties.endpoint

@description('Azure OpenAI primary key - Not available when disableLocalAuth is true')
output primaryKey string = ''  // Keyless auth - use managed identity instead

@description('GPT-4 deployment name')
output gpt4DeploymentName string = deployGpt4Model ? gpt4Deployment.name : ''

@description('GPT-4 Vision deployment name (if deployed)')
output gpt4VisionDeploymentName string = deployVisionModel ? gpt4VisionDeployment.name : ''

@description('GPT-5.2-chat deployment name (if deployed)')
output gpt52ChatDeploymentName string = deployGpt52ChatModel ? gpt52ChatDeployment.name : ''

@description('GPT-5.4 deployment name (if deployed)')
output gpt54DeploymentName string = deployGpt54Model ? gpt54Deployment.name : ''

@description('Agent instructions for quiz question generator')
output agentInstructions string = agentInstructions

@description('Default agent model (use this when creating agents)')
output defaultAgentModel string = defaultAgentModel

@description('Foundry project name')
output projectName string = foundryProject.name

@description('Foundry project ID')
output projectId string = foundryProject.id

@description('Foundry project endpoint for agents')
output projectEndpoint string = 'https://${openAIName}.services.ai.azure.com/api/projects/${foundryProject.name}'
