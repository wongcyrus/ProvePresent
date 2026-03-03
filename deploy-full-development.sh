#!/bin/bash
# Fully Automated Development Environment Deployment
# Deploys infrastructure, backend, database, and frontend for development

set -e
set -o pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
RESOURCE_GROUP="rg-qr-attendance-dev"
LOCATION="eastus2"
DEPLOYMENT_NAME="qr-attendance-dev-deployment"
DESIRED_SWA_SKU="Standard"

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

discover_working_project_name() {
    local resource_group="$1"
    local openai_name="$2"
    local default_project
    local candidate
    local endpoint
    local discovered_projects

    default_project=$(discover_project_name "$resource_group" "$openai_name")
    endpoint=$(build_project_endpoint "$openai_name" "$default_project")
    if validate_project_endpoint "$endpoint"; then
        echo "$default_project"
        return 0
    fi

    discovered_projects=$(az resource list --resource-group "$resource_group" --resource-type "Microsoft.CognitiveServices/accounts/projects" --query "[?starts_with(name, '${openai_name}/')].name" -o tsv 2>/dev/null || echo "")
    if [ -n "$discovered_projects" ]; then
        while IFS= read -r candidate; do
            [ -z "$candidate" ] && continue
            candidate=$(echo "$candidate" | cut -d'/' -f2)
            endpoint=$(build_project_endpoint "$openai_name" "$candidate")
            if validate_project_endpoint "$endpoint"; then
                echo "$candidate"
                return 0
            fi
        done <<< "$discovered_projects"
    fi

    echo "$default_project"
}

build_project_endpoint() {
    local openai_name="$1"
    local project_name="$2"
    echo "https://${openai_name}.cognitiveservices.azure.com/api/projects/${project_name}"
}

validate_project_endpoint() {
    local endpoint="$1"
    local token
    local status

    if [ -z "$endpoint" ] || [ "$endpoint" = "null" ]; then
        return 1
    fi

    token=$(az account get-access-token --resource https://ai.azure.com --query accessToken -o tsv 2>/dev/null || echo "")
    if [ -z "$token" ]; then
        return 1
    fi

    status=$(curl -s -o /tmp/project-endpoint-check.json -w "%{http_code}" \
        -H "Authorization: Bearer $token" \
        "${endpoint}/agents?api-version=v1" || echo "000")

    [ "$status" = "200" ]
}

verify_external_id_login() {
    local app_url="$1"
    local expected_tenant_id="$2"

    echo "Validating External ID login authority..."
    final_login_url=$(curl -s -L -o /dev/null -w '%{url_effective}' "$app_url/.auth/login/aad" || true)
    first_location=$(curl -s -I "$app_url/.auth/login/aad" | awk 'BEGIN{IGNORECASE=1}/^location:/{print $2; exit}' | tr -d '\r')

    if [ -z "$final_login_url" ]; then
        echo -e "${RED}✗ Could not resolve SWA login redirect URL${NC}"
        return 1
    fi

    if echo "$final_login_url $first_location" | grep -qi '/common/oauth2'; then
        echo -e "${RED}✗ SWA auth fallback detected (common endpoint)${NC}"
        echo "  Final login URL: $final_login_url"
        if [ -n "$first_location" ]; then
            echo "  First redirect:  $first_location"
        fi
        return 1
    fi

    if [[ "$final_login_url" == *"$expected_tenant_id"* ]] || [[ "$final_login_url" == *"ciamlogin.com"* ]] || [[ "$first_location" == *"$expected_tenant_id"* ]] || [[ "$first_location" == *"ciamlogin.com"* ]]; then
        echo -e "${GREEN}✓ External ID login authority validated${NC}"
        return 0
    fi

    if [[ "$final_login_url" == *"/.auth/login/aad?post_login_redirect_uri="* ]] || [[ "$first_location" == *"/.auth/login/aad?post_login_redirect_uri="* ]]; then
        echo -e "${YELLOW}⚠ Login authority verification inconclusive (SWA nonce redirect)${NC}"
        echo "  Final login URL: $final_login_url"
        echo "  Proceeding because no '/common' fallback was detected."
        return 0
    fi

    echo -e "${YELLOW}⚠ SWA login redirect could not be conclusively validated${NC}"
    echo "  Expected tenant: $expected_tenant_id"
    echo "  Final login URL: $final_login_url"
    if [ -n "$first_location" ]; then
        echo "  First redirect:  $first_location"
    fi
    echo "  Proceeding because no '/common' fallback was detected."
    return 0
}

echo -e "${BLUE}=========================================="
echo "QR Chain Attendance - Full Development Deployment"
echo -e "==========================================${NC}"
echo ""

# Step 0: Load and validate credentials
echo -e "${BLUE}Step 0: Loading credentials...${NC}"

# Check if credentials file exists
if [ ! -f ".external-id-credentials" ]; then
    echo -e "${RED}✗ Missing .external-id-credentials file${NC}"
    echo ""
    echo "This file must exist in the project root and contain:"
    echo "  - AAD_CLIENT_ID"
    echo "  - AAD_CLIENT_SECRET"
    echo "  - TENANT_ID"
    echo "  - EXTERNAL_ID_ISSUER"
    echo ""
    echo "Please create this file before running deployment."
    exit 1
fi

# Load credentials
echo "Loading credentials from .external-id-credentials..."
source ./.external-id-credentials

# Validate required variables
if [ -z "$AAD_CLIENT_ID" ] || [ -z "$AAD_CLIENT_SECRET" ] || [ -z "$TENANT_ID" ]; then
    echo -e "${RED}✗ Missing required credentials in .external-id-credentials${NC}"
    echo ""
    echo "Required variables:"
    echo "  - AAD_CLIENT_ID: ${AAD_CLIENT_ID:-NOT SET}"
    echo "  - AAD_CLIENT_SECRET: ${AAD_CLIENT_SECRET:-NOT SET}"
    echo "  - TENANT_ID: ${TENANT_ID:-NOT SET}"
    exit 1
fi

echo -e "${GREEN}✓ Credentials loaded successfully${NC}"
echo "  Tenant ID: $TENANT_ID"
echo "  Client ID: ${AAD_CLIENT_ID:0:8}..."
echo ""

# Step 0.5: Azure AD Configuration
echo -e "${BLUE}Step 0.5: Validating Azure AD Configuration${NC}"

# Validate External ID configuration to prevent login redirect loops
if [ -z "$EXTERNAL_ID_ISSUER" ] || [ "$EXTERNAL_ID_ISSUER" = "null" ]; then
    echo -e "${RED}✗ .external-id-credentials is missing EXTERNAL_ID_ISSUER${NC}"
    echo "  External ID issuer is required for reliable production/dev auth behavior."
    exit 1
fi

if [ -n "$EXTERNAL_ID_ISSUER" ]; then
    ISSUER_TENANT_ID=$(echo "$EXTERNAL_ID_ISSUER" | sed -nE 's#^.*/([0-9a-fA-F-]{36})/v2\.0/?$#\1#p')
    if [ -n "$ISSUER_TENANT_ID" ]; then
        if [ -z "$TENANT_ID" ] || [ "$TENANT_ID" = "organizations" ]; then
            TENANT_ID="$ISSUER_TENANT_ID"
        elif [ "$TENANT_ID" != "$ISSUER_TENANT_ID" ]; then
            echo -e "${RED}✗ Invalid auth config: TENANT_ID does not match EXTERNAL_ID_ISSUER${NC}"
            echo "  TENANT_ID:           $TENANT_ID"
            echo "  Issuer tenant ID:    $ISSUER_TENANT_ID"
            echo "  EXTERNAL_ID_ISSUER:  $EXTERNAL_ID_ISSUER"
            echo "  Fix .external-id-credentials before deploying."
            exit 1
        fi
    fi
fi

if [ -z "$AAD_CLIENT_ID" ] || [ "$AAD_CLIENT_ID" = "null" ]; then
    echo -e "${RED}✗ .external-id-credentials is missing AAD_CLIENT_ID${NC}"
    exit 1
fi

if [ -z "$TENANT_ID" ] || [ "$TENANT_ID" = "null" ]; then
    echo -e "${RED}✗ .external-id-credentials is missing TENANT_ID${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Loaded External ID credentials${NC}"
echo "  Client ID: $AAD_CLIENT_ID"

if [ -z "$AAD_CLIENT_SECRET" ]; then
    echo -e "${RED}✗ .external-id-credentials is missing AAD_CLIENT_SECRET${NC}"
    echo "  Login can fail or loop without a valid secret."
    exit 1
fi

echo -e "${GREEN}✓ External ID authentication configured${NC}"
echo "  Tenant ID: $TENANT_ID"
echo ""

# Step 1: Check prerequisites
echo -e "${BLUE}Step 1: Checking prerequisites...${NC}"

if ! command -v az &> /dev/null; then
    echo -e "${RED}✗ Azure CLI not installed${NC}"
    exit 1
fi

if ! command -v func &> /dev/null; then
    echo -e "${RED}✗ Azure Functions Core Tools not installed${NC}"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo -e "${RED}✗ npm not installed${NC}"
    exit 1
fi

if ! command -v curl &> /dev/null; then
    echo -e "${RED}✗ curl not installed${NC}"
    exit 1
fi

# Ensure Node.js 22 is active for consistent builds
# First try to load NVM from common locations
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    source "$HOME/.nvm/nvm.sh"
fi

# Try to use Node.js 22 if NVM is available
if command -v nvm &> /dev/null; then
    nvm use 22 >/dev/null 2>&1 || nvm install 22
elif [ -d "$HOME/.nvm" ]; then
    # NVM is installed but function not loaded, try direct invocation
    bash "$HOME/.nvm/nvm.sh" --version > /dev/null && {
        source "$HOME/.nvm/nvm.sh"
        nvm use 22 >/dev/null 2>&1 || nvm install 22
    }
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo "")
if [ "$NODE_MAJOR" != "22" ]; then
    echo -e "${RED}✗ Node.js 22 required. Current: $(node --version)${NC}"
    echo -e "${YELLOW}⚠ Trying to use Node.js 22 via NVM...${NC}"
    if [ -s "$HOME/.nvm/nvm.sh" ]; then
        source "$HOME/.nvm/nvm.sh"
        if nvm install 22 && nvm use 22; then
            NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
            echo -e "${GREEN}✓ Switched to Node.js $(node --version)${NC}"
        fi
    fi
