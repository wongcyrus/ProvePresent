#!/bin/bash
# Deploy ProvePresent infrastructure to Azure
# Requirements: 19.1, 19.2, 19.3, 19.4, 19.5

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default values
LOCATION="eastus"
REPOSITORY_BRANCH="main"
DEPLOY_OPENAI="false"
WHAT_IF="false"

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Usage function
usage() {
    echo "Usage: $0 -e <environment> -g <resource-group> [options]"
    echo ""
    echo "Required arguments:"
    echo "  -e, --environment       Environment (dev, staging, prod)"
    echo "  -g, --resource-group    Resource group name"
    echo ""
    echo "Optional arguments:"
    echo "  -l, --location          Azure region (default: eastus)"
    echo "  -r, --repository-url    GitHub repository URL"
    echo "  -b, --branch            GitHub branch (default: main)"
    echo "  -t, --token             GitHub personal access token"
    echo "  -c, --client-id         Azure AD client ID"
    echo "  -s, --client-secret     Azure AD client secret"
    echo "  -o, --deploy-openai     Deploy Azure OpenAI (true/false, default: false)"
    echo "  -w, --what-if           Show what would be deployed without deploying"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Example:"
    echo "  $0 -e dev -g rg-qr-attendance-dev"
    echo "  $0 -e prod -g rg-qr-attendance-prod -o true"
    exit 1
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -g|--resource-group)
            RESOURCE_GROUP="$2"
            shift 2
            ;;
        -l|--location)
            LOCATION="$2"
            shift 2
            ;;
        -r|--repository-url)
            REPOSITORY_URL="$2"
            shift 2
            ;;
        -b|--branch)
            REPOSITORY_BRANCH="$2"
            shift 2
            ;;
        -t|--token)
            REPOSITORY_TOKEN="$2"
            shift 2
            ;;
        -c|--client-id)
            AAD_CLIENT_ID="$2"
            shift 2
            ;;
        -s|--client-secret)
            AAD_CLIENT_SECRET="$2"
            shift 2
            ;;
        -o|--deploy-openai)
            DEPLOY_OPENAI="$2"
            shift 2
            ;;
        -w|--what-if)
            WHAT_IF="true"
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            usage
            ;;
    esac
done

# Validate required arguments
if [ -z "$ENVIRONMENT" ] || [ -z "$RESOURCE_GROUP" ]; then
    echo -e "${RED}Error: Environment and resource group are required${NC}"
    usage
fi

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
    echo -e "${RED}Error: Environment must be dev, staging, or prod${NC}"
    exit 1
fi

