#!/bin/bash
# Quick Frontend Deployment Script
# Builds and deploys only the frontend to existing Static Web App

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
RESOURCE_GROUP="rg-qr-attendance-dev"
STATIC_WEB_APP_NAME="swa-qrattendance-dev"

echo -e "${BLUE}=========================================="
echo "Quick Frontend Deployment"
echo -e "==========================================${NC}"
echo ""

# Load credentials
if [ -f ".external-id-credentials" ]; then
    source ./.external-id-credentials
else
    echo -e "${RED}✗ Missing .external-id-credentials${NC}"
    exit 1
fi

# Get Static Web App details
echo -e "${BLUE}Step 1: Getting Static Web App details...${NC}"

# Try to find the SWA
SWA_FOUND=""
for SWA_NAME in "$STATIC_WEB_APP_NAME" "swa-qrattendance-dev" "$(az staticwebapp list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)"; do
    if [ -n "$SWA_NAME" ] && [ "$SWA_NAME" != "null" ]; then
        if az staticwebapp show --name "$SWA_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
            STATIC_WEB_APP_NAME="$SWA_NAME"
            SWA_FOUND="yes"
            break
        fi
    fi
done

if [ -z "$SWA_FOUND" ]; then
    echo -e "${RED}✗ Static Web App not found${NC}"
    echo "Run deploy-full-development.sh first to create infrastructure"
    exit 1
fi

STATIC_WEB_APP_HOSTNAME=$(az staticwebapp show --name "$STATIC_WEB_APP_NAME" --query "defaultHostname" -o tsv)
STATIC_WEB_APP_URL="https://$STATIC_WEB_APP_HOSTNAME"

echo -e "${GREEN}✓ Found Static Web App: $STATIC_WEB_APP_NAME${NC}"
echo "  URL: $STATIC_WEB_APP_URL"
echo ""

# Get Function App URL for API configuration
echo -e "${BLUE}Step 2: Getting Function App URL...${NC}"
FUNCTION_APP_NAME=$(az functionapp list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null || echo "func-qrattendance-dev")
FUNCTION_APP_URL="https://${FUNCTION_APP_NAME}.azurewebsites.net"

# Check if SWA has linked backend
SWA_LINKED=$(az staticwebapp show --name "$STATIC_WEB_APP_NAME" --resource-group "$RESOURCE_GROUP" --query "linkedBackends[].backendResourceId" -o tsv 2>/dev/null | grep -i "/sites/$FUNCTION_APP_NAME" || true)

if [ -n "$SWA_LINKED" ]; then
    FRONTEND_API_URL="/api"
    echo -e "${GREEN}✓ Using SWA built-in API proxy: /api${NC}"
else
    FRONTEND_API_URL="${FUNCTION_APP_URL%/}/api"
    echo -e "${YELLOW}⚠ Using direct Function URL: $FRONTEND_API_URL${NC}"
fi
echo ""

# Build frontend
echo -e "${BLUE}Step 3: Building frontend...${NC}"
cd frontend

# Install dependencies
echo "Installing dependencies..."
npm install

# Create environment file
cat > .env.local << EOF
NEXT_PUBLIC_API_URL=$FRONTEND_API_URL
NEXT_PUBLIC_ENVIRONMENT=dev
NEXT_PUBLIC_AAD_CLIENT_ID=$AAD_CLIENT_ID
NEXT_PUBLIC_AAD_TENANT_ID=$TENANT_ID
NEXT_PUBLIC_AAD_REDIRECT_URI=$STATIC_WEB_APP_URL/.auth/login/aad/callback
EOF

# Sync openIdIssuer if using External ID
if [ -n "$EXTERNAL_ID_ISSUER" ]; then
    echo "Syncing openIdIssuer..."
    TMP_SWA_CONFIG=$(mktemp)
    jq --arg issuer "$EXTERNAL_ID_ISSUER" '.auth.identityProviders.azureActiveDirectory.registration.openIdIssuer = $issuer' staticwebapp.config.json > "$TMP_SWA_CONFIG"
    mv "$TMP_SWA_CONFIG" staticwebapp.config.json
fi

# Build
echo "Building..."
npm run build

# Copy config to output
cp staticwebapp.config.json out/

echo -e "${GREEN}✓ Frontend built${NC}"
echo ""

# Deploy
echo -e "${BLUE}Step 4: Deploying to Static Web App...${NC}"

# Get deployment token
DEPLOYMENT_TOKEN=$(az staticwebapp secrets list --name "$STATIC_WEB_APP_NAME" --query "properties.apiKey" -o tsv 2>/dev/null)

if [ -z "$DEPLOYMENT_TOKEN" ] || [ "$DEPLOYMENT_TOKEN" = "null" ]; then
    echo -e "${RED}✗ Failed to get deployment token${NC}"
    cd ..
    exit 1
fi

# Deploy
swa deploy ./out --deployment-token="$DEPLOYMENT_TOKEN" --env production

cd ..

echo ""
echo -e "${GREEN}=========================================="
echo "Frontend Deployment Complete!"
echo -e "==========================================${NC}"
echo ""
echo "  URL: $STATIC_WEB_APP_URL"
echo ""
echo -e "${GREEN}✓ Frontend deployed successfully!${NC}"
