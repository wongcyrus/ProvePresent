#!/bin/bash

# Configure CORS for Azure Blob Storage to allow student photo uploads
# This script updates CORS settings without requiring full infrastructure redeployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔧 Configuring CORS for Azure Blob Storage...${NC}"
echo ""

# Get environment (default to dev)
ENVIRONMENT="${1:-dev}"
RESOURCE_GROUP="rg-qrattendance-${ENVIRONMENT}"

echo -e "${BLUE}Environment: ${ENVIRONMENT}${NC}"
echo -e "${BLUE}Resource Group: ${RESOURCE_GROUP}${NC}"
echo ""

# Get storage account name
echo "Getting storage account name..."
STORAGE_ACCOUNT_NAME=$(az storage account list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)

if [ -z "$STORAGE_ACCOUNT_NAME" ] || [ "$STORAGE_ACCOUNT_NAME" = "null" ]; then
    echo -e "${RED}✗ Storage account not found in resource group: $RESOURCE_GROUP${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Storage Account: $STORAGE_ACCOUNT_NAME${NC}"
echo ""

# Clear existing CORS rules first
echo "Clearing existing CORS rules..."
az storage cors clear \
  --services b \
  --account-name "$STORAGE_ACCOUNT_NAME" 2>/dev/null || true

# Configure CORS rules for blob service
echo "Setting new CORS rules..."

az storage cors add \
  --services b \
  --methods GET PUT POST DELETE HEAD OPTIONS \
  --origins "https://*.azurestaticapps.net" "http://localhost:3000" "http://127.0.0.1:3000" \
  --allowed-headers "*" \
  --exposed-headers "*" \
  --max-age 3600 \
  --account-name "$STORAGE_ACCOUNT_NAME"

echo ""
echo -e "${GREEN}✅ CORS configuration complete!${NC}"
echo ""
echo -e "${BLUE}Configured origins:${NC}"
echo "  - https://*.azurestaticapps.net (production)"
echo "  - http://localhost:3000 (local dev)"
echo "  - http://127.0.0.1:3000 (local dev)"
echo ""
echo -e "${BLUE}Allowed methods:${NC} GET, PUT, POST, DELETE, HEAD, OPTIONS"
echo -e "${BLUE}Max age:${NC} 3600 seconds (1 hour)"
echo ""
echo -e "${GREEN}Students can now upload photos directly to blob storage!${NC}"
echo ""
echo -e "${YELLOW}Note: Changes take effect immediately. No redeployment needed.${NC}"
