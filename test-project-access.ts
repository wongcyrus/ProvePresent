#!/usr/bin/env tsx
/**
 * Test script to verify Azure AI Foundry project access
 * This helps diagnose issues before creating agents
 */

import { AIProjectClient } from '@azure/ai-projects';
import { DefaultAzureCredential } from '@azure/identity';
import { execSync } from 'child_process';

const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function resolveProjectName(resourceGroup: string, openaiResource: string, explicitProjectName?: string): string {
  if (explicitProjectName) {
    return explicitProjectName;
  }

  const defaultProjectName = `${openaiResource}-project`;

  try {
    const discoveredProject = execSync(
      `az resource list --resource-group "${resourceGroup}" --resource-type "Microsoft.CognitiveServices/accounts/projects" --query "[?starts_with(name, '${openaiResource}/')].name | [0]" -o tsv`,
      { encoding: 'utf-8' }
    ).trim();

    if (discoveredProject && discoveredProject !== 'null') {
      const parts = discoveredProject.split('/');
      if (parts.length === 2 && parts[1]) {
        return parts[1];
      }
    }
  } catch {
    // Fall back to convention-based name
  }

  return defaultProjectName;
}

async function main() {
  console.log(`${colors.blue}==========================================`);
  console.log('Azure AI Foundry Project Access Test');
  console.log(`==========================================${colors.reset}\n`);
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(`${colors.red}Usage: tsx test-project-access.ts <resource-group> <openai-resource-name> [project-name]${colors.reset}`);
    process.exit(1);
  }
  
  const [resourceGroup, openaiResource, explicitProjectName] = args;
  const projectName = resolveProjectName(resourceGroup, openaiResource, explicitProjectName);
  const projectEndpoint = `https://${openaiResource}.cognitiveservices.azure.com/api/projects/${projectName}`;
  
  console.log(`Resource Group: ${resourceGroup}`);
  console.log(`OpenAI Resource: ${openaiResource}`);
  console.log(`Project Name: ${projectName}`);
  console.log(`Project Endpoint: ${projectEndpoint}`);
  console.log('');
  
  // Test 1: Check if project exists in Azure
  console.log(`${colors.blue}Test 1: Checking if project exists in Azure...${colors.reset}`);
  try {
    const subscriptionId = execSync('az account show --query id -o tsv', { encoding: 'utf-8' }).trim();
    const resourceId = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.CognitiveServices/accounts/${openaiResource}/projects/${projectName}`;
    
    const projectState = execSync(
      `az resource show --ids "${resourceId}" --query "properties.provisioningState" -o tsv 2>&1`,
      { encoding: 'utf-8' }
    ).trim();
    
    if (projectState === 'Succeeded') {
      console.log(`${colors.green}✓ Project exists and is provisioned (state: ${projectState})${colors.reset}`);
    } else {
      console.log(`${colors.yellow}⚠ Project state: ${projectState}${colors.reset}`);
    }
  } catch (error) {
    console.log(`${colors.red}✗ Project not found or error checking: ${error instanceof Error ? error.message : String(error)}${colors.reset}`);
  }
  console.log('');
  
  // Test 2: Check Azure credentials
  console.log(`${colors.blue}Test 2: Testing Azure credentials...${colors.reset}`);
  try {
    const credential = new DefaultAzureCredential();
    const token = await credential.getToken('https://ai.azure.com/.default');
    
    if (token) {
      console.log(`${colors.green}✓ Successfully obtained authentication token${colors.reset}`);
      console.log(`  Token expires: ${new Date(token.expiresOnTimestamp).toISOString()}`);
    } else {
      console.log(`${colors.red}✗ Failed to obtain token${colors.reset}`);
    }
  } catch (error) {
    console.log(`${colors.red}✗ Credential error: ${error instanceof Error ? error.message : String(error)}${colors.reset}`);
    console.log(`${colors.yellow}  Try running: az login${colors.reset}`);
  }
  console.log('');
  
  // Test 3: Check RBAC permissions
  console.log(`${colors.blue}Test 3: Checking RBAC permissions...${colors.reset}`);
  try {
    const currentUser = execSync('az account show --query user.name -o tsv', { encoding: 'utf-8' }).trim();
    const currentUserObjectId = execSync('az ad signed-in-user show --query id -o tsv', { encoding: 'utf-8' }).trim();
    console.log(`  Current user: ${currentUser}`);
    
    const subscriptionId = execSync('az account show --query id -o tsv', { encoding: 'utf-8' }).trim();
    const projectResourceId = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.CognitiveServices/accounts/${openaiResource}/projects/${projectName}`;
    
    // Check for Azure AI User role
    const roleAssignments = execSync(
      `az role assignment list --scope "${projectResourceId}" --query "[?principalId=='${currentUserObjectId}'].{role:roleDefinitionName,scope:scope}" -o json`,
      { encoding: 'utf-8' }
    );
    
    const assignments = JSON.parse(roleAssignments);
    if (assignments.length > 0) {
      console.log(`${colors.green}✓ Found role assignments:${colors.reset}`);
      assignments.forEach((assignment: any) => {
        console.log(`  - ${assignment.role}`);
      });
    } else {
      console.log(`${colors.yellow}⚠ No role assignments found at project scope${colors.reset}`);
      console.log(`${colors.yellow}  You may need "Azure AI User" role assigned${colors.reset}`);
    }
  } catch (error) {
    console.log(`${colors.yellow}⚠ Could not check RBAC: ${error instanceof Error ? error.message : String(error)}${colors.reset}`);
  }
  console.log('');
  
  // Test 4: Try to initialize AIProjectClient
  console.log(`${colors.blue}Test 4: Initializing AIProjectClient...${colors.reset}`);
  try {
    const credential = new DefaultAzureCredential();
    const client = new AIProjectClient(projectEndpoint, credential);
    console.log(`${colors.green}✓ AIProjectClient initialized${colors.reset}`);
    
    // Test 5: Try to list agents
    console.log('');
    console.log(`${colors.blue}Test 5: Attempting to list agents...${colors.reset}`);
    try {
      const agents = client.agents.list();
      let count = 0;
      for await (const agent of agents) {
        count++;
        console.log(`  Found agent: ${agent.name} (id: ${agent.id}, version: ${agent.version})`);
      }
      
      if (count === 0) {
        console.log(`${colors.green}✓ Successfully accessed project (no agents found yet)${colors.reset}`);
      } else {
        console.log(`${colors.green}✓ Successfully listed ${count} agent(s)${colors.reset}`);
      }
    } catch (listError) {
      console.log(`${colors.red}✗ Failed to list agents: ${listError instanceof Error ? listError.message : String(listError)}${colors.reset}`);
      
      if (listError instanceof Error) {
        if (listError.message.includes('404') || listError.message.includes('not found')) {
          console.log(`${colors.yellow}  Possible causes:${colors.reset}`);
          console.log(`  - Project not fully provisioned (wait 5-10 minutes)`);
          console.log(`  - Incorrect project name or endpoint`);
        } else if (listError.message.includes('401') || listError.message.includes('403')) {
          console.log(`${colors.yellow}  Possible causes:${colors.reset}`);
          console.log(`  - Missing "Azure AI User" role at PROJECT scope`);
          console.log(`  - Authentication issue (try: az login)`);
        }
      }
    }
  } catch (error) {
    console.log(`${colors.red}✗ Failed to initialize client: ${error instanceof Error ? error.message : String(error)}${colors.reset}`);
  }
  
  console.log('');
  console.log(`${colors.blue}==========================================`);
  console.log('Test Complete');
  console.log(`==========================================${colors.reset}`);
}

main().catch((error) => {
  console.error(`${colors.red}Fatal error: ${error instanceof Error ? error.message : String(error)}${colors.reset}`);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