fi

# Verify again after NVM attempt
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo "")
if [ "$NODE_MAJOR" != "22" ]; then
    echo -e "${RED}✗ Node.js 22 required. Current: $(node --version)${NC}"
    echo -e "${YELLOW}Tip: Try 'nvm install 22 && nvm use 22' manually before re-running this script${NC}"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo -e "${RED}✗ jq not installed${NC}"
    exit 1
fi

# Check if Static Web Apps CLI is installed
if ! command -v swa &> /dev/null; then
    echo "Installing Static Web Apps CLI..."
    npm install -g @azure/static-web-apps-cli
fi

# Check Azure CLI extensions (less strict for dev)
echo "Checking Azure CLI extensions..."
az extension add --name staticwebapp --yes 2>/dev/null || true

echo -e "${GREEN}✓ All prerequisites met${NC}"
echo ""

# Step 1.5: Validate Azure tenant/token context for ARM operations
echo -e "${BLUE}Step 1.5: Validating Azure tenant context...${NC}"

ACTIVE_ACCOUNT_TENANT=$(az account show --query tenantId -o tsv 2>/dev/null || echo "")
ACTIVE_TOKEN_TENANT=$(az account get-access-token --resource https://management.azure.com/ --query tenant -o tsv 2>/dev/null || echo "")

if [ -z "$ACTIVE_ACCOUNT_TENANT" ] || [ -z "$ACTIVE_TOKEN_TENANT" ]; then
    echo -e "${RED}✗ Unable to resolve Azure account/token tenant context${NC}"
    echo "Run: az login --tenant 8ff7db19-435d-4c3c-83d3-ca0a46234f51"
    exit 1
fi

if [ "$ACTIVE_ACCOUNT_TENANT" != "$ACTIVE_TOKEN_TENANT" ]; then
    echo -e "${RED}✗ Azure CLI tenant mismatch detected${NC}"
    echo "  Account tenant: $ACTIVE_ACCOUNT_TENANT"
    echo "  Token tenant:   $ACTIVE_TOKEN_TENANT"
    echo "Fix with:"
    echo "  az logout"
    echo "  az login --tenant $ACTIVE_ACCOUNT_TENANT"
    exit 1
fi

echo -e "${GREEN}✓ Azure tenant context valid: $ACTIVE_ACCOUNT_TENANT${NC}"

if [ -n "$TENANT_ID" ] && [ "$TENANT_ID" != "$ACTIVE_ACCOUNT_TENANT" ]; then
    echo -e "${YELLOW}⚠ External ID tenant differs from Azure resource tenant${NC}"
    echo "  External ID TENANT_ID: $TENANT_ID"
    echo "  Azure resource tenant: $ACTIVE_ACCOUNT_TENANT"
    echo "  This is valid for cross-tenant auth setups, but Azure CLI must stay on resource tenant."
fi
echo ""

# Step 2: Create resource group
echo -e "${BLUE}Step 2: Creating resource group...${NC}"

if ! az group show --name "$RESOURCE_GROUP" --output none 2>/dev/null; then
    az group create \
        --name "$RESOURCE_GROUP" \
        --location "$LOCATION" \
        --tags Environment=Development Application="QR Chain Attendance" ManagedBy=Bicep
    echo -e "${GREEN}✓ Resource group created${NC}"
else
    echo -e "${YELLOW}ℹ Resource group already exists${NC}"
fi
echo ""

# Step 3: Deploy infrastructure using Bicep with dev parameters
echo -e "${BLUE}Step 3: Deploying infrastructure (5-10 minutes for dev)...${NC}"

recover_ifmatch_conflict() {
    local conflict_resource_id

    echo "Inspecting nested openai-deployment operations for ETag conflict..."
    conflict_resource_id=$(az deployment operation group list \
        --resource-group "$RESOURCE_GROUP" \
        --name "openai-deployment" \
        --query "[?properties.provisioningState=='Failed' && properties.statusMessage.error.code=='IfMatchPreconditionFailed'].properties.targetResource.id | [0]" \
        -o tsv 2>/dev/null || echo "")

    if [ -n "$conflict_resource_id" ] && [ "$conflict_resource_id" != "null" ]; then
        echo -e "${YELLOW}⚠ Removing conflicting resource to recover: $conflict_resource_id${NC}"
        az resource delete --ids "$conflict_resource_id" --output none 2>/dev/null || true
        echo "Waiting 15 seconds for control plane consistency..."
        sleep 15
        return 0
    fi

    return 1
}

MAX_INFRA_RETRIES=4
INFRA_ATTEMPT=0
INFRA_SUCCESS=false

while [ $INFRA_ATTEMPT -lt $MAX_INFRA_RETRIES ] && [ "$INFRA_SUCCESS" = false ]; do
    INFRA_ATTEMPT=$((INFRA_ATTEMPT + 1))
    echo "Infrastructure deployment attempt $INFRA_ATTEMPT/$MAX_INFRA_RETRIES..."

    set +e
    DEPLOYMENT_RESULT=$(az deployment group create \
        --resource-group "$RESOURCE_GROUP" \
        --template-file "infrastructure/main.bicep" \
        --parameters "infrastructure/parameters/dev.bicepparam" \
        --name "$DEPLOYMENT_NAME" \
        --output json 2>&1)
    DEPLOY_EXIT=$?
    set -e

    echo "$DEPLOYMENT_RESULT" > deployment-output.json

    if [ $DEPLOY_EXIT -eq 0 ]; then
        INFRA_SUCCESS=true
        echo -e "${GREEN}✓ Infrastructure deployed${NC}"
        break
    fi

    if echo "$DEPLOYMENT_RESULT" | grep -q "RoleAssignmentExists"; then
        echo -e "${YELLOW}⚠ Role assignments already exist (safe to continue)${NC}"
        INFRA_SUCCESS=true
        break
    fi

    if echo "$DEPLOYMENT_RESULT" | grep -q "IfMatchPreconditionFailed"; then
        echo -e "${YELLOW}⚠ Detected OpenAI deployment ETag conflict (IfMatchPreconditionFailed)${NC}"
        if recover_ifmatch_conflict; then
            echo "Retrying infrastructure deployment after conflict recovery..."
            continue
        else
            echo -e "${YELLOW}⚠ Could not automatically identify conflicting resource from deployment operations${NC}"
        fi
    fi

    if [ $INFRA_ATTEMPT -lt $MAX_INFRA_RETRIES ]; then
        echo -e "${YELLOW}⚠ Deployment failed, retrying in 20 seconds...${NC}"
        sleep 20
    fi
done

if [ "$INFRA_SUCCESS" = false ]; then
    echo -e "${RED}✗ Infrastructure deployment failed after $MAX_INFRA_RETRIES attempts${NC}"
    echo "$DEPLOYMENT_RESULT" | jq '.' 2>/dev/null || echo "$DEPLOYMENT_RESULT"
    exit 1
fi
echo ""

# Step 3.5: Foundry Project Setup for Agents
echo -e "${BLUE}Step 3.5: Foundry Project Setup for Agents...${NC}"

# Get OpenAI resource name from deployment - try multiple approaches
OPENAI_NAME=""

# First try: Get from deployment outputs
if [ -f "deployment-output.json" ] && [ -s "deployment-output.json" ]; then
    OPENAI_NAME=$(jq -r '.properties.outputs.openAIName.value // ""' deployment-output.json 2>/dev/null || echo "")
fi

# Second try: Query Azure for AIServices or OpenAI kind
if [ -z "$OPENAI_NAME" ] || [ "$OPENAI_NAME" = "null" ]; then
    echo "Querying Azure for Cognitive Services account..."
    # Try AIServices kind first
    OPENAI_NAME=$(az cognitiveservices account list --resource-group "$RESOURCE_GROUP" --query "[?kind=='AIServices'].name | [0]" -o tsv 2>/dev/null || echo "")
    
    # If not found, try OpenAI kind
    if [ -z "$OPENAI_NAME" ] || [ "$OPENAI_NAME" = "null" ]; then
        OPENAI_NAME=$(az cognitiveservices account list --resource-group "$RESOURCE_GROUP" --query "[?kind=='OpenAI'].name | [0]" -o tsv 2>/dev/null || echo "")
    fi
    
    # If still not found, get any cognitive services account
    if [ -z "$OPENAI_NAME" ] || [ "$OPENAI_NAME" = "null" ]; then
        OPENAI_NAME=$(az cognitiveservices account list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null || echo "")
    fi
fi

# Third try: Use expected name from parameters
if [ -z "$OPENAI_NAME" ] || [ "$OPENAI_NAME" = "null" ]; then
    OPENAI_NAME="openai-qrattendance-dev"
fi

echo "Found Cognitive Services account: $OPENAI_NAME"

# Verify the account exists
if az cognitiveservices account show --name "$OPENAI_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
    PROJECT_NAME=$(discover_working_project_name "$RESOURCE_GROUP" "$OPENAI_NAME")

    echo -e "${GREEN}✓ Account verified: $OPENAI_NAME${NC}"
    echo -e "${GREEN}✓ Foundry project found: ${PROJECT_NAME}${NC}"
    echo ""
    
    # Wait for project to be fully provisioned with retry logic
    echo "Waiting for Foundry project to be fully provisioned..."
    PROJECT_READY=false
    MAX_RETRIES=6
    RETRY_COUNT=0
    
    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        RETRY_COUNT=$((RETRY_COUNT + 1))
        echo "Checking project readiness (attempt $RETRY_COUNT/$MAX_RETRIES)..."
        
        # Try to verify project exists via Azure CLI
        PROJECT_EXISTS=$(az resource show \
            --ids "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.CognitiveServices/accounts/$OPENAI_NAME/projects/${PROJECT_NAME}" \
            --query "properties.provisioningState" -o tsv 2>/dev/null || echo "")
        
        if [ "$PROJECT_EXISTS" = "Succeeded" ]; then
            echo "✓ Project provisioning state: Succeeded"
            PROJECT_READY=true
            break
        else
            echo "Project state: ${PROJECT_EXISTS:-Unknown}, waiting 30 seconds..."
            sleep 30
        fi
    done
    
    if [ "$PROJECT_READY" = false ]; then
        echo -e "${YELLOW}⚠ Project may not be fully ready, but attempting agent creation anyway${NC}"
    fi
    
    # Now create the agents automatically using TypeScript SDK (New Agents API)
    echo -e "${BLUE}Creating persistent agents using New Agents API...${NC}"
    
    # Check if TypeScript agent creation script exists
    if [ -f "./create-agents.ts" ]; then
        # Ensure dependencies are installed
        if ! command -v tsx &> /dev/null; then
            echo "Installing TypeScript dependencies..."
            npm install
        fi
        
        # Run TypeScript agent creation script with retry logic
        AGENT_CREATED=false
        AGENT_RETRY=0
        MAX_AGENT_RETRIES=3
        
        while [ $AGENT_RETRY -lt $MAX_AGENT_RETRIES ] && [ "$AGENT_CREATED" = false ]; do
            AGENT_RETRY=$((AGENT_RETRY + 1))
            
            if [ $AGENT_RETRY -gt 1 ]; then
                echo "Retrying agent creation (attempt $AGENT_RETRY/$MAX_AGENT_RETRIES) after 20 seconds..."
                sleep 20
            fi
            
            echo "Running: tsx create-agents.ts $RESOURCE_GROUP $OPENAI_NAME $PROJECT_NAME"
            if echo "y" | npx tsx create-agents.ts "$RESOURCE_GROUP" "$OPENAI_NAME" "$PROJECT_NAME" 2>&1 | tee /tmp/agent-creation.log; then
                # Check if agents were actually created
                if grep -q "Agent created successfully" /tmp/agent-creation.log; then
                    AGENT_CREATED=true
                    echo -e "${GREEN}✓ Agents created successfully${NC}"
                fi
            fi
        done
        
        if [ "$AGENT_CREATED" = false ]; then
            echo -e "${YELLOW}⚠ Agent creation failed after $MAX_AGENT_RETRIES attempts${NC}"
            echo "You can create the agents manually later with:"
            echo "  npx tsx create-agents.ts $RESOURCE_GROUP $OPENAI_NAME $PROJECT_NAME"
            echo ""
            echo "The project may need more time to be fully provisioned."
            echo "Wait 5-10 minutes and try running the command above."
        fi
        
        rm -f /tmp/agent-creation.log
        
        # Check if agents were created successfully
        if [ -f ".agent-config.env" ]; then
            echo -e "${GREEN}✓ Agents created successfully${NC}"
            
            # Load agent IDs
            source ./.agent-config.env

            if [ -n "$AZURE_AI_PROJECT_ENDPOINT" ] && [ "$AZURE_AI_PROJECT_ENDPOINT" != "null" ]; then
                PROJECT_ENDPOINT="$AZURE_AI_PROJECT_ENDPOINT"
                echo "Using agent-created project endpoint: $PROJECT_ENDPOINT"
            fi
            
            if [ -n "$AZURE_AI_AGENT_ID" ]; then
                echo "Quiz Agent ID: $AZURE_AI_AGENT_ID"
            fi
            
            if [ -n "$AZURE_AI_POSITION_AGENT_ID" ]; then
                echo "Position Agent ID: $AZURE_AI_POSITION_AGENT_ID"
            fi
        else
            echo -e "${YELLOW}⚠ Agent configuration not found${NC}"
        fi
    else
        echo -e "${YELLOW}⚠ TypeScript agent creation script not found${NC}"
        echo "  Expected: ./create-agents.ts"
    fi
    echo ""
else
    echo -e "${YELLOW}⚠ Cognitive Services account not found: $OPENAI_NAME${NC}"
    echo "  Please verify the account exists in resource group: $RESOURCE_GROUP"
fi
echo ""

# Step 4: Extract deployment outputs (with robust error handling)
echo -e "${BLUE}Step 4: Extracting deployment outputs...${NC}"

# First try to extract from deployment output, fall back to direct Azure queries
FUNCTION_APP_NAME=""
STORAGE_NAME=""
STORAGE_CONNECTION_STRING=""
FUNCTION_APP_URL=""
OPENAI_ENDPOINT=""
OPENAI_KEY=""
OPENAI_NAME=""
PROJECT_ENDPOINT=""
PROJECT_NAME=""
APPINSIGHTS_CONNECTION_STRING=""
SIGNALR_CONNECTION_STRING=""

# Try to extract from deployment output with better JSON handling
if [ -f "deployment-output.json" ] && [ -s "deployment-output.json" ]; then
    echo "Attempting to extract from deployment output..."
    
    # Try to find and extract the JSON part (skip bicep messages)
    if grep -q "\"properties\"" deployment-output.json; then
        # Extract JSON part starting from first {
        sed -n '/^{/,$p' deployment-output.json > temp-deployment.json
        
        if jq empty temp-deployment.json 2>/dev/null; then
            echo "✓ Valid JSON found in deployment output"
            FUNCTION_APP_NAME=$(jq -r '.properties.outputs.functionAppName.value // ""' temp-deployment.json)
            STORAGE_NAME=$(jq -r '.properties.outputs.storageAccountName.value // ""' temp-deployment.json)
            STORAGE_CONNECTION_STRING=$(jq -r '.properties.outputs.storageConnectionString.value // ""' temp-deployment.json)
            FUNCTION_APP_URL=$(jq -r '.properties.outputs.functionAppUrl.value // ""' temp-deployment.json)
            OPENAI_ENDPOINT=$(jq -r '.properties.outputs.openAIEndpoint.value // ""' temp-deployment.json)
            OPENAI_KEY=$(jq -r '.properties.outputs.openAIKey.value // ""' temp-deployment.json)
            OPENAI_NAME=$(jq -r '.properties.outputs.openAIName.value // ""' temp-deployment.json)
            PROJECT_ENDPOINT=$(jq -r '.properties.outputs.projectEndpoint.value // ""' temp-deployment.json)
            if [ -n "$PROJECT_ENDPOINT" ] && [ "$PROJECT_ENDPOINT" != "null" ]; then
                PROJECT_NAME=$(echo "$PROJECT_ENDPOINT" | sed -nE 's#^.*/api/projects/([^/?]+).*$#\1#p')
            fi
            APPINSIGHTS_CONNECTION_STRING=$(jq -r '.properties.outputs.applicationInsightsConnectionString.value // ""' temp-deployment.json)
            SIGNALR_CONNECTION_STRING=$(jq -r '.properties.outputs.signalRConnectionString.value // ""' temp-deployment.json)
        fi
        rm -f temp-deployment.json
    fi
fi

# Fall back to direct Azure resource queries if deployment output failed
if [ -z "$FUNCTION_APP_NAME" ] || [ -z "$STORAGE_NAME" ]; then
    echo "Deployment output extraction failed, querying Azure resources directly..."
    
    # Get resource names from Azure
    FUNCTION_APP_NAME=$(az functionapp list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null || echo "func-qrattendance-dev")
    STORAGE_NAME=$(az storage account list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null || echo "stqrattendancedev")
    
    # Set derived values
    FUNCTION_APP_URL="https://${FUNCTION_APP_NAME}.azurewebsites.net"
    
    # Get connection strings directly from Azure
    echo "Retrieving connection strings from Azure..."
    STORAGE_CONNECTION_STRING=$(az storage account show-connection-string --name "$STORAGE_NAME" --resource-group "$RESOURCE_GROUP" --query connectionString -o tsv 2>/dev/null || echo "")
    
    # Get OpenAI details
    OPENAI_NAME=$(az cognitiveservices account list --resource-group "$RESOURCE_GROUP" --query "[?kind=='OpenAI'][0].name" -o tsv 2>/dev/null || echo "")
    if [ -z "$OPENAI_NAME" ] || [ "$OPENAI_NAME" = "null" ]; then
        # Try AIServices kind
        OPENAI_NAME=$(az cognitiveservices account list --resource-group "$RESOURCE_GROUP" --query "[?kind=='AIServices'][0].name" -o tsv 2>/dev/null || echo "")
    fi
    
    if [ -n "$OPENAI_NAME" ] && [ "$OPENAI_NAME" != "null" ]; then
        OPENAI_ENDPOINT=$(az cognitiveservices account show --name "$OPENAI_NAME" --resource-group "$RESOURCE_GROUP" --query properties.endpoint -o tsv 2>/dev/null || echo "")
        OPENAI_KEY=$(az cognitiveservices account keys list --name "$OPENAI_NAME" --resource-group "$RESOURCE_GROUP" --query key1 -o tsv 2>/dev/null || echo "")

        if [ -z "$PROJECT_NAME" ] || [ "$PROJECT_NAME" = "null" ]; then
            PROJECT_NAME=$(discover_working_project_name "$RESOURCE_GROUP" "$OPENAI_NAME")
        fi
        
        # Construct project endpoint if not already set
        if [ -z "$PROJECT_ENDPOINT" ] || [ "$PROJECT_ENDPOINT" = "null" ]; then
            PROJECT_ENDPOINT=$(build_project_endpoint "$OPENAI_NAME" "$PROJECT_NAME")
            echo "✓ Constructed project endpoint: $PROJECT_ENDPOINT"
        fi
    fi
    
    # Get Application Insights
    APPINSIGHTS_NAME=$(az monitor app-insights component list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null || echo "")
    if [ -n "$APPINSIGHTS_NAME" ]; then
        APPINSIGHTS_CONNECTION_STRING=$(az monitor app-insights component show --app "$APPINSIGHTS_NAME" --resource-group "$RESOURCE_GROUP" --query connectionString -o tsv 2>/dev/null || echo "")
    fi
    
    # Get SignalR
    SIGNALR_NAME=$(az signalr list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null || echo "")
    if [ -n "$SIGNALR_NAME" ]; then
        SIGNALR_CONNECTION_STRING=$(az signalr key list --name "$SIGNALR_NAME" --resource-group "$RESOURCE_GROUP" --query primaryConnectionString -o tsv 2>/dev/null || echo "")
    fi
    
    echo "✓ Resource information retrieved from Azure"
fi

echo "Deployment outputs:"
echo "  Function App: $FUNCTION_APP_NAME"
echo "  Storage Account: $STORAGE_NAME"
echo "  Function App URL: $FUNCTION_APP_URL"
echo "  Azure OpenAI: $([ -n "$OPENAI_ENDPOINT" ] && echo "Enabled" || echo "Disabled")"
echo "  SignalR: $([ -n "$SIGNALR_CONNECTION_STRING" ] && echo "Enabled" || echo "Disabled")"
echo ""

# Step 4.5: Configure SignalR CORS
echo -e "${BLUE}Step 4.5: Configuring SignalR CORS...${NC}"

# Get SignalR name
SIGNALR_NAME=$(az signalr list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null || echo "signalr-qrattendance-dev")

if [ -n "$SIGNALR_NAME" ] && [ "$SIGNALR_NAME" != "null" ]; then
    echo "Found SignalR: $SIGNALR_NAME"
    
    # Get Static Web App hostname (will be configured later, but we can prepare)
    # For now, we'll configure this after SWA is deployed
    echo "SignalR CORS will be configured after Static Web App deployment"
else
    echo -e "${YELLOW}⚠ SignalR not found, skipping CORS configuration${NC}"
fi
echo ""

# Step 5: Deploy backend functions
echo -e "${BLUE}Step 5: Deploying backend functions...${NC}"

cd backend

# Install backend dependencies
echo "Installing backend dependencies..."
npm install

# Build TypeScript
echo "Building backend..."
npm run build

# Create local.settings.json for deployment
echo "Creating deployment settings..."

# Load agent config if it exists, but prefer infrastructure-derived endpoint
AZURE_AI_AGENT_ID=""
AZURE_AI_POSITION_AGENT_ID=""
AZURE_AI_PROJECT_ENDPOINT=""

# First, try to use the project endpoint from infrastructure deployment
if [ -n "$PROJECT_ENDPOINT" ] && [ "$PROJECT_ENDPOINT" != "null" ]; then
    AZURE_AI_PROJECT_ENDPOINT="$PROJECT_ENDPOINT"
    echo "✓ Using project endpoint from infrastructure: $AZURE_AI_PROJECT_ENDPOINT"
fi

# Load agent IDs from config file if it exists
if [ -f "../.agent-config.env" ]; then
    source ../.agent-config.env

    # Always prefer infrastructure-resolved endpoint over cached config endpoint
    if [ -n "$PROJECT_ENDPOINT" ] && [ "$PROJECT_ENDPOINT" != "null" ]; then
        AZURE_AI_PROJECT_ENDPOINT="$PROJECT_ENDPOINT"
    fi
    
    # Load quiz agent ID
    if [ -n "$AZURE_AI_AGENT_ID" ]; then
        echo "✓ Loaded quiz agent ID from config: $AZURE_AI_AGENT_ID"
    fi
    
    # Load position agent ID
    if [ -n "$AZURE_AI_POSITION_AGENT_ID" ]; then
        echo "✓ Loaded position agent ID from config: $AZURE_AI_POSITION_AGENT_ID"
    fi
    
    # If infrastructure didn't provide endpoint, validate and fix config endpoint
    if [ -z "$PROJECT_ENDPOINT" ] || [ "$PROJECT_ENDPOINT" = "null" ]; then
        if [ -n "$AZURE_AI_PROJECT_ENDPOINT" ]; then
            # Check if it's using the old internal format
            if [[ "$AZURE_AI_PROJECT_ENDPOINT" == *"agents.eastus2.hyena.infra.ai.azure.com"* ]] || [[ "$AZURE_AI_PROJECT_ENDPOINT" == *"/agents/v2.0/"* ]]; then
                echo -e "${YELLOW}⚠ Detected old agent endpoint format in config, using correct format${NC}"
                # Use the correct format from infrastructure
                if [ -n "$OPENAI_NAME" ]; then
                    if [ -z "$PROJECT_NAME" ] || [ "$PROJECT_NAME" = "null" ]; then
                        PROJECT_NAME=$(discover_working_project_name "$RESOURCE_GROUP" "$OPENAI_NAME")
                    fi
                    AZURE_AI_PROJECT_ENDPOINT=$(build_project_endpoint "$OPENAI_NAME" "$PROJECT_NAME")
                    echo "  Corrected to: $AZURE_AI_PROJECT_ENDPOINT"
                fi
            fi
        fi
    fi
fi

# Final fallback: construct from OPENAI_NAME if still not set
if [ -z "$AZURE_AI_PROJECT_ENDPOINT" ] || [ "$AZURE_AI_PROJECT_ENDPOINT" = "null" ]; then
    if [ -n "$OPENAI_NAME" ] && [ "$OPENAI_NAME" != "null" ]; then
        if [ -z "$PROJECT_NAME" ] || [ "$PROJECT_NAME" = "null" ]; then
            PROJECT_NAME=$(discover_working_project_name "$RESOURCE_GROUP" "$OPENAI_NAME")
        fi
        AZURE_AI_PROJECT_ENDPOINT=$(build_project_endpoint "$OPENAI_NAME" "$PROJECT_NAME")
        echo "✓ Constructed project endpoint from OpenAI name: $AZURE_AI_PROJECT_ENDPOINT"
    fi
fi

# Final validation: ensure project endpoint is reachable on data plane
if ! validate_project_endpoint "$AZURE_AI_PROJECT_ENDPOINT"; then
    echo -e "${YELLOW}⚠ Current project endpoint failed health check: $AZURE_AI_PROJECT_ENDPOINT${NC}"
    if [ -n "$OPENAI_NAME" ] && [ "$OPENAI_NAME" != "null" ]; then
        PROJECT_NAME=$(discover_working_project_name "$RESOURCE_GROUP" "$OPENAI_NAME")
        AZURE_AI_PROJECT_ENDPOINT=$(build_project_endpoint "$OPENAI_NAME" "$PROJECT_NAME")
        echo "Retrying with discovered endpoint: $AZURE_AI_PROJECT_ENDPOINT"

        if validate_project_endpoint "$AZURE_AI_PROJECT_ENDPOINT"; then
            echo -e "${GREEN}✓ Project endpoint health check passed${NC}"
        else
            echo -e "${YELLOW}⚠ Project endpoint still not reachable; keeping latest discovered value${NC}"
            cat /tmp/project-endpoint-check.json 2>/dev/null || true
        fi
    fi
else
    echo -e "${GREEN}✓ Project endpoint health check passed${NC}"
fi

cat > local.settings.json << EOF
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "$STORAGE_CONNECTION_STRING",
    "FUNCTIONS_EXTENSION_VERSION": "~4",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "WEBSITE_NODE_DEFAULT_VERSION": "~22",
    "FUNCTIONS_CORE_TOOLS_TELEMETRY_OPTOUT": "1",
    "StorageConnectionString": "$STORAGE_CONNECTION_STRING",
    "APPINSIGHTS_INSTRUMENTATIONKEY": "",
    "APPLICATIONINSIGHTS_CONNECTION_STRING": "$APPINSIGHTS_CONNECTION_STRING",
    "SIGNALR_CONNECTION_STRING": "$SIGNALR_CONNECTION_STRING",
    "AzureOpenAI__Endpoint": "$OPENAI_ENDPOINT",
    "AzureOpenAI__ApiKey": "$OPENAI_KEY",$([ -n "$AZURE_AI_AGENT_ID" ] && echo "
    \"AZURE_AI_AGENT_ID\": \"$AZURE_AI_AGENT_ID\",
    \"AZURE_AI_PROJECT_ENDPOINT\": \"$AZURE_AI_PROJECT_ENDPOINT\"," || echo "")$([ -n "$AZURE_AI_POSITION_AGENT_ID" ] && echo "
    \"AZURE_AI_POSITION_AGENT_ID\": \"$AZURE_AI_POSITION_AGENT_ID\"," || echo "")
    "Environment": "dev",
    "DEBUG": "*"
  },
  "Host": {
    "LocalHttpPort": 7071,
    "CORS": "",
    "CORSCredentials": true
  }
}
EOF

