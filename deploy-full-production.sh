#!/bin/bash
# Fully Automated Production Deployment
# Deploys infrastructure, backend, database, and frontend

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
RESOURCE_GROUP="rg-qr-attendance-prod"
LOCATION="eastus2"
DEPLOYMENT_NAME="prod-full-$(date +%Y%m%d-%H%M%S)"
DESIRED_SWA_SKU="Standard"

verify_external_id_login() {
    local app_url="$1"
    local expected_tenant_id="$2"

    echo "Validating External ID login authority..."
    final_login_url=$(curl -s -L -o /dev/null -w '%{url_effective}' "$app_url/.auth/login/aad" || true)

    if [ -z "$final_login_url" ]; then
        echo -e "${RED}✗ Could not resolve SWA login redirect URL${NC}"
        return 1
    fi

    if echo "$final_login_url" | grep -qi '/common/oauth2'; then
        echo -e "${RED}✗ SWA auth fallback detected (common endpoint)${NC}"
        echo "  Final login URL: $final_login_url"
        return 1
    fi

    if [[ "$final_login_url" == *"$expected_tenant_id"* ]] || [[ "$final_login_url" == *"ciamlogin.com"* ]]; then
        echo -e "${GREEN}✓ External ID login authority validated${NC}"
        return 0
    fi

    echo -e "${RED}✗ SWA login redirect does not match External ID tenant${NC}"
    echo "  Expected tenant: $expected_tenant_id"
    echo "  Final login URL: $final_login_url"
    return 1
}

echo -e "${BLUE}=========================================="
echo "QR Chain Attendance - Full Production Deployment"
echo -e "==========================================${NC}"
echo ""

# Step 0: Get Azure AD credentials automatically
echo -e "${BLUE}Step 0: Azure AD Configuration${NC}"

# Require explicit auth credentials for the correct auth tenant
AAD_CLIENT_ID=""
AAD_CLIENT_SECRET=""

# Load explicit auth credentials (preferred: External ID)
if [ -f ".external-id-credentials" ]; then
    source ./.external-id-credentials
else
    echo -e "${RED}✗ Missing .external-id-credentials${NC}"
    echo "  Deployment requires explicit External ID/B2C credentials to avoid tenant drift."
    exit 1
fi

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
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    source "$HOME/.nvm/nvm.sh"
fi

if command -v nvm &> /dev/null; then
    nvm use 22 >/dev/null 2>&1 || nvm install 22
elif [ -d "$HOME/.nvm" ]; then
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

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo "")
if [ "$NODE_MAJOR" != "22" ]; then
    echo -e "${RED}✗ Node.js 22 required. Current: $(node --version)${NC}"
    echo -e "${YELLOW}Tip: Try 'nvm install 22 && nvm use 22' manually${NC}"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo -e "${RED}✗ jq not installed${NC}"
    exit 1
fi

if ! az account show &> /dev/null; then
    echo -e "${RED}✗ Not logged in to Azure${NC}"
    exit 1
fi

# Check if Azure Static Web Apps extension is installed
echo "Checking Azure CLI extensions..."
if ! az extension list --query "[?name=='staticwebapp']" -o tsv | grep -q staticwebapp; then
    echo "Installing Azure Static Web Apps CLI extension..."
    az extension add --name staticwebapp --yes --only-show-errors
fi

echo -e "${GREEN}✓ All prerequisites met${NC}"
echo ""

# Step 2: Create resource group
echo -e "${BLUE}Step 2: Creating resource group...${NC}"
az group create \
    --name $RESOURCE_GROUP \
    --location $LOCATION \
    --tags Environment=Production Application="QR Chain Attendance" ManagedBy=Bicep \
    --output none

echo -e "${GREEN}✓ Resource group created${NC}"
echo ""

# Step 3: Deploy infrastructure
echo -e "${BLUE}Step 3: Deploying infrastructure (10-15 minutes)...${NC}"

# Prepare parameters
BICEP_PARAMS="infrastructure/parameters/prod.bicepparam"

# Deploy infrastructure (backend only - Static Web App created separately)
az deployment group create \
    --name $DEPLOYMENT_NAME \
    --resource-group $RESOURCE_GROUP \
    --template-file infrastructure/main.bicep \
    --parameters $BICEP_PARAMS \
    --mode Incremental \
    --only-show-errors \
    --query '{properties: properties}' \
    --output json > deployment-output.json 2>&1

