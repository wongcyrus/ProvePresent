#!/bin/bash
# Verification script for student image capture deployment

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

RESOURCE_GROUP="rg-qr-attendance-dev"

echo -e "${BLUE}=========================================="
echo "Student Image Capture - Deployment Verification"
echo -e "==========================================${NC}"
echo ""

# Check Function App
echo -e "${BLUE}1. Checking Function App...${NC}"
FUNCTION_APP_NAME=$(az functionapp list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)

if [ -z "$FUNCTION_APP_NAME" ]; then
    echo -e "${RED}✗ Function App not found${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Function App: $FUNCTION_APP_NAME${NC}"
FUNCTION_APP_URL="https://${FUNCTION_APP_NAME}.azurewebsites.net"
echo "  URL: $FUNCTION_APP_URL"
echo ""

# Check required functions
echo -e "${BLUE}2. Checking deployed functions...${NC}"
REQUIRED_FUNCTIONS=(
    "initiateImageCapture"
    "studentNegotiate"
    "notifyImageUpload"
    "processCaptureTimeout"
    "getCaptureResults"
    "getCaptureHistory"
)

for func in "${REQUIRED_FUNCTIONS[@]}"; do
    if az functionapp function show --name "$FUNCTION_APP_NAME" --resource-group "$RESOURCE_GROUP" --function-name "$func" &>/dev/null; then
        echo -e "${GREEN}✓ $func${NC}"
    else
        echo -e "${RED}✗ $func (not found)${NC}"
    fi
done
echo ""

# Check Storage Tables
echo -e "${BLUE}3. Checking Storage Tables...${NC}"
STORAGE_NAME=$(az storage account list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)

if [ -z "$STORAGE_NAME" ]; then
    echo -e "${RED}✗ Storage account not found${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Storage Account: $STORAGE_NAME${NC}"

REQUIRED_TABLES=(
    "CaptureRequests"
    "CaptureUploads"
    "CaptureResults"
)

STORAGE_KEY=$(az storage account keys list --account-name "$STORAGE_NAME" --resource-group "$RESOURCE_GROUP" --query "[0].value" -o tsv 2>/dev/null)

for table in "${REQUIRED_TABLES[@]}"; do
    if az storage table exists --name "$table" --account-name "$STORAGE_NAME" --account-key "$STORAGE_KEY" --query "exists" -o tsv 2>/dev/null | grep -q "true"; then
        echo -e "${GREEN}✓ $table${NC}"
    else
        echo -e "${RED}✗ $table (not found)${NC}"
    fi
done
echo ""

# Check Blob Container
echo -e "${BLUE}4. Checking Blob Container...${NC}"
if az storage container exists --name "student-captures" --account-name "$STORAGE_NAME" --account-key "$STORAGE_KEY" --query "exists" -o tsv 2>/dev/null | grep -q "true"; then
    echo -e "${GREEN}✓ student-captures container${NC}"
else
    echo -e "${RED}✗ student-captures container (not found)${NC}"
fi
echo ""

# Check SignalR
echo -e "${BLUE}5. Checking SignalR Service...${NC}"
SIGNALR_NAME=$(az signalr list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)

if [ -z "$SIGNALR_NAME" ]; then
    echo -e "${RED}✗ SignalR service not found${NC}"
else
    echo -e "${GREEN}✓ SignalR Service: $SIGNALR_NAME${NC}"
    SIGNALR_ENDPOINT=$(az signalr show --name "$SIGNALR_NAME" --resource-group "$RESOURCE_GROUP" --query "hostName" -o tsv 2>/dev/null)
    echo "  Endpoint: https://$SIGNALR_ENDPOINT"
fi
echo ""

# Check OpenAI
echo -e "${BLUE}6. Checking OpenAI Service...${NC}"
OPENAI_NAME=$(az cognitiveservices account list --resource-group "$RESOURCE_GROUP" --query "[?kind=='OpenAI' || kind=='AIServices'].name | [0]" -o tsv 2>/dev/null)

if [ -z "$OPENAI_NAME" ] || [ "$OPENAI_NAME" = "null" ]; then
    echo -e "${RED}✗ OpenAI service not found${NC}"
else
    echo -e "${GREEN}✓ OpenAI Service: $OPENAI_NAME${NC}"
    
    # Check for GPT-5.2-chat deployment
    if az cognitiveservices account deployment show --name "$OPENAI_NAME" --resource-group "$RESOURCE_GROUP" --deployment-name "gpt-5.2-chat" &>/dev/null; then
        echo -e "${GREEN}✓ gpt-5.2-chat deployment${NC}"
    else
        echo -e "${YELLOW}⚠ gpt-5.2-chat deployment not found${NC}"
    fi
fi
echo ""

# Check Static Web App
echo -e "${BLUE}7. Checking Static Web App...${NC}"
SWA_NAME=$(az staticwebapp list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)

if [ -z "$SWA_NAME" ]; then
    echo -e "${RED}✗ Static Web App not found${NC}"
else
    echo -e "${GREEN}✓ Static Web App: $SWA_NAME${NC}"
    SWA_URL=$(az staticwebapp show --name "$SWA_NAME" --resource-group "$RESOURCE_GROUP" --query "defaultHostname" -o tsv 2>/dev/null)
    echo "  URL: https://$SWA_URL"
fi
echo ""

# Summary
echo -e "${BLUE}=========================================="
echo "Verification Summary"
echo -e "==========================================${NC}"
echo ""
echo "Frontend URL: https://$SWA_URL"
echo "Backend URL: $FUNCTION_APP_URL"
echo ""
echo -e "${GREEN}Next Steps:${NC}"
echo "1. Login as teacher: https://$SWA_URL/teacher"
echo "2. Create/open a session"
echo "3. Login as student: https://$SWA_URL/student"
echo "4. Join the session"
echo "5. Teacher clicks '📸 Capture Student Photos'"
echo "6. Student should see capture UI automatically"
echo ""
echo "For detailed testing instructions, see: CAPTURE_FEATURE_COMPLETE.md"
echo ""
