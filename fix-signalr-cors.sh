#!/bin/bash
# Fix SignalR CORS for Static Web Apps
# Adds Static Web App origins to SignalR CORS settings

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=========================================="
echo "Fix SignalR CORS Settings"
echo -e "==========================================${NC}"
echo ""

# Load credentials
if [ -f ".external-id-credentials" ]; then
    source ./.external-id-credentials
else
    echo -e "${RED}✗ Missing .external-id-credentials${NC}"
    exit 1
fi

# Function to fix CORS for an environment
fix_cors() {
    local ENV=$1
    local RG="rg-qr-attendance-${ENV}"
    local SIGNALR_NAME="signalr-qrattendance-${ENV}"
    
    echo -e "${BLUE}Fixing CORS for ${ENV} environment...${NC}"
    
    # Get Static Web App hostname
    SWA_HOSTNAME=$(az staticwebapp list --resource-group "$RG" --query "[0].defaultHostname" -o tsv 2>/dev/null)
    
    if [ -z "$SWA_HOSTNAME" ] || [ "$SWA_HOSTNAME" = "null" ]; then
        echo -e "${YELLOW}⚠ No Static Web App found in ${ENV}${NC}"
        return
    fi
    
    echo "  Static Web App: https://${SWA_HOSTNAME}"
    
    # Check if SignalR exists
    if ! az signalr show --name "$SIGNALR_NAME" --resource-group "$RG" --output none 2>/dev/null; then
        echo -e "${YELLOW}⚠ SignalR not found in ${ENV}${NC}"
        return
    fi
    
    # Add CORS origin
    echo "  Adding CORS origin..."
    az signalr cors add \
        --name "$SIGNALR_NAME" \
        --resource-group "$RG" \
        --allowed-origins "https://${SWA_HOSTNAME}" \
        --output none 2>/dev/null || true
    
    # Verify
    ORIGINS=$(az signalr cors list --name "$SIGNALR_NAME" --resource-group "$RG" --query "allowedOrigins" -o tsv 2>/dev/null)
    
    if echo "$ORIGINS" | grep -q "$SWA_HOSTNAME"; then
        echo -e "${GREEN}✓ CORS configured for ${ENV}${NC}"
    else
        echo -e "${YELLOW}⚠ CORS may not be configured correctly${NC}"
    fi
    
    echo ""
}

# Fix both environments
fix_cors "dev"
fix_cors "prod"

echo -e "${GREEN}=========================================="
echo "CORS Configuration Complete!"
echo -e "==========================================${NC}"
echo ""
echo "SignalR services are now configured to accept connections from Static Web Apps."
echo ""