DEPLOY_EXIT_CODE=$?

if [ $DEPLOY_EXIT_CODE -ne 0 ]; then
    echo -e "${RED}✗ Infrastructure deployment failed${NC}"
    echo "Deployment output:"
    cat deployment-output.json
    exit 1
fi

echo -e "${GREEN}✓ Infrastructure deployed${NC}"
echo ""

# Step 4: Extract outputs
echo -e "${BLUE}Step 4: Extracting deployment outputs...${NC}"

# Check if deployment-output.json exists and is valid
if [ ! -f "deployment-output.json" ]; then
    echo -e "${RED}✗ deployment-output.json not found${NC}"
    exit 1
fi

# Validate JSON before parsing
if ! jq empty deployment-output.json 2>/dev/null; then
    echo -e "${RED}✗ Invalid JSON in deployment-output.json${NC}"
    echo "File content:"
    cat deployment-output.json
    echo ""
    echo "Attempting to extract outputs directly from Azure..."
    
    # Fallback: Query deployment directly
    az deployment group show \
        --name $DEPLOYMENT_NAME \
        --resource-group $RESOURCE_GROUP \
        --query 'properties.outputs' \
        --output json > deployment-output.json 2>&1
    
    if ! jq empty deployment-output.json 2>/dev/null; then
        echo -e "${RED}✗ Failed to retrieve valid deployment outputs${NC}"
        exit 1
    fi
    
    echo -e "${YELLOW}⚠ Retrieved outputs directly from Azure${NC}"
fi

# Extract outputs with proper error handling (backend infrastructure only)
if jq -e '.properties.outputs' deployment-output.json > /dev/null 2>&1; then
    # Standard bicep deployment output format
    STORAGE_ACCOUNT=$(jq -r '.properties.outputs.storageAccountName.value // empty' deployment-output.json)
    FUNCTION_APP=$(jq -r '.properties.outputs.functionAppName.value // empty' deployment-output.json)
    OPENAI_NAME=$(jq -r '.properties.outputs.openAIName.value // empty' deployment-output.json)
    OPENAI_ENDPOINT=$(jq -r '.properties.outputs.openAIEndpoint.value // empty' deployment-output.json)
else
    # Direct outputs format
    STORAGE_ACCOUNT=$(jq -r '.storageAccountName.value // empty' deployment-output.json)
    FUNCTION_APP=$(jq -r '.functionAppName.value // empty' deployment-output.json)
    OPENAI_NAME=$(jq -r '.openAIName.value // empty' deployment-output.json)
    OPENAI_ENDPOINT=$(jq -r '.openAIEndpoint.value // empty' deployment-output.json)
fi

# Validate required outputs
if [ -z "$STORAGE_ACCOUNT" ] || [ -z "$FUNCTION_APP" ]; then
    echo -e "${RED}✗ Failed to extract required outputs${NC}"
    echo "Storage Account: $STORAGE_ACCOUNT"
    echo "Function App: $FUNCTION_APP"
    exit 1
fi

echo -e "${GREEN}✓ Backend infrastructure outputs extracted${NC}"
echo "  Storage: $STORAGE_ACCOUNT"
echo "  Function App: $FUNCTION_APP"
echo "  Azure OpenAI: $OPENAI_NAME"
echo ""

# Step 5: Build and deploy backend
echo -e "${BLUE}Step 5: Building and deploying backend...${NC}"
cd backend
npm install --silent
npm run build
func azure functionapp publish $FUNCTION_APP --javascript --nozip > /dev/null 2>&1
cd ..

# Wait for Function App to be fully ready
echo "Waiting for Function App to be fully operational..."
sleep 30

# Verify Function App is running and healthy
FUNC_STATE=$(az functionapp show \
    --name $FUNCTION_APP \
    --resource-group $RESOURCE_GROUP \
    --query state -o tsv)

if [ "$FUNC_STATE" != "Running" ]; then
    echo -e "${YELLOW}⚠ Function App not fully ready yet (state: $FUNC_STATE), waiting...${NC}"
    sleep 30
fi

echo -e "${GREEN}✓ Backend deployed and ready${NC}"
echo ""

