#!/bin/bash
# Undeploy and redeploy infrastructure for testing Bicep changes
# Keeps Static Web App to preserve URL

set -e
set -o pipefail

RESOURCE_GROUP="rg-qr-attendance-dev"
LOCATION="eastus2"

discover_openai_name() {
    local resource_group="$1"
    local openai_name

    openai_name=$(az cognitiveservices account list --resource-group "$resource_group" --query "[?kind=='AIServices'].name | [0]" -o tsv 2>/dev/null || echo "")
    if [ -z "$openai_name" ] || [ "$openai_name" = "null" ]; then
        openai_name=$(az cognitiveservices account list --resource-group "$resource_group" --query "[?kind=='OpenAI'].name | [0]" -o tsv 2>/dev/null || echo "")
    fi
    if [ -z "$openai_name" ] || [ "$openai_name" = "null" ]; then
        openai_name="openai-qrattendance-dev"
    fi

    echo "$openai_name"
}

discover_project_name() {
    local resource_group="$1"
    local openai_name="$2"
    local discovered

    discovered=$(az resource list --resource-group "$resource_group" --resource-type "Microsoft.CognitiveServices/accounts/projects" --query "[?starts_with(name, '${openai_name}/')].name | [0]" -o tsv 2>/dev/null || echo "")

    if [ -n "$discovered" ] && [ "$discovered" != "null" ]; then
        echo "$discovered" | cut -d'/' -f2
    else
        echo "${openai_name}-project"
    fi
}

echo "=========================================="
echo "Undeploy and Redeploy Infrastructure"
echo "=========================================="
echo ""
echo "Scope: Development resource group only"
echo "  Resource Group: $RESOURCE_GROUP"
echo "  Region: $LOCATION"
echo ""