# Print header
echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}ProvePresent Infrastructure Deployment${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo -e "${YELLOW}Environment:     $ENVIRONMENT${NC}"
echo -e "${YELLOW}Resource Group:  $RESOURCE_GROUP${NC}"
echo -e "${YELLOW}Location:        $LOCATION${NC}"
echo -e "${YELLOW}Deploy OpenAI:   $DEPLOY_OPENAI${NC}"
echo ""

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo -e "${RED}Error: Azure CLI is not installed${NC}"
    echo "Please install it from https://aka.ms/azure-cli"
    exit 1
fi

AZ_VERSION=$(az version --query '"azure-cli"' -o tsv)
echo -e "${GREEN}✓ Azure CLI version: $AZ_VERSION${NC}"

# Check if logged in to Azure
if ! az account show &> /dev/null; then
    echo -e "${RED}Error: Not logged in to Azure${NC}"
    echo "Please run 'az login' first"
    exit 1
fi

ACCOUNT_NAME=$(az account show --query 'user.name' -o tsv)
SUBSCRIPTION_NAME=$(az account show --query 'name' -o tsv)
SUBSCRIPTION_ID=$(az account show --query 'id' -o tsv)
echo -e "${GREEN}✓ Logged in as: $ACCOUNT_NAME${NC}"
echo -e "${GREEN}✓ Subscription: $SUBSCRIPTION_NAME ($SUBSCRIPTION_ID)${NC}"
echo ""

# Create resource group if it doesn't exist
echo -e "${CYAN}Checking resource group...${NC}"
if ! az group exists --name "$RESOURCE_GROUP" | grep -q "true"; then
    echo -e "${YELLOW}Creating resource group: $RESOURCE_GROUP${NC}"
    az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none
    echo -e "${GREEN}✓ Resource group created${NC}"
else
    echo -e "${GREEN}✓ Resource group exists${NC}"
fi
echo ""

# Prepare parameters file
PARAMETERS_FILE="$SCRIPT_DIR/parameters/$ENVIRONMENT.bicepparam"
if [ ! -f "$PARAMETERS_FILE" ]; then
    echo -e "${RED}Error: Parameters file not found: $PARAMETERS_FILE${NC}"
    exit 1
fi

echo -e "${CYAN}Using parameters file: $PARAMETERS_FILE${NC}"

# Build parameter overrides
PARAMETER_OVERRIDES=""

if [ -n "$REPOSITORY_URL" ]; then
    PARAMETER_OVERRIDES="$PARAMETER_OVERRIDES repositoryUrl='$REPOSITORY_URL'"
fi

if [ -n "$REPOSITORY_BRANCH" ]; then
    PARAMETER_OVERRIDES="$PARAMETER_OVERRIDES repositoryBranch='$REPOSITORY_BRANCH'"
fi

if [ -n "$REPOSITORY_TOKEN" ]; then
    PARAMETER_OVERRIDES="$PARAMETER_OVERRIDES repositoryToken='$REPOSITORY_TOKEN'"
fi

if [ -n "$AAD_CLIENT_ID" ]; then
    PARAMETER_OVERRIDES="$PARAMETER_OVERRIDES aadClientId='$AAD_CLIENT_ID'"
fi

if [ -n "$AAD_CLIENT_SECRET" ]; then
    PARAMETER_OVERRIDES="$PARAMETER_OVERRIDES aadClientSecret='$AAD_CLIENT_SECRET'"
fi

if [ "$DEPLOY_OPENAI" = "true" ]; then
    PARAMETER_OVERRIDES="$PARAMETER_OVERRIDES deployAzureOpenAI=true"
fi

# Deploy infrastructure
echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}Deploying Infrastructure${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

DEPLOYMENT_NAME="qr-attendance-$ENVIRONMENT-$(date +%Y%m%d-%H%M%S)"

if [ "$WHAT_IF" = "true" ]; then
    echo -e "${YELLOW}Running in WhatIf mode - no changes will be made${NC}"
    echo ""
    
    az deployment group what-if \
        --resource-group "$RESOURCE_GROUP" \
        --name "$DEPLOYMENT_NAME" \
        --parameters "$PARAMETERS_FILE" \
        ${PARAMETER_OVERRIDES:+--parameters $PARAMETER_OVERRIDES}
else
    echo -e "${YELLOW}Starting deployment: $DEPLOYMENT_NAME${NC}"
    echo -e "${YELLOW}This may take 10-15 minutes...${NC}"
    echo ""
    
    if az deployment group create \
        --resource-group "$RESOURCE_GROUP" \
        --name "$DEPLOYMENT_NAME" \
        --parameters "$PARAMETERS_FILE" \
        ${PARAMETER_OVERRIDES:+--parameters $PARAMETER_OVERRIDES} \
        --output json > /tmp/deployment-output.json; then
        
        echo ""
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}Deployment Successful!${NC}"
        echo -e "${GREEN}========================================${NC}"
        echo ""
        
        # Display outputs
        echo -e "${CYAN}Deployment Outputs:${NC}"
        echo ""
        
        # Parse and display outputs
        jq -r '.properties.outputs | to_entries[] | "  \(.key): \(.value.value)"' /tmp/deployment-output.json
        
        echo ""
        echo -e "${CYAN}Next Steps:${NC}"
        echo -e "1. Update your GitHub repository secrets with the deployment token"
        echo -e "2. Push your code to trigger the GitHub Actions workflow"
        echo -e "3. Verify the deployment at the Static Web App URL"
        echo -e "4. Run the verification script: ./scripts/verify-managed-identity.sh"
        echo ""
        
        # Clean up
        rm -f /tmp/deployment-output.json
    else
        echo ""
        echo -e "${RED}========================================${NC}"
        echo -e "${RED}Deployment Failed!${NC}"
        echo -e "${RED}========================================${NC}"
        echo ""
        exit 1
    fi
fi

echo -e "${CYAN}Deployment script completed.${NC}"