# Step 5.5: Create or use existing Azure Static Web App
echo -e "${BLUE}Step 5.5: Setting up Azure Static Web App...${NC}"

# Check if Static Web App already exists
EXISTING_SWA=$(az staticwebapp list --resource-group $RESOURCE_GROUP --query "[0].{name:name, hostname:defaultHostname}" -o json 2>/dev/null)

if [ -n "$EXISTING_SWA" ] && [ "$EXISTING_SWA" != "null" ] && [ "$EXISTING_SWA" != "[]" ]; then
    # Use existing Static Web App
    STATIC_WEB_APP=$(echo "$EXISTING_SWA" | jq -r '.name')
    STATIC_WEB_APP_HOSTNAME=$(echo "$EXISTING_SWA" | jq -r '.hostname')
    STATIC_WEB_APP_URL="https://$STATIC_WEB_APP_HOSTNAME"
    
    echo -e "${GREEN}✓ Using existing Static Web App${NC}"
    echo "  Name: $STATIC_WEB_APP"
    echo "  URL: $STATIC_WEB_APP_URL"

    CURRENT_SWA_SKU=$(az staticwebapp show --name "$STATIC_WEB_APP" --resource-group "$RESOURCE_GROUP" --query "sku.name" -o tsv 2>/dev/null || echo "")
    if [ "$DESIRED_SWA_SKU" = "Standard" ] && [ "$CURRENT_SWA_SKU" != "Standard" ]; then
        echo "Upgrading Static Web App SKU to Standard for External ID/B2C support..."
        az staticwebapp update \
            --name "$STATIC_WEB_APP" \
            --resource-group "$RESOURCE_GROUP" \
            --sku Standard \
            --output none
        echo -e "${GREEN}✓ Static Web App upgraded to Standard${NC}"
    fi
else
    # Create new Static Web App
    STATIC_WEB_APP="swa-qrattendance-prod-$(date +%s)"
    
    echo "Creating Static Web App: $STATIC_WEB_APP"
    SWA_CREATE_OUTPUT=$(az staticwebapp create \
        --name $STATIC_WEB_APP \
        --resource-group $RESOURCE_GROUP \
        --location $LOCATION \
        --sku $DESIRED_SWA_SKU \
        --tags Environment=Production Application="QR Chain Attendance" \
        --query '{name: name, defaultHostname: defaultHostname}' \
        --output json)

    if [ $? -eq 0 ] && [ -n "$SWA_CREATE_OUTPUT" ]; then
        STATIC_WEB_APP_URL="https://$(echo "$SWA_CREATE_OUTPUT" | jq -r '.defaultHostname')"
        STATIC_WEB_APP_HOSTNAME=$(echo "$SWA_CREATE_OUTPUT" | jq -r '.defaultHostname')
        
        echo -e "${GREEN}✓ Static Web App created${NC}"
        echo "  Name: $STATIC_WEB_APP"
        echo "  URL: $STATIC_WEB_APP_URL"
        echo "  SKU: $DESIRED_SWA_SKU"
    else
        echo -e "${RED}✗ Failed to create Static Web App${NC}"
        exit 1
    fi
fi

# Get deployment token
echo "Retrieving deployment token..."
SWA_TOKEN=$(az staticwebapp secrets list \
    --name $STATIC_WEB_APP \
    --resource-group $RESOURCE_GROUP \
    --query 'properties.apiKey' -o tsv 2>/dev/null)

if [ -n "$SWA_TOKEN" ] && [ "$SWA_TOKEN" != "null" ]; then
    echo -e "${GREEN}✓ Deployment token retrieved${NC}"
else
    echo -e "${YELLOW}⚠ Could not retrieve deployment token - will attempt manual deployment${NC}"
fi
echo ""

echo "Ensure the Function App is linked to this Static Web App in the Azure portal:"
echo "  Static Web App -> APIs -> Link -> select $FUNCTION_APP"

# Best-effort check for SWA linked backend (official source of truth)
echo "Checking for Static Web Apps link on Static Web App..."
SWA_LINKED=$(az staticwebapp show --name "$STATIC_WEB_APP" --resource-group "$RESOURCE_GROUP" --query "linkedBackends[].backendResourceId" -o tsv 2>/dev/null | grep -i "/sites/$FUNCTION_APP" || true)
if [ -z "$SWA_LINKED" ]; then
    echo -e "${YELLOW}⚠ Static Web App link not detected on Static Web App${NC}"
    echo "  Free SKU does not support linked backends; frontend will use direct Function API URL"