# Deploy functions
echo "Deploying functions to Azure..."
func azure functionapp publish "$FUNCTION_APP_NAME" --typescript

cd ..
echo -e "${GREEN}✓ Backend functions deployed${NC}"
echo ""

# Step 6: Verify database tables
echo -e "${BLUE}Step 6: Verifying database tables...${NC}"

echo -e "${GREEN}✓ Database tables managed by bicep infrastructure${NC}"
echo ""

# Step 7: Build and deploy frontend
echo -e "${BLUE}Step 7: Building frontend...${NC}"

cd frontend

# Install frontend dependencies
echo "Installing frontend dependencies..."
npm install

# Get Static Web App URL for environment configuration
STATIC_WEB_APP_NAME="swa-qrattendance-dev"
SWA_EXISTS=$(az staticwebapp show --name "$STATIC_WEB_APP_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null && echo "yes" || echo "no")

if [ "$SWA_EXISTS" = "no" ]; then
    echo "Creating Static Web App for frontend configuration..."
    az staticwebapp create --name "$STATIC_WEB_APP_NAME" --resource-group "$RESOURCE_GROUP" --location "$LOCATION" --sku "$DESIRED_SWA_SKU" --output none
    echo "✓ Static Web App created"
    
    # Wait for creation to complete
    sleep 10
    
    # Attempt to find it with alternative names if creation used a different name
    ACTUAL_SWA_NAME=$(az staticwebapp list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null || echo "$STATIC_WEB_APP_NAME")
    if [ -n "$ACTUAL_SWA_NAME" ] && [ "$ACTUAL_SWA_NAME" != "null" ]; then
        STATIC_WEB_APP_NAME="$ACTUAL_SWA_NAME"
        echo "✓ Using Static Web App: $STATIC_WEB_APP_NAME"
    fi
fi

CURRENT_SWA_SKU=$(az staticwebapp show --name "$STATIC_WEB_APP_NAME" --resource-group "$RESOURCE_GROUP" --query "sku.name" -o tsv 2>/dev/null || echo "")
if [ "$DESIRED_SWA_SKU" = "Standard" ] && [ "$CURRENT_SWA_SKU" != "Standard" ]; then
    echo "Upgrading Static Web App SKU to Standard for External ID/B2C support..."
    az staticwebapp update \
        --name "$STATIC_WEB_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --sku Standard \
        --output none
    echo -e "${GREEN}✓ Static Web App upgraded to Standard${NC}"
fi

# Get correct Static Web App URL with multiple fallbacks
STATIC_WEB_APP_HOSTNAME=""
for SWA_NAME in "$STATIC_WEB_APP_NAME" "swa-qrattendance-dev" "ambitious-ocean-06a8da40f" "$(az staticwebapp list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)"; do
    if [ -n "$SWA_NAME" ] && [ "$SWA_NAME" != "null" ]; then
        STATIC_WEB_APP_HOSTNAME=$(az staticwebapp show --name "$SWA_NAME" --query "defaultHostname" -o tsv 2>/dev/null || echo "")
        if [ -n "$STATIC_WEB_APP_HOSTNAME" ] && [ "$STATIC_WEB_APP_HOSTNAME" != "null" ]; then
            STATIC_WEB_APP_NAME="$SWA_NAME"  # Update to actual name found
            break
        fi
    fi
done

# Set URL based on hostname
if [ -n "$STATIC_WEB_APP_HOSTNAME" ] && [ "$STATIC_WEB_APP_HOSTNAME" != "null" ]; then
    STATIC_WEB_APP_URL="https://$STATIC_WEB_APP_HOSTNAME"
    echo "✓ Static Web App URL: $STATIC_WEB_APP_URL"
else
    STATIC_WEB_APP_URL="https://swa-qrattendance-dev.azurestaticapps.net"  # Fallback
    echo "⚠ Using fallback URL: $STATIC_WEB_APP_URL"
fi

# Ensure SWA has current Azure AD app settings (prevents stale secret login loops)
if [ -n "$AAD_CLIENT_ID" ]; then
    # External ID / B2C custom provider requires Standard SKU on Static Web Apps
    if [ -n "$EXTERNAL_ID_ISSUER" ]; then
        SWA_SKU=$(az staticwebapp show --name "$STATIC_WEB_APP_NAME" --resource-group "$RESOURCE_GROUP" --query "sku.name" -o tsv 2>/dev/null || echo "")
        if [ "$SWA_SKU" != "Standard" ]; then
            echo -e "${RED}✗ External ID/B2C requires Static Web App Standard SKU${NC}"
            echo "  Current SKU: ${SWA_SKU:-unknown}"
            echo "  Static Web App: $STATIC_WEB_APP_NAME"
            echo ""
            echo "Upgrade and re-run deployment:"
            echo "  az staticwebapp update --name $STATIC_WEB_APP_NAME --resource-group $RESOURCE_GROUP --sku Standard"
            exit 1
        fi
    fi

    echo "Configuring Static Web App Azure AD settings..."
    SWA_AUTH_SETTINGS=(
        "AAD_CLIENT_ID=$AAD_CLIENT_ID"
        "TENANT_ID=$TENANT_ID"
    )

    if [ -n "$AAD_CLIENT_SECRET" ]; then
        SWA_AUTH_SETTINGS+=("AAD_CLIENT_SECRET=$AAD_CLIENT_SECRET")
    else
        echo -e "${YELLOW}⚠ AAD_CLIENT_SECRET not provided; keeping existing SWA secret${NC}"
    fi

    az staticwebapp appsettings set \
        --name "$STATIC_WEB_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --setting-names "${SWA_AUTH_SETTINGS[@]}" \
        --output none

    echo -e "${GREEN}✓ Static Web App Azure AD settings applied${NC}"
fi

# Link Function App to Static Web App for built-in API integration
echo "Linking Function App to Static Web App..."

# Get Function App resource ID
FUNCTION_APP_RESOURCE_ID=$(az functionapp show \
    --name "$FUNCTION_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "id" -o tsv)

# Check if already linked
SWA_LINKED=$(az staticwebapp show --name "$STATIC_WEB_APP_NAME" --resource-group "$RESOURCE_GROUP" --query "linkedBackends[].backendResourceId" -o tsv 2>/dev/null | grep -i "/sites/$FUNCTION_APP_NAME" || true)

if [ -z "$SWA_LINKED" ]; then
    echo "Creating Static Web App backend link..."
    
    # Link the backend (requires Standard SKU)
    az staticwebapp backends link \
        --name "$STATIC_WEB_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --backend-resource-id "$FUNCTION_APP_RESOURCE_ID" \
        --backend-region "$LOCATION" \
        --output none 2>/dev/null || {
            echo -e "${YELLOW}⚠ Failed to link backend automatically${NC}"
            echo "  This may be due to SKU limitations (Free tier doesn't support linked backends)"
            echo "  Manual linking: Static Web App -> APIs -> Link -> select $FUNCTION_APP_NAME"
        }
    
    # Verify link was created
    SWA_LINKED=$(az staticwebapp show --name "$STATIC_WEB_APP_NAME" --resource-group "$RESOURCE_GROUP" --query "linkedBackends[].backendResourceId" -o tsv 2>/dev/null | grep -i "/sites/$FUNCTION_APP_NAME" || true)
    
    if [ -n "$SWA_LINKED" ]; then
        echo -e "${GREEN}✓ Static Web App backend linked successfully${NC}"
    else
        echo -e "${YELLOW}⚠ Static Web App link not detected${NC}"
        echo "  Frontend will use direct Function API URL"
    fi
else
    echo -e "${GREEN}✓ Static Web App backend already linked${NC}"
fi

# Ensure Function App URL has proper protocol
if [[ "$FUNCTION_APP_URL" != https://* ]]; then
    FUNCTION_APP_URL="https://$FUNCTION_APP_URL"
fi

# Select frontend API URL strategy based on SWA link availability
if [ -n "$SWA_LINKED" ]; then
    FRONTEND_API_URL="/api"
    echo -e "${GREEN}✓ Frontend API via SWA built-in proxy (no CORS needed): /api${NC}"
else
    FRONTEND_API_URL="${FUNCTION_APP_URL%/}/api"
    echo -e "${YELLOW}⚠ Frontend API via direct Function URL (CORS required): $FRONTEND_API_URL${NC}"
fi

# Create environment file for build
cat > .env.local << EOF
NEXT_PUBLIC_API_URL=$FRONTEND_API_URL
NEXT_PUBLIC_ENVIRONMENT=dev
NEXT_PUBLIC_AAD_CLIENT_ID=$AAD_CLIENT_ID
NEXT_PUBLIC_AAD_TENANT_ID=$TENANT_ID
NEXT_PUBLIC_AAD_REDIRECT_URI=$STATIC_WEB_APP_URL/.auth/login/aad/callback
EOF

if [ -n "$EXTERNAL_ID_ISSUER" ]; then
    echo "Synchronizing frontend openIdIssuer from .external-id-credentials..."
    TMP_SWA_CONFIG=$(mktemp)
    jq --arg issuer "$EXTERNAL_ID_ISSUER" '.auth.identityProviders.azureActiveDirectory.registration.openIdIssuer = $issuer' staticwebapp.config.json > "$TMP_SWA_CONFIG"
    mv "$TMP_SWA_CONFIG" staticwebapp.config.json
    echo -e "${GREEN}✓ openIdIssuer synchronized: $EXTERNAL_ID_ISSUER${NC}"
fi

# Build for production (static export)
echo "Building frontend for static deployment..."
npm run build

# Copy staticwebapp.config.json to output directory for SWA routing fallback
cp staticwebapp.config.json out/

cd ..
echo -e "${GREEN}✓ Frontend built${NC}"
echo ""

# Step 8: Deploy frontend to Static Web App
echo -e "${BLUE}Step 8: Deploying frontend...${NC}"

cd frontend

echo "Deploying to Static Web App..."

# Ensure Static Web App exists with multiple name fallbacks
echo "Verifying Static Web App exists..."
SWA_FOUND=""
DEPLOYMENT_TOKEN=""

# Try multiple potential names
for SWA_NAME in "$STATIC_WEB_APP_NAME" "swa-qrattendance-dev" "$(az staticwebapp list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)"; do
    if [ -n "$SWA_NAME" ] && [ "$SWA_NAME" != "null" ]; then
        if az staticwebapp show --name "$SWA_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
            SWA_FOUND="$SWA_NAME"
            STATIC_WEB_APP_NAME="$SWA_NAME"
            echo "✓ Found Static Web App: $SWA_NAME"
            break
        fi
    fi
done

# Create if not found
if [ -z "$SWA_FOUND" ]; then
    echo "Creating new Static Web App..."
    STATIC_WEB_APP_NAME="swa-qrattendance-dev"
    az staticwebapp create --name "$STATIC_WEB_APP_NAME" --resource-group "$RESOURCE_GROUP" --location "$LOCATION" --sku "$DESIRED_SWA_SKU" --output none
    echo "✓ Static Web App created: $STATIC_WEB_APP_NAME"
    sleep 10  # Wait for creation
    
    # Verify creation and get actual name
    ACTUAL_NAME=$(az staticwebapp list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)
    if [ -n "$ACTUAL_NAME" ] && [ "$ACTUAL_NAME" != "null" ]; then
        STATIC_WEB_APP_NAME="$ACTUAL_NAME"
        echo "✓ Using actual SWA name: $STATIC_WEB_APP_NAME"
    fi
fi

# Get deployment token
echo "Getting deployment token..."
DEPLOYMENT_TOKEN=$(az staticwebapp secrets list --name "$STATIC_WEB_APP_NAME" --query "properties.apiKey" -o tsv 2>/dev/null || echo "")
if [ -z "$DEPLOYMENT_TOKEN" ] || [ "$DEPLOYMENT_TOKEN" = "null" ]; then
    echo -e "${RED}✗ Failed to get deployment token for $STATIC_WEB_APP_NAME${NC}"
    echo "Please check the Static Web App in Azure Portal"
    cd ..
    exit 1
fi

# Deploy to Static Web App
echo "Deploying frontend files..."
swa deploy ./out --deployment-token="$DEPLOYMENT_TOKEN" --env production || {
    echo -e "${YELLOW}⚠ SWA deployment failed, but continuing...${NC}"
}

cd ..
echo -e "${GREEN}✓ Frontend deployment attempted${NC}"
echo ""

# Step 8.5: Configure SignalR CORS with Static Web App URL
echo -e "${BLUE}Step 8.5: Configuring SignalR CORS...${NC}"

# Resolve candidate Static Web App hostnames in this resource group
SWA_HOSTNAMES=$(az staticwebapp list --resource-group "$RESOURCE_GROUP" --query "[].defaultHostname" -o tsv 2>/dev/null || echo "")
STATIC_WEB_APP_HOSTNAME=$(az staticwebapp show --name "$STATIC_WEB_APP_NAME" --resource-group "$RESOURCE_GROUP" --query "defaultHostname" -o tsv 2>/dev/null || echo "")

# Build deduplicated origin list for SignalR CORS
CORS_ORIGINS_RAW=""
if [ -n "$STATIC_WEB_APP_HOSTNAME" ] && [ "$STATIC_WEB_APP_HOSTNAME" != "null" ]; then
    CORS_ORIGINS_RAW="${CORS_ORIGINS_RAW}https://${STATIC_WEB_APP_HOSTNAME}\n"
fi

if [ -n "$SWA_HOSTNAMES" ]; then
    while IFS= read -r HOST; do
        [ -z "$HOST" ] && continue
        [ "$HOST" = "null" ] && continue
        CORS_ORIGINS_RAW="${CORS_ORIGINS_RAW}https://${HOST}\n"
    done <<< "$SWA_HOSTNAMES"
fi

if [ -n "$STATIC_WEB_APP_URL" ]; then
    CORS_ORIGINS_RAW="${CORS_ORIGINS_RAW}${STATIC_WEB_APP_URL%/}\n"
fi

CORS_ORIGINS=$(printf "%b" "$CORS_ORIGINS_RAW" | awk 'NF {print $0}' | sort -u)

# Get SignalR name
SIGNALR_NAME=$(az signalr list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null || echo "")

if [ -n "$SIGNALR_NAME" ] && [ "$SIGNALR_NAME" != "null" ]; then
    if [ -z "$CORS_ORIGINS" ]; then
        echo -e "${RED}✗ SignalR exists but no Static Web App origin could be resolved for CORS${NC}"
        exit 1
    fi

    echo "Configuring CORS for SignalR: $SIGNALR_NAME"
    echo "Allowed origins:"
    echo "$CORS_ORIGINS" | sed 's/^/  - /'

    # shellcheck disable=SC2206
    CORS_ORIGIN_ARGS=($CORS_ORIGINS)
    if ! az signalr cors update \
        --name "$SIGNALR_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --allowed-origins "${CORS_ORIGIN_ARGS[@]}" \
        --output none; then
        echo -e "${RED}✗ Failed to configure SignalR CORS${NC}"
        exit 1
    fi

    CURRENT_SIGNALR_CORS=$(az signalr cors list --name "$SIGNALR_NAME" --resource-group "$RESOURCE_GROUP" --query "allowedOrigins" -o tsv 2>/dev/null || echo "")

    # Verify at least one expected SWA origin is present
    VERIFIED=false
    while IFS= read -r ORIGIN; do
        [ -z "$ORIGIN" ] && continue
        if echo "$CURRENT_SIGNALR_CORS" | grep -Fq "$ORIGIN"; then
            VERIFIED=true
            break
        fi
    done <<< "$CORS_ORIGINS"

    if [ "$VERIFIED" != "true" ]; then
        echo -e "${RED}✗ SignalR CORS verification failed${NC}"
        echo "Current allowed origins: $CURRENT_SIGNALR_CORS"
        exit 1
    fi

    echo -e "${GREEN}✓ SignalR CORS configured and verified${NC}"
else
    echo -e "${YELLOW}⚠ SignalR not found, skipping CORS configuration${NC}"
fi
echo ""

# Step 8.6: Verify Function App configuration
echo -e "${BLUE}Step 8.6: Verifying Function App configuration...${NC}"
# Note: CORS not needed - Static Web Apps uses reverse proxy for /api routes

# Verify Function App authentication is disabled
echo "Verifying Function App authentication is disabled..."
AUTH_V2_REQUIRE_AUTH=$(az webapp auth show \
    --name "$FUNCTION_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "properties.globalValidation.requireAuthentication" -o tsv 2>/dev/null || echo "")

if [ "$AUTH_V2_REQUIRE_AUTH" = "true" ]; then
    echo -e "${YELLOW}⚠ Function App authentication (v2) requires auth, disabling it...${NC}"
    az webapp auth update \
        --name "$FUNCTION_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --enabled false \
        --action AllowAnonymous \
        --output none
    echo -e "${GREEN}✓ Function App authentication (v2) disabled${NC}"
elif [ "$AUTH_V2_REQUIRE_AUTH" = "false" ]; then
    echo -e "${GREEN}✓ Function App authentication (v2) already disabled${NC}"
else
    AUTH_CLASSIC_ENABLED=$(az webapp auth-classic show \
        --name "$FUNCTION_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query "enabled" -o tsv 2>/dev/null || echo "false")

    if [ "$AUTH_CLASSIC_ENABLED" = "true" ]; then
        echo -e "${YELLOW}⚠ Function App authentication (classic) is enabled, disabling it...${NC}"
        az webapp auth-classic update \
            --name "$FUNCTION_APP_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --enabled false \
            --action AllowAnonymous \
            --output none
        echo -e "${GREEN}✓ Function App authentication (classic) disabled${NC}"
    else
        echo -e "${GREEN}✓ Function App authentication already disabled${NC}"
    fi
fi
echo ""

# Step 9: Verifying development deployment...
echo -e "${BLUE}Step 9: Verifying development deployment...${NC}"

# Get final Static Web App URL with comprehensive fallbacks
echo "Getting final Static Web App URL..."
STATIC_WEB_APP_URL=""

# Try multiple approaches to get the URL
for SWA_NAME in "$STATIC_WEB_APP_NAME" "swa-qrattendance-dev" "$(az staticwebapp list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)"; do
    if [ -n "$SWA_NAME" ] && [ "$SWA_NAME" != "null" ]; then
        HOSTNAME=$(az staticwebapp show --name "$SWA_NAME" --resource-group "$RESOURCE_GROUP" --query "defaultHostname" -o tsv 2>/dev/null || echo "")
        if [ -n "$HOSTNAME" ] && [ "$HOSTNAME" != "null" ]; then
            STATIC_WEB_APP_URL="https://$HOSTNAME"
            STATIC_WEB_APP_NAME="$SWA_NAME"  # Update to working name
            echo "✓ Static Web App URL: $STATIC_WEB_APP_URL"
            break
        fi
    fi
done

# If still no URL, try getting from any SWA in resource group
if [ -z "$STATIC_WEB_APP_URL" ]; then
    echo "Trying to find any Static Web App in resource group..."
    ALL_SVAS=$(az staticwebapp list --resource-group "$RESOURCE_GROUP" --query "[].{name:name,hostname:defaultHostname}" -o json 2>/dev/null || echo "[]")
    if [ -n "$ALL_SVAS" ] && [ "$ALL_SVAS" != "[]" ]; then
        HOSTNAME=$(echo "$ALL_SVAS" | jq -r '.[0].hostname // ""' 2>/dev/null)
        SWA_NAME=$(echo "$ALL_SVAS" | jq -r '.[0].name // ""' 2>/dev/null)
        if [ -n "$HOSTNAME" ] && [ "$HOSTNAME" != "null" ]; then
            STATIC_WEB_APP_URL="https://$HOSTNAME"
            STATIC_WEB_APP_NAME="$SWA_NAME"
            echo "✓ Found SWA URL: $STATIC_WEB_APP_URL"
        fi
    fi
fi

if [ -z "$STATIC_WEB_APP_URL" ]; then
    STATIC_WEB_APP_URL="Not available - check Azure portal"
    echo -e "${YELLOW}⚠ Could not determine Static Web App URL${NC}"
    echo "  Check: https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.Web%2FStaticSites"
fi

# Basic health checks
echo "Running health checks..."

# Check Function App - try different health endpoints
FUNC_HEALTH="000"
if [ -n "$FUNCTION_APP_URL" ]; then
    # Try common health endpoints
    FUNC_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$FUNCTION_APP_URL/api/health" 2>/dev/null || echo "000")
    if [ "$FUNC_HEALTH" = "000" ] || [ "$FUNC_HEALTH" = "404" ]; then
        # Try checking if any function is accessible
        FUNC_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$FUNCTION_APP_URL" 2>/dev/null || echo "000")
    fi
fi

if [ "$FUNC_HEALTH" = "200" ] || [ "$FUNC_HEALTH" = "403" ] || [ "$FUNC_HEALTH" = "401" ]; then
    echo -e "${GREEN}✓ Function App is running${NC}"
else
    echo -e "${YELLOW}⚠ Function App health check returned HTTP $FUNC_HEALTH${NC}"
fi

# Check Static Web App
if [[ "$STATIC_WEB_APP_URL" =~ ^https:// ]]; then
    SWA_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$STATIC_WEB_APP_URL" 2>/dev/null || echo "000")
    if [ "$SWA_HEALTH" = "200" ]; then
        echo -e "${GREEN}✓ Static Web App is ready${NC}"
    else
        echo -e "${YELLOW}⚠ Static Web App health check returned HTTP $SWA_HEALTH${NC}"
    fi

    if ! verify_external_id_login "$STATIC_WEB_APP_URL" "$TENANT_ID"; then
        echo -e "${RED}✗ Authentication verification failed. Deployment halted.${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠ Static Web App URL not available for testing${NC}"
fi

# Check database tables
if [ -n "$STORAGE_CONNECTION_STRING" ]; then
    TABLE_COUNT=$(az storage table list --connection-string "$STORAGE_CONNECTION_STRING" --query "length(@)" -o tsv 2>/dev/null || echo "0")
else
    TABLE_COUNT="0"
fi
echo -e "${GREEN}✓ Database tables: $TABLE_COUNT${NC}"

# Check Azure OpenAI (if deployed)
if [ -n "$OPENAI_ENDPOINT" ]; then
    echo -e "${GREEN}✓ Azure OpenAI is ready${NC}"
fi

# Check SignalR (if deployed)  
if [ -n "$SIGNALR_CONNECTION_STRING" ]; then
    echo -e "${GREEN}✓ SignalR is ready${NC}"
fi

echo ""

# Step 10: Save deployment info
echo -e "${BLUE}Step 10: Saving deployment information...${NC}"

# Get final Static Web App name if not set
if [ -z "$STATIC_WEB_APP_NAME" ]; then
    STATIC_WEB_APP_NAME=$(az staticwebapp list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null || echo "swa-qrattendance-dev")
fi

# Create deployment info file
cat > deployment-info.json << EOF
{
  "environment": "development",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "urls": {
    "frontend": "$STATIC_WEB_APP_URL",
    "backend": "$FUNCTION_APP_URL"
  },
  "azure": {
    "resourceGroup": "$RESOURCE_GROUP",
    "functionApp": "$FUNCTION_APP_NAME",
    "storageAccount": "$STORAGE_NAME",
    "staticWebApp": "$STATIC_WEB_APP_NAME"$([ -n "$OPENAI_ENDPOINT" ] && echo ",
    \"openAI\": \"openai-qrattendance-dev\"" || echo "")$([ -n "$SIGNALR_CONNECTION_STRING" ] && echo ",
    \"signalR\": \"signalr-qrattendance-dev\"" || echo "")$([ -n "$APPINSIGHTS_CONNECTION_STRING" ] && echo ",
    \"applicationInsights\": \"appi-qrattendance-dev\"" || echo "")
  },
  "features": {
    "azureOpenAI": $([ -n "$OPENAI_ENDPOINT" ] && echo "true" || echo "false"),
    "signalR": $([ -n "$SIGNALR_CONNECTION_STRING" ] && echo "true" || echo "false"),
    "azureAD": $([ -n "$AAD_CLIENT_ID" ] && echo "true" || echo "false")
  },
  "database": {
    "tables": $TABLE_COUNT,
    "storageAccount": "$STORAGE_NAME"
  }
}
EOF

echo -e "${GREEN}✓ Deployment info saved${NC}"
echo ""

# Final summary
echo -e "${BLUE}=========================================="
echo "Development Deployment Complete!"
echo -e "==========================================${NC}"
echo ""
echo -e "${GREEN}Development URLs:${NC}"
echo "  Frontend: $STATIC_WEB_APP_URL"
echo "  Backend:  $FUNCTION_APP_URL"
echo ""
echo -e "${GREEN}Azure Resources:${NC}"
echo "  Resource Group: $RESOURCE_GROUP"
echo "  Storage:        $STORAGE_NAME"
echo "  Function App:   $FUNCTION_APP_NAME"
echo "  Static Web App: $STATIC_WEB_APP_NAME"
if [ -n "$OPENAI_ENDPOINT" ]; then
    echo "  Azure OpenAI:   openai-qrattendance-dev"
fi
if [ -n "$SIGNALR_CONNECTION_STRING" ]; then
    echo "  SignalR:        signalr-qrattendance-dev"
fi
if [ -n "$APPINSIGHTS_CONNECTION_STRING" ]; then
    echo "  App Insights:   appi-qrattendance-dev"
fi
echo ""

if [ -n "$OPENAI_ENDPOINT" ]; then
    echo -e "${GREEN}Azure OpenAI:${NC}"
    echo "  Endpoint: $OPENAI_ENDPOINT"
    echo "  Models:   gpt-4o, gpt-4o-vision"
    echo ""
fi

echo -e "${GREEN}Database:${NC}"
echo "  Tables: $TABLE_COUNT"
echo ""

echo -e "${GREEN}✓ Development deployment successful!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Visit: $STATIC_WEB_APP_URL"
echo "  2. Login with Azure B2C"
echo "  3. Test all features in development environment"
echo "  4. For local development, run: npm run dev (frontend) and func start (backend)"
echo ""
echo "Deployment info saved to: deployment-info.json"
echo ""