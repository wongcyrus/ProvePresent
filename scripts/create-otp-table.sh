#!/bin/bash
# Create OtpCodes table in Azure Table Storage
# This script can be run manually if the table doesn't exist

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Creating OtpCodes table in Azure Table Storage...${NC}"

# Get storage account name from environment or prompt
if [ -z "$STORAGE_ACCOUNT_NAME" ]; then
    echo -e "${YELLOW}Enter storage account name (e.g., stqrattendanceprod):${NC}"
    read -r STORAGE_ACCOUNT_NAME
fi

# Get resource group from environment or prompt
if [ -z "$RESOURCE_GROUP" ]; then
    echo -e "${YELLOW}Enter resource group name:${NC}"
    read -r RESOURCE_GROUP
fi

echo "Storage Account: $STORAGE_ACCOUNT_NAME"
echo "Resource Group: $RESOURCE_GROUP"
echo ""

# Check if table already exists
echo "Checking if OtpCodes table exists..."
TABLE_EXISTS=$(az storage table exists \
    --name OtpCodes \
    --account-name "$STORAGE_ACCOUNT_NAME" \
    --query exists \
    --output tsv 2>/dev/null || echo "false")

if [ "$TABLE_EXISTS" = "true" ]; then
    echo -e "${GREEN}✓ OtpCodes table already exists${NC}"
    exit 0
fi

# Create the table
echo "Creating OtpCodes table..."
az storage table create \
    --name OtpCodes \
    --account-name "$STORAGE_ACCOUNT_NAME" \
    --output none

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ OtpCodes table created successfully${NC}"
else
    echo -e "${RED}✗ Failed to create OtpCodes table${NC}"
    exit 1
fi

# Verify table was created
echo "Verifying table creation..."
TABLE_EXISTS=$(az storage table exists \
    --name OtpCodes \
    --account-name "$STORAGE_ACCOUNT_NAME" \
    --query exists \
    --output tsv)

if [ "$TABLE_EXISTS" = "true" ]; then
    echo -e "${GREEN}✓ Verification successful - OtpCodes table is ready${NC}"
else
    echo -e "${RED}✗ Verification failed - table may not have been created${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}Done! The OTP authentication system can now store OTP codes.${NC}"