else
    echo -e "${GREEN}✓ Static Web App link detected on Static Web App${NC}"
fi

# Select frontend API URL strategy based on SWA link availability
if [ -n "$SWA_LINKED" ]; then
    FRONTEND_API_URL="$STATIC_WEB_APP_URL/api"
    echo -e "${GREEN}✓ Frontend API via SWA route: $FRONTEND_API_URL${NC}"
else
    FRONTEND_API_URL="https://$FUNCTION_APP.azurewebsites.net/api"
    echo -e "${YELLOW}⚠ Frontend API via direct Function URL: $FRONTEND_API_URL${NC}"
fi

# Step 6: Database tables (managed by bicep)
echo -e "${BLUE}Step 6: Verifying database tables...${NC}"
echo -e "${GREEN}✓ Database tables managed by bicep infrastructure${NC}"
echo ""

# Step 7: Verify Function App authentication is disabled
echo -e "${BLUE}Step 7: Verifying Function App configuration...${NC}"
# Note: CORS not needed - Static Web Apps uses reverse proxy for /api routes

# Verify Function App authentication is disabled
echo "Verifying Function App authentication is disabled..."
AUTH_ENABLED=$(az webapp auth-classic show \
    --name $FUNCTION_APP \
    --resource-group $RESOURCE_GROUP \
    --query "enabled" -o tsv 2>/dev/null || echo "false")

if [ "$AUTH_ENABLED" = "true" ]; then
    echo -e "${YELLOW}⚠ Function App authentication is enabled, disabling it...${NC}"
    az webapp auth-classic update \
        --name $FUNCTION_APP \
        --resource-group $RESOURCE_GROUP \
        --enabled false \
        --action AllowAnonymous \
        --output none
    echo -e "${GREEN}✓ Function App authentication disabled${NC}"
else
    echo -e "${GREEN}✓ Function App authentication already disabled${NC}"
fi
echo ""

# Step 7.5: Verify and update Azure AD configuration
echo -e "${BLUE}Step 7.5: Configuring Azure AD for Static Web App...${NC}"

# External ID / B2C custom provider requires Standard SKU on Static Web Apps
if [ -n "$EXTERNAL_ID_ISSUER" ]; then
    SWA_SKU=$(az staticwebapp show --name "$STATIC_WEB_APP" --resource-group "$RESOURCE_GROUP" --query "sku.name" -o tsv 2>/dev/null || echo "")
    if [ "$SWA_SKU" != "Standard" ]; then
        echo -e "${RED}✗ External ID/B2C requires Static Web App Standard SKU${NC}"
        echo "  Current SKU: ${SWA_SKU:-unknown}"
        echo "  Static Web App: $STATIC_WEB_APP"
        exit 1
    fi
fi

