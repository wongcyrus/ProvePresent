#!/usr/bin/env tsx
/**
 * List all agents in Azure AI Foundry project
 */

import { AIProjectClient } from '@azure/ai-projects';
import { DefaultAzureCredential } from '@azure/identity';
import { execSync } from 'child_process';

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
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: tsx list-agents.ts <resource-group> <openai-resource-name> [project-name]');
    process.exit(1);
  }
  
  const [resourceGroup, openaiResource, explicitProjectName] = args;
  const projectName = resolveProjectName(resourceGroup, openaiResource, explicitProjectName);
  const projectEndpoint = `https://${openaiResource}.cognitiveservices.azure.com/api/projects/${projectName}`;
  
  console.log(`Project Name: ${projectName}`);
  console.log(`Project Endpoint: ${projectEndpoint}\n`);
  
  const credential = new DefaultAzureCredential();
  const client = new AIProjectClient(projectEndpoint, credential);
  
  console.log('Listing all agents...\n');
  
  try {
    // Try to list agents by name
    const agentNames = ['QuizQuestionGenerator', 'PositionEstimationAgent'];
    
    for (const agentName of agentNames) {
      console.log(`\nAgent: ${agentName}`);
      console.log('='.repeat(50));
      
      try {
        const versions = await client.agents.listVersions(agentName);
        let count = 0;
        
        for await (const version of versions) {
          count++;
          console.log(`  Version ${version.version}:`);
          console.log(`    ID: ${version.id}`);
          console.log(`    Name: ${version.name}`);
          console.log(`    Model: ${version.model}`);
          console.log(`    Created: ${version.createdAt}`);
        }
        
        if (count === 0) {
          console.log('  No versions found');
        } else {
          console.log(`  Total versions: ${count}`);
        }
      } catch (error) {
        console.log(`  Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    console.error(`Failed to list agents: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main().catch(console.error);
