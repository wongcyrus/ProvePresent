#!/bin/bash
# Migrate from Classic Agents to New Agents
# WARNING: This will delete the project and all agents!

set -e

RESOURCE_GROUP="rg-qr-attendance-dev"
OPENAI_NAME="openai-qrattendance-dev"
PROJECT_NAME="${OPENAI_NAME}-project"

echo "=========================================="
echo "Migrate to New Agents"
echo "=========================================="
echo ""
echo "WARNING: This will:"
echo "  1. Delete the existing project (and all Classic Agents)"
echo "  2. Recreate the project"
echo "  3. Create New Agents via TypeScript SDK"
echo ""
echo "Press Ctrl+C to cancel, or wait 10 seconds to continue..."
sleep 10

# Step 1: Delete the project
echo ""
echo "Step 1: Deleting project..."
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
PROJECT_ID="/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.CognitiveServices/accounts/${OPENAI_NAME}/projects/${PROJECT_NAME}"

az resource delete --ids "${PROJECT_ID}" --verbose

echo "Waiting 30 seconds for deletion to complete..."
sleep 30

# Step 2: Recreate the project via Bicep
echo ""
echo "Step 2: Redeploying infrastructure..."
az deployment group create \
    --resource-group "${RESOURCE_GROUP}" \
    --template-file "infrastructure/main.bicep" \
    --parameters "infrastructure/parameters/dev.bicepparam" \
    --name "qr-attendance-dev-deployment-$(date +%s)" \
    --output none

echo "Waiting 60 seconds for project to be fully provisioned..."
sleep 60

# Step 3: Create New Agents
echo ""
echo "Step 3: Creating New Agents..."
npx tsx create-agents.ts "${RESOURCE_GROUP}" "${OPENAI_NAME}"

echo ""
echo "=========================================="
echo "Migration Complete!"
echo "=========================================="
echo ""
echo "Your agents are now New Agents (not Classic)."
echo "They will appear in the 'New Agents' view in the portal."