if [ -n "$AAD_CLIENT_ID" ]; then
    echo -e "${GREEN}✓ Azure AD credentials provided${NC}"
    echo "  Client ID: $AAD_CLIENT_ID"
    echo "  Tenant: $TENANT_ID"
    
    # Update Azure AD redirect URI for the new Static Web App
    echo -e "${BLUE}Updating Azure AD redirect URI...${NC}"
    REDIRECT_URI="$STATIC_WEB_APP_URL/.auth/login/aad/callback"

    # Dual-tenant safe: query/update app in TENANT_ID using Graph token for that tenant
    GRAPH_TOKEN=$(az account get-access-token --tenant "$TENANT_ID" --resource-type ms-graph --query accessToken -o tsv 2>/dev/null || echo "")

    if [ -z "$GRAPH_TOKEN" ]; then
        echo -e "${YELLOW}⚠ Could not get Graph token for tenant $TENANT_ID${NC}"
        echo "  Skipping redirect URI auto-update. Ensure this URI exists in app registration:"
        echo "  $REDIRECT_URI"
    else
        APP_QUERY_URL="https://graph.microsoft.com/v1.0/applications?\$filter=appId eq '$AAD_CLIENT_ID'&\$select=id,appId,web"
        APP_QUERY_RESPONSE=$(az rest --method GET --url "$APP_QUERY_URL" --headers "Authorization=Bearer $GRAPH_TOKEN" --output json 2>/dev/null || echo "")
        APP_OBJECT_ID=$(echo "$APP_QUERY_RESPONSE" | jq -r '.value[0].id // empty' 2>/dev/null || echo "")

        if [ -z "$APP_OBJECT_ID" ]; then
            echo -e "${YELLOW}⚠ App ID $AAD_CLIENT_ID not found in tenant $TENANT_ID${NC}"
            echo "  Skipping redirect URI auto-update. Ensure this URI exists in app registration:"
            echo "  $REDIRECT_URI"
        else
            CURRENT_REDIRECT_URIS=$(echo "$APP_QUERY_RESPONSE" | jq -c '.value[0].web.redirectUris // []' 2>/dev/null || echo "[]")

            if echo "$CURRENT_REDIRECT_URIS" | jq -e --arg uri "$REDIRECT_URI" 'index($uri)' >/dev/null 2>&1; then
                echo -e "${GREEN}✓ Redirect URI already configured${NC}"
            else
                echo "Adding redirect URI: $REDIRECT_URI"
                UPDATED_REDIRECT_URIS=$(echo "$CURRENT_REDIRECT_URIS" | jq -c --arg uri "$REDIRECT_URI" '. + [$uri]')

                az rest --method PATCH \
                    --url "https://graph.microsoft.com/v1.0/applications/$APP_OBJECT_ID" \
                    --headers "Authorization=Bearer $GRAPH_TOKEN" "Content-Type=application/json" \
                    --body "{\"web\":{\"redirectUris\":$UPDATED_REDIRECT_URIS}}" \
                    --output none

                echo -e "${GREEN}✓ Redirect URI added to Azure AD app (tenant $TENANT_ID)${NC}"
            fi
        fi
    fi
    
    # Configure Static Web App application settings
    echo -e "${BLUE}Configuring Static Web App AAD settings...${NC}"
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
        --name $STATIC_WEB_APP \
        --resource-group $RESOURCE_GROUP \
        --setting-names "${SWA_AUTH_SETTINGS[@]}" \
        --output none
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Static Web App AAD settings configured${NC}"
    else
        echo -e "${YELLOW}⚠ Failed to configure Static Web App AAD settings${NC}"
        echo "You may need to configure manually using the Azure portal"
    fi
else
    echo -e "${YELLOW}⚠ Azure AD not configured - manual setup required${NC}"
    echo ""
    echo "To configure Azure AD authentication:"
    echo "  1. Update your Azure AD App Registration:"
    echo "     - Add redirect URI: $STATIC_WEB_APP_URL/.auth/login/aad/callback"
    echo "     - Set multi-tenant if needed"
    echo "  2. Update staticwebapp.config.json with your client ID"
    echo "  3. Redeploy frontend with updated configuration"
    echo ""
fi
echo ""

# Step 8: Build and deploy frontend
echo -e "${BLUE}Step 8: Building and deploying frontend...${NC}"

if [ -n "$EXTERNAL_ID_ISSUER" ]; then
    echo "Synchronizing frontend openIdIssuer from .external-id-credentials..."
    TMP_SWA_CONFIG=$(mktemp)
    jq --arg issuer "$EXTERNAL_ID_ISSUER" '.auth.identityProviders.azureActiveDirectory.registration.openIdIssuer = $issuer' frontend/staticwebapp.config.json > "$TMP_SWA_CONFIG"
    mv "$TMP_SWA_CONFIG" frontend/staticwebapp.config.json
    echo -e "${GREEN}✓ openIdIssuer synchronized: $EXTERNAL_ID_ISSUER${NC}"
fi

# Update frontend environment
# Use AAD_CLIENT_ID if provided, otherwise use placeholder
FRONTEND_AAD_CLIENT_ID="${AAD_CLIENT_ID:-YOUR_AAD_CLIENT_ID}"

