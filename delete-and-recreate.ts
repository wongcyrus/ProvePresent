#!/usr/bin/env tsx
/**
 * Delete Classic Agents via SDK and create New Agents
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
    console.error('Usage: tsx delete-and-recreate.ts <resource-group> <openai-resource-name> [project-name]');
    process.exit(1);
  }
  
  const [resourceGroup, openaiResource, explicitProjectName] = args;
  const projectName = resolveProjectName(resourceGroup, openaiResource, explicitProjectName);
  const projectEndpoint = `https://${openaiResource}.cognitiveservices.azure.com/api/projects/${projectName}`;
  
  console.log('==========================================');
  console.log('Delete Classic Agents and Create New Agents');
  console.log('==========================================\n');
  console.log(`Project Name: ${projectName}`);
  console.log(`Project Endpoint: ${projectEndpoint}\n`);
  
  const credential = new DefaultAzureCredential();
  const client = new AIProjectClient(projectEndpoint, credential);
  
  // Step 1: List and delete all existing agents
  console.log('Step 1: Listing existing agents...\n');
  
  const agentsList = client.agents.list();
  const agentsToDelete: Array<{name: string, versions: string[]}> = [];
  
  for await (const agent of agentsList) {
    console.log(`Found agent: ${agent.name}`);
    
    // Get all versions for this agent
    const versions: string[] = [];
    try {
      const agentVersions = client.agents.listVersions(agent.name);
      for await (const version of agentVersions) {
        if (version.version) {
          versions.push(version.version.toString());
          console.log(`  - Version: ${version.version}`);
        }
      }
    } catch (error) {
      console.log(`  Could not list versions: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    if (agent.name) {
      agentsToDelete.push({ name: agent.name, versions });
    }
  }
  
  if (agentsToDelete.length === 0) {
    console.log('\nNo agents found to delete.');
  } else {
    console.log(`\nFound ${agentsToDelete.length} agent(s) to delete.`);
    console.log('Waiting 3 seconds... (Ctrl+C to cancel)');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Step 2: Delete all agents
    console.log('\nStep 2: Deleting agents...\n');
    
    for (const agent of agentsToDelete) {
      if (agent.versions.length > 0) {
        for (const version of agent.versions) {
          try {
            console.log(`Deleting ${agent.name} version ${version}...`);
            await client.agents.deleteVersion(agent.name, version);
            console.log('  ✓ Deleted');
          } catch (error) {
            console.log(`  ✗ Failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } else {
        // Try to delete without version
        try {
          console.log(`Deleting ${agent.name}...`);
          await client.agents.delete(agent.name);
          console.log('  ✓ Deleted');
        } catch (error) {
          console.log(`  ✗ Failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
  
  // Step 3: Wait and verify deletion
  console.log('\nStep 3: Waiting 5 seconds for deletion to complete...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  console.log('Verifying deletion...');
  const remainingAgents = client.agents.list();
  let count = 0;
  for await (const agent of remainingAgents) {
    count++;
    console.log(`  Still exists: ${agent.name}`);
  }
  
  if (count === 0) {
    console.log('  ✓ All agents deleted');
  } else {
    console.log(`  ⚠ ${count} agent(s) still exist`);
  }
  
  // Step 4: Create new agents
  console.log('\nStep 4: Creating new agents...');
  console.log('Running: npx tsx create-agents.ts');
  console.log('');
  
  execSync(`npx tsx create-agents.ts ${resourceGroup} ${openaiResource} ${projectName}`, { stdio: 'inherit' });
}

main().catch((error) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