# Step 0: Validate Azure tenant/token context
echo "Step 0: Validating Azure tenant context..."
ACTIVE_ACCOUNT_TENANT=$(az account show --query tenantId -o tsv 2>/dev/null || echo "")
ACTIVE_TOKEN_TENANT=$(az account get-access-token --resource https://management.azure.com/ --query tenant -o tsv 2>/dev/null || echo "")

if [ -z "$ACTIVE_ACCOUNT_TENANT" ] || [ -z "$ACTIVE_TOKEN_TENANT" ]; then
    echo "✗ Unable to resolve Azure account/token tenant context"
    echo "Run: az login --tenant 8ff7db19-435d-4c3c-83d3-ca0a46234f51"
    exit 1
fi

if [ "$ACTIVE_ACCOUNT_TENANT" != "$ACTIVE_TOKEN_TENANT" ]; then
    echo "✗ Azure CLI tenant mismatch detected"
    echo "  Account tenant: $ACTIVE_ACCOUNT_TENANT"
    echo "  Token tenant:   $ACTIVE_TOKEN_TENANT"
    echo "Fix with:"
    echo "  az logout"
    echo "  az login --tenant $ACTIVE_ACCOUNT_TENANT"
    exit 1
fi

echo "✓ Azure tenant context valid: $ACTIVE_ACCOUNT_TENANT"
echo ""

OPENAI_NAME=$(discover_openai_name "$RESOURCE_GROUP")
PROJECT_NAME=$(discover_project_name "$RESOURCE_GROUP" "$OPENAI_NAME")
echo "Using OpenAI account: $OPENAI_NAME"
echo "Using project: $PROJECT_NAME"
echo ""

# Step 1: Get Static Web App name to preserve it
echo "Step 1: Finding Static Web App..."
SWA_NAME=$(az staticwebapp list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null || echo "")

if [ -n "$SWA_NAME" ] && [ "$SWA_NAME" != "null" ]; then
    echo "Found Static Web App: $SWA_NAME"
    echo "This will be preserved."
else
    echo "No Static Web App found."
fi
echo ""

# Step 2: Delete project first (nested resource)
echo "Step 2: Deleting project resource first..."
az resource delete --ids "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.CognitiveServices/accounts/$OPENAI_NAME/projects/$PROJECT_NAME" 2>/dev/null || echo "Project not found or already deleted"

# Delete any other discovered projects under this OpenAI account
EXTRA_PROJECTS=$(az resource list --resource-group "$RESOURCE_GROUP" --resource-type "Microsoft.CognitiveServices/accounts/projects" --query "[?starts_with(name, '${OPENAI_NAME}/')].name" -o tsv 2>/dev/null || echo "")
if [ -n "$EXTRA_PROJECTS" ]; then
    while IFS= read -r FULL_PROJECT_NAME; do
        [ -z "$FULL_PROJECT_NAME" ] && continue
        THIS_PROJECT=$(echo "$FULL_PROJECT_NAME" | cut -d'/' -f2)
        if [ "$THIS_PROJECT" != "$PROJECT_NAME" ]; then
            echo "Deleting additional project: $THIS_PROJECT"
            az resource delete --ids "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.CognitiveServices/accounts/$OPENAI_NAME/projects/$THIS_PROJECT" 2>/dev/null || true
        fi
    done <<< "$EXTRA_PROJECTS"
fi
echo ""

# Step 3: Delete all resources except Static Web App
echo "Step 3: Deleting resources (except Static Web App)..."
RESOURCES=$(az resource list --resource-group "$RESOURCE_GROUP" --query "[?type!='Microsoft.Web/staticSites'].id" -o tsv)

if [ -z "$RESOURCES" ]; then
    echo "No resources to delete."
else
    echo "Deleting resources..."
    for RESOURCE_ID in $RESOURCES; do
        RESOURCE_NAME=$(echo "$RESOURCE_ID" | rev | cut -d'/' -f1 | rev)
        echo "  Deleting: $RESOURCE_NAME"
        az resource delete --ids "$RESOURCE_ID" 2>/dev/null || true
    done
fi

echo ""
echo "Waiting 30 seconds for deletion to complete..."
sleep 30

# Step 4: Purge deleted Cognitive Services accounts
echo ""
echo "Step 4: Purging deleted Cognitive Services accounts..."

# Ensure active OpenAI account is deleted first
ACTIVE_OPENAI_EXISTS=$(az cognitiveservices account show --name "$OPENAI_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null && echo "yes" || echo "no")
if [ "$ACTIVE_OPENAI_EXISTS" = "yes" ]; then
    echo "Deleting active OpenAI account: $OPENAI_NAME"
    az cognitiveservices account delete --name "$OPENAI_NAME" --resource-group "$RESOURCE_GROUP" --yes --output none 2>/dev/null || true

    echo "Waiting for account deletion to complete..."
    OPENAI_WAIT=0
    OPENAI_WAIT_MAX=18
    while az cognitiveservices account show --name "$OPENAI_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; do
        OPENAI_WAIT=$((OPENAI_WAIT + 1))
        if [ $OPENAI_WAIT -ge $OPENAI_WAIT_MAX ]; then
            echo "  Account still deleting; continuing to purge check..."
            break
        fi
        sleep 10
        echo -n "."
    done
    echo ""
fi

DELETED_ACCOUNTS=$(az cognitiveservices account list-deleted --query "[?location=='$LOCATION' && name=='$OPENAI_NAME'].name" -o tsv 2>/dev/null || echo "")

if [ -n "$DELETED_ACCOUNTS" ]; then
    for ACCOUNT_NAME in $DELETED_ACCOUNTS; do
        echo "Purging deleted account (dev scope): $ACCOUNT_NAME"
        az cognitiveservices account purge --name "$ACCOUNT_NAME" --resource-group "$RESOURCE_GROUP" --location "$LOCATION" 2>/dev/null || true
    done
    echo "Waiting 10 seconds after purge..."
    sleep 10
else
    echo "No deleted dev OpenAI account to purge."
fi

# Final verification for OpenAI cleanup in dev RG
echo ""
echo "Step 5: Verifying OpenAI cleanup..."
REMAINING_OPENAI=$(az cognitiveservices account list --resource-group "$RESOURCE_GROUP" --query "[?name=='$OPENAI_NAME'].name | [0]" -o tsv 2>/dev/null || echo "")
if [ -z "$REMAINING_OPENAI" ] || [ "$REMAINING_OPENAI" = "null" ]; then
    echo "✓ OpenAI account removed from dev resource group"
else
    echo "⚠ OpenAI account still present: $REMAINING_OPENAI"
fi

REMAINING_PROJECTS=$(az resource list --resource-group "$RESOURCE_GROUP" --resource-type "Microsoft.CognitiveServices/accounts/projects" --query "[?starts_with(name, '${OPENAI_NAME}/')].name" -o tsv 2>/dev/null || echo "")
if [ -z "$REMAINING_PROJECTS" ]; then
    echo "✓ Foundry projects removed for $OPENAI_NAME"
else
    echo "⚠ Remaining projects:"
    echo "$REMAINING_PROJECTS"
fi

# # Step 6: Redeploy infrastructure
# echo ""
# echo "Step 5: Redeploying infrastructure..."
# az deployment group create \
#     --resource-group "$RESOURCE_GROUP" \
#     --template-file "infrastructure/main.bicep" \
#     --parameters "infrastructure/parameters/dev.bicepparam" \
#     --name "qr-attendance-dev-deployment-$(date +%s)" \
#     --output table

# echo ""
# echo "=========================================="
# echo "Infrastructure Redeployed"
# echo "=========================================="
# echo ""
# echo "Next: Run agent creation"
# echo "  npx tsx create-agents.ts $RESOURCE_GROUP $OPENAI_NAME $PROJECT_NAME"
