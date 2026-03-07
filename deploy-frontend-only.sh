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

usage() {
    echo "Usage: $0 [-e <environment>] [-g <resource-group>] [-s <static-web-app-name>]"
    echo ""
    echo "Options:"
    echo "  -e, --environment      Environment (dev|staging|prod). Default: dev"
    echo "  -g, --resource-group   Resource group name. Default: rg-qr-attendance-<environment>"
    echo "  -s, --static-web-app   Static Web App name. Default: swa-qrattendance-<environment>"
    echo "  -h, --help             Show this help"
    exit 1
}

ENVIRONMENT="dev"
RESOURCE_GROUP=""
STATIC_WEB_APP_NAME=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -g|--resource-group)
            RESOURCE_GROUP="$2"
            shift 2
            ;;
        -s|--static-web-app)
            STATIC_WEB_APP_NAME="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
done

if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
    echo -e "${RED}✗ Invalid environment: $ENVIRONMENT${NC}"
    echo "  Use one of: dev, staging, prod"
    exit 1
fi

RESOURCE_GROUP="${RESOURCE_GROUP:-rg-qr-attendance-${ENVIRONMENT}}"
STATIC_WEB_APP_NAME="${STATIC_WEB_APP_NAME:-swa-qrattendance-${ENVIRONMENT}}"

echo -e "${BLUE}=========================================="
echo "Quick Frontend Deployment"
echo -e "==========================================${NC}"
echo ""
echo "Environment: $ENVIRONMENT"
echo "Resource Group: $RESOURCE_GROUP"
echo "Static Web App (preferred): $STATIC_WEB_APP_NAME"
echo ""

# Get Static Web App details
echo -e "${BLUE}Step 1: Getting Static Web App details...${NC}"

# Try to find the SWA
SWA_FOUND=""
for SWA_NAME in "$STATIC_WEB_APP_NAME" "$(az staticwebapp list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)"; do
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
    echo "Run deploy-full-${ENVIRONMENT}.sh first to create infrastructure"
    exit 1
fi

STATIC_WEB_APP_HOSTNAME=$(az staticwebapp show --name "$STATIC_WEB_APP_NAME" --query "defaultHostname" -o tsv)
STATIC_WEB_APP_URL="https://$STATIC_WEB_APP_HOSTNAME"

echo -e "${GREEN}✓ Found Static Web App: $STATIC_WEB_APP_NAME${NC}"
echo "  URL: $STATIC_WEB_APP_URL"
echo ""

# Get Function App URL for API configuration
echo -e "${BLUE}Step 2: Getting Function App URL...${NC}"
FUNCTION_APP_NAME=$(az functionapp list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null || echo "func-qrattendance-${ENVIRONMENT}")
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
NEXT_PUBLIC_ENVIRONMENT=$ENVIRONMENT
EOF

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