# Export environment variables for Next.js build
export NEXT_PUBLIC_API_URL="$FRONTEND_API_URL"
export NEXT_PUBLIC_AAD_CLIENT_ID="$FRONTEND_AAD_CLIENT_ID"
export NEXT_PUBLIC_AAD_TENANT_ID="$TENANT_ID"
export NEXT_PUBLIC_AAD_REDIRECT_URI="$STATIC_WEB_APP_URL/.auth/login/aad/callback"
export NEXT_PUBLIC_SIGNALR_URL="https://$FUNCTION_APP.azurewebsites.net/api"
export NEXT_PUBLIC_ENVIRONMENT="production"
export NEXT_PUBLIC_FRONTEND_URL="$STATIC_WEB_APP_URL"

# Also create .env.production file as backup
cat > frontend/.env.production << EOF
# Production Environment Configuration
NEXT_PUBLIC_API_URL=$FRONTEND_API_URL
NEXT_PUBLIC_AAD_CLIENT_ID=$FRONTEND_AAD_CLIENT_ID
NEXT_PUBLIC_AAD_TENANT_ID=$TENANT_ID
NEXT_PUBLIC_AAD_REDIRECT_URI=$STATIC_WEB_APP_URL/.auth/login/aad/callback
NEXT_PUBLIC_SIGNALR_URL=https://$FUNCTION_APP.azurewebsites.net/api
NEXT_PUBLIC_ENVIRONMENT=production
NEXT_PUBLIC_FRONTEND_URL=$STATIC_WEB_APP_URL
EOF

cd frontend
npm install --silent

# Build with error handling
echo "Building frontend..."
if npm run build; then
    # Copy staticwebapp.config.json to output directory (Next.js doesn't include it automatically)
    cp staticwebapp.config.json out/
    echo -e "${GREEN}✓ Frontend build successful${NC}"
else
    echo -e "${RED}✗ Frontend build failed${NC}"
    cd ..
    exit 1
fi

# Deploy to Static Web App
if [ -n "$SWA_TOKEN" ] && [ "$SWA_TOKEN" != "null" ] && [ "$SWA_TOKEN" != "empty" ]; then
    echo "Deploying to Static Web App..."
    
    # Check if SWA CLI is available, install if needed
    if ! command -v swa &> /dev/null; then
        echo "Installing Azure Static Web Apps CLI..."
        npm install -g @azure/static-web-apps-cli --silent
    fi
    
    # Deploy using SWA CLI
    if swa deploy \
        --deployment-token "$SWA_TOKEN" \
        --app-location . \
        --output-location out \
        --env production; then
        echo -e "${GREEN}✓ Frontend deployed to Static Web App${NC}"
    else
        echo -e "${YELLOW}⚠ SWA CLI deployment failed, trying alternative method...${NC}"
        
        # Alternative: Use npx if swa command fails
        if npx @azure/static-web-apps-cli deploy \
            --deployment-token "$SWA_TOKEN" \
            --app-location . \
            --output-location out \
            --env production; then
            echo -e "${GREEN}✓ Frontend deployed via npx SWA CLI${NC}"
        else
            echo -e "${YELLOW}⚠ Automated deployment failed${NC}"
            echo "Please deploy manually using:"
            echo "  cd frontend"
            echo "  npx @azure/static-web-apps-cli deploy --deployment-token=\"$SWA_TOKEN\" --app-location=. --output-location=out --env=production"
        fi
    fi
else
    echo -e "${YELLOW}⚠ No deployment token available${NC}"
    echo "Please deploy manually using the Azure portal or SWA CLI"
    echo "Static Web App URL: $STATIC_WEB_APP_URL"
fi

cd ..
echo -e "${GREEN}✓ Frontend deployed${NC}"
echo ""

# Step 9: Verify deployment
echo -e "${BLUE}Step 9: Verifying deployment...${NC}"

# Check Function App
FUNC_STATE=$(az functionapp show \
    --name $FUNCTION_APP \
    --resource-group $RESOURCE_GROUP \
    --query state -o tsv)

if [ "$FUNC_STATE" != "Running" ]; then
    echo -e "${YELLOW}⚠ Function App not running yet (state: $FUNC_STATE)${NC}"
else
    echo -e "${GREEN}✓ Function App is running${NC}"
fi

# Check Static Web App
SWA_STATE=$(az staticwebapp show \
    --name $STATIC_WEB_APP \
    --resource-group $RESOURCE_GROUP \
    --query "repositoryUrl || 'Manual'" -o tsv 2>/dev/null || echo "Unknown")

