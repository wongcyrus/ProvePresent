// RBAC Role Assignments for Managed Identity
// Requirements: 19.4, 19.5
//
// NOTE: Role assignments use deterministic GUIDs for idempotency.
// If redeploying, you may see "RoleAssignmentExists" errors - this is expected
// and safe to ignore as it means the role assignments are already in place.

@description('Storage Account name')
param storageAccountName string

@description('SignalR Service name')
param signalRName string

@description('Function App principal ID')
param functionAppPrincipalId string

@description('Deploy Azure OpenAI')
param deployAzureOpenAI bool

@description('Azure OpenAI name (if deployed)')
param openAIName string

@description('Azure OpenAI project name (if deployed)')
param openAIProjectName string = ''

// ============================================================================
// BUILT-IN ROLE DEFINITIONS
// ============================================================================

// Storage Table Data Contributor: 0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3
var storageTableDataContributorRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3')

// SignalR Service Owner: 7e4f1700-ea5a-4f59-8f37-079cfe29dce3
var signalRServiceOwnerRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7e4f1700-ea5a-4f59-8f37-079cfe29dce3')

// Cognitive Services OpenAI User: 5e0bd9bd-7b93-4f28-af87-19fc36ad61bd
var cognitiveServicesOpenAIUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')

// Azure AI Developer: 64702f94-c441-49e6-a78b-ef80e0188fee (for Agent Service)
var azureAIDeveloperRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '64702f94-c441-49e6-a78b-ef80e0188fee')

// Azure AI User: 53ca6127-db72-4b80-b1b0-d745d6d5456d (for Agent Service at project scope)
var azureAIUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '53ca6127-db72-4b80-b1b0-d745d6d5456d')

// ============================================================================
// RESOURCE REFERENCES
// ============================================================================

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' existing = {
  name: storageAccountName
}

resource signalR 'Microsoft.SignalRService/signalR@2023-02-01' existing = {
  name: signalRName
}

resource openAI 'Microsoft.CognitiveServices/accounts@2023-05-01' existing = if (deployAzureOpenAI) {
  name: openAIName
}

resource openAIProject 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' existing = if (deployAzureOpenAI && openAIProjectName != '') {
  parent: openAI
  name: openAIProjectName
}

// ============================================================================
// ROLE ASSIGNMENTS - STORAGE TABLE DATA CONTRIBUTOR
// ============================================================================

// Requirement 19.4: Assign Storage Table Data Contributor to Function App
resource functionAppStorageRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, functionAppPrincipalId, storageTableDataContributorRoleId)
  scope: storageAccount
  properties: {
    roleDefinitionId: storageTableDataContributorRoleId
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// ============================================================================
// ROLE ASSIGNMENTS - SIGNALR SERVICE OWNER
// ============================================================================

// Requirement 19.5: Assign SignalR Service Owner to Function App
resource functionAppSignalRRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(signalR.id, functionAppPrincipalId, signalRServiceOwnerRoleId)
  scope: signalR
  properties: {
    roleDefinitionId: signalRServiceOwnerRoleId
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// ============================================================================
// ROLE ASSIGNMENTS - COGNITIVE SERVICES OPENAI USER (OPTIONAL)
// ============================================================================

// Requirement 19.3: Assign Cognitive Services OpenAI User to Function App (if OpenAI deployed)
resource functionAppOpenAIRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployAzureOpenAI) {
  name: guid(openAI.id, functionAppPrincipalId, cognitiveServicesOpenAIUserRoleId)
  scope: openAI
  properties: {
    roleDefinitionId: cognitiveServicesOpenAIUserRoleId
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// ============================================================================
// ROLE ASSIGNMENTS - AZURE AI USER (FOR AGENT SERVICE AT PROJECT SCOPE)
// ============================================================================

// Assign Azure AI User role to Function App at PROJECT scope for Agent Service operations
// Per Microsoft docs: Agent Service permissions must be assigned at the PROJECT scope
// Reference: https://learn.microsoft.com/azure/foundry/concepts/rbac-foundry
resource functionAppAIUserProjectRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployAzureOpenAI && openAIProjectName != '') {
  name: guid(openAIProject.id, functionAppPrincipalId, azureAIUserRoleId)
  scope: openAIProject
  properties: {
    roleDefinitionId: azureAIUserRoleId
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// ============================================================================
// OUTPUTS
// ============================================================================

@description('Storage role assignment for Function App')
output functionAppStorageRoleAssignmentId string = functionAppStorageRoleAssignment.id

@description('SignalR role assignment for Function App')
output functionAppSignalRRoleAssignmentId string = functionAppSignalRRoleAssignment.id

@description('OpenAI role assignment for Function App (if deployed)')
output functionAppOpenAIRoleAssignmentId string = deployAzureOpenAI ? functionAppOpenAIRoleAssignment.id : ''

@description('Azure AI User role assignment for Function App at project scope (if deployed)')
output functionAppAIUserProjectRoleAssignmentId string = (deployAzureOpenAI && openAIProjectName != '') ? functionAppAIUserProjectRoleAssignment.id : ''
