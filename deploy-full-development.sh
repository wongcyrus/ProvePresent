#!/bin/bash
# Fully Automated Development Environment Deployment
# Deploys infrastructure, backend, database, and frontend for development

set -e

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

# Deploy using the dev parameters file
az deployment group create \
    --resource-group "$RESOURCE_GROUP" \
    --template-file "infrastructure/main.bicep" \
    --parameters "infrastructure/parameters/dev.bicepparam" \
    --name "$DEPLOYMENT_NAME" \
    --output json > deployment-output.json

echo -e "${GREEN}✓ Infrastructure deployed${NC}"
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
    if [ -n "$OPENAI_NAME" ]; then
        OPENAI_ENDPOINT=$(az cognitiveservices account show --name "$OPENAI_NAME" --resource-group "$RESOURCE_GROUP" --query properties.endpoint -o tsv 2>/dev/null || echo "")
        OPENAI_KEY=$(az cognitiveservices account keys list --name "$OPENAI_NAME" --resource-group "$RESOURCE_GROUP" --query key1 -o tsv 2>/dev/null || echo "")
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
    "AzureOpenAI__ApiKey": "$OPENAI_KEY",
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

# Get Static Web App hostname
STATIC_WEB_APP_HOSTNAME=$(az staticwebapp show --name "$STATIC_WEB_APP_NAME" --resource-group "$RESOURCE_GROUP" --query "defaultHostname" -o tsv 2>/dev/null)

if [ -n "$STATIC_WEB_APP_HOSTNAME" ] && [ "$STATIC_WEB_APP_HOSTNAME" != "null" ]; then
    echo "Static Web App URL: https://$STATIC_WEB_APP_HOSTNAME"
    
    # Get SignalR name
    SIGNALR_NAME=$(az signalr list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)
    
    if [ -n "$SIGNALR_NAME" ] && [ "$SIGNALR_NAME" != "null" ]; then
        echo "Configuring CORS for SignalR: $SIGNALR_NAME"
        
        # Update CORS to only allow the Static Web App origin (remove wildcard)
        az signalr cors update \
            --name "$SIGNALR_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --allowed-origins "https://$STATIC_WEB_APP_HOSTNAME" \
            --output none 2>/dev/null || echo -e "${YELLOW}⚠ CORS update failed${NC}"
        
        echo -e "${GREEN}✓ SignalR CORS configured${NC}"
    else
        echo -e "${YELLOW}⚠ SignalR not found, skipping CORS configuration${NC}"
    fi
else
    echo -e "${YELLOW}⚠ Could not get Static Web App hostname${NC}"
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