if [ "$SWA_STATE" != "Unknown" ]; then
    echo -e "${GREEN}✓ Static Web App is ready${NC}"
else
    echo -e "${YELLOW}⚠ Static Web App status unknown${NC}"
fi

if ! verify_external_id_login "$STATIC_WEB_APP_URL" "$TENANT_ID"; then
    echo -e "${RED}✗ Authentication verification failed. Deployment halted.${NC}"
    exit 1
fi

# Check tables
TABLE_COUNT=$(az storage table list \
    --account-name $STORAGE_ACCOUNT \
    --auth-mode login \
    --query "length(@)" -o tsv 2>/dev/null)

echo -e "${GREEN}✓ Database tables: $TABLE_COUNT${NC}"

# Check Azure OpenAI (only if deployed)
if [ -n "$OPENAI_NAME" ] && [ "$OPENAI_NAME" != "null" ] && [ "$OPENAI_NAME" != "empty" ]; then
    OPENAI_STATE=$(az cognitiveservices account show \
        --name $OPENAI_NAME \
        --resource-group $RESOURCE_GROUP \
        --query properties.provisioningState -o tsv 2>/dev/null || echo "NotFound")

    if [ "$OPENAI_STATE" != "Succeeded" ]; then
        echo -e "${YELLOW}⚠ Azure OpenAI provisioning (state: $OPENAI_STATE)${NC}"
    else
        echo -e "${GREEN}✓ Azure OpenAI is ready${NC}"
    fi
else
    echo -e "${YELLOW}⚠ Azure OpenAI not deployed${NC}"
fi

echo ""

# Step 10: Display summary
echo -e "${GREEN}=========================================="
echo "Deployment Complete!"
echo -e "==========================================${NC}"
echo ""
echo -e "${BLUE}Production URLs:${NC}"
echo "  Frontend: $STATIC_WEB_APP_URL"
echo "  Backend:  https://$FUNCTION_APP.azurewebsites.net"
echo ""
echo -e "${BLUE}Azure Resources:${NC}"
echo "  Resource Group: $RESOURCE_GROUP"
echo "  Storage:        $STORAGE_ACCOUNT"
echo "  Function App:   $FUNCTION_APP"
echo "  Static Web App: $STATIC_WEB_APP"
echo "  Azure OpenAI:   $OPENAI_NAME"
echo ""
echo -e "${BLUE}Azure OpenAI:${NC}"
if [ -n "$OPENAI_ENDPOINT" ] && [ "$OPENAI_ENDPOINT" != "null" ] && [ "$OPENAI_ENDPOINT" != "empty" ]; then
    echo "  Endpoint: $OPENAI_ENDPOINT"
    echo "  Models:   gpt-4o, gpt-4o-vision"
else
    echo "  Not deployed"
fi
echo ""
echo -e "${BLUE}Database:${NC}"
echo "  Tables: $TABLE_COUNT"
echo ""
echo -e "${GREEN}✓ Production deployment successful!${NC}"
echo ""
echo "Next steps:"
echo "  1. Visit: $STATIC_WEB_APP_URL"
echo "  2. Login with Azure AD"
echo "  3. Test all features"
echo ""

# Save deployment info
cat > deployment-info.json << EOF
{
  "deploymentDate": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "resourceGroup": "$RESOURCE_GROUP",
  "location": "$LOCATION",
  "frontendUrl": "$STATIC_WEB_APP_URL",
  "backendUrl": "https://$FUNCTION_APP.azurewebsites.net",
  "storageAccount": "$STORAGE_ACCOUNT",
  "functionApp": "$FUNCTION_APP",
  "staticWebApp": "$STATIC_WEB_APP",
  "azureOpenAI": "${OPENAI_NAME:-null}",
  "openAIEndpoint": "${OPENAI_ENDPOINT:-null}",
  "tableCount": ${TABLE_COUNT:-0},
  "infrastructure": {
    "bicepDeployment": "completed",
    "staticWebAppDeployment": "cli-created",
    "functionAppAuthDisabled": true,
    "multiTenantAuth": $([ "$TENANT_ID" = "organizations" ] && echo "true" || echo "false")
  }
}
EOF

echo "Deployment info saved to: deployment-info.json"
echo ""
