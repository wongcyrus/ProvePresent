#!/bin/bash
# Quick Backend Deployment Script
# Builds and deploys only the backend functions to existing Function App

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
RESOURCE_GROUP="rg-qr-attendance-dev"

echo -e "${BLUE}=========================================="
echo "Quick Backend Deployment"
echo -e "==========================================${NC}"
echo ""

# Get Function App details
echo -e "${BLUE}Step 1: Getting Function App details...${NC}"

FUNCTION_APP_NAME=$(az functionapp list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)

if [ -z "$FUNCTION_APP_NAME" ] || [ "$FUNCTION_APP_NAME" = "null" ]; then
    echo -e "${RED}✗ Function App not found${NC}"
    echo "Run deploy-full-development.sh first to create infrastructure"
    exit 1
fi

echo -e "${GREEN}✓ Found Function App: $FUNCTION_APP_NAME${NC}"
echo ""

# Get connection strings
echo -e "${BLUE}Step 2: Getting connection strings...${NC}"

STORAGE_NAME=$(az storage account list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null || echo "")
if [ -z "$STORAGE_NAME" ] || [ "$STORAGE_NAME" = "null" ]; then
    echo -e "${RED}✗ Storage account not found${NC}"
    exit 1
fi

echo "Getting storage connection string..."
STORAGE_CONNECTION_STRING=$(az storage account show-connection-string --name "$STORAGE_NAME" --resource-group "$RESOURCE_GROUP" --query connectionString -o tsv 2>/dev/null || echo "")

# Get OpenAI details
echo "Getting OpenAI details..."
OPENAI_NAME=$(az cognitiveservices account list --resource-group "$RESOURCE_GROUP" --query "[?kind=='OpenAI' || kind=='AIServices'][0].name" -o tsv 2>/dev/null || echo "")
if [ -n "$OPENAI_NAME" ] && [ "$OPENAI_NAME" != "null" ]; then
    OPENAI_ENDPOINT=$(az cognitiveservices account show --name "$OPENAI_NAME" --resource-group "$RESOURCE_GROUP" --query properties.endpoint -o tsv 2>/dev/null || echo "")
    OPENAI_KEY=$(az cognitiveservices account keys list --name "$OPENAI_NAME" --resource-group "$RESOURCE_GROUP" --query key1 -o tsv 2>/dev/null || echo "")
else
    OPENAI_ENDPOINT=""
    OPENAI_KEY=""
fi

# Get Application Insights
echo "Getting Application Insights..."
APPINSIGHTS_NAME=$(az monitor app-insights component list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null || echo "")
if [ -n "$APPINSIGHTS_NAME" ] && [ "$APPINSIGHTS_NAME" != "null" ]; then
    APPINSIGHTS_CONNECTION_STRING=$(az monitor app-insights component show --app "$APPINSIGHTS_NAME" --resource-group "$RESOURCE_GROUP" --query connectionString -o tsv 2>/dev/null || echo "")
else
    APPINSIGHTS_CONNECTION_STRING=""
fi

# Get SignalR
echo "Getting SignalR..."
SIGNALR_NAME=$(az signalr list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null || echo "")
if [ -n "$SIGNALR_NAME" ] && [ "$SIGNALR_NAME" != "null" ]; then
    SIGNALR_CONNECTION_STRING=$(az signalr key list --name "$SIGNALR_NAME" --resource-group "$RESOURCE_GROUP" --query primaryConnectionString -o tsv 2>/dev/null || echo "")
else
    SIGNALR_CONNECTION_STRING=""
fi

echo -e "${GREEN}✓ Connection strings retrieved${NC}"
echo ""

# Build backend
echo -e "${BLUE}Step 3: Building backend...${NC}"
cd backend

# Install dependencies
echo "Installing dependencies..."
npm install

# Build TypeScript
echo "Building TypeScript..."
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

echo -e "${GREEN}✓ Backend built${NC}"
echo ""

# Deploy
echo -e "${BLUE}Step 4: Deploying to Function App...${NC}"
echo "This may take 1-2 minutes..."

if ! func azure functionapp publish "$FUNCTION_APP_NAME" --typescript; then
    echo -e "${RED}✗ Deployment failed${NC}"
    cd ..
    exit 1
fi

cd ..

echo ""
echo -e "${GREEN}=========================================="
echo "Backend Deployment Complete!"
echo -e "==========================================${NC}"
echo ""
echo "  Function App: $FUNCTION_APP_NAME"
echo "  URL: https://${FUNCTION_APP_NAME}.azurewebsites.net"
echo ""
echo -e "${GREEN}✓ Backend deployed successfully!${NC}"
echo ""
echo "New functions deployed:"
echo "  - studentNegotiate (SignalR connection for students)"
echo "  - initiateImageCapture (Teacher photo capture request)"
echo "  - notifyImageUpload (Student upload notification)"
echo "  - processCaptureTimeout (Capture timeout handler)"
echo "  - getCaptureResults (Get capture analysis results)"
echo "  - getCaptureHistory (Get capture history)"
