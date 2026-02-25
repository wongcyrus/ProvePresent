#!/bin/bash

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
CONFIG_FILE="$FRONTEND_DIR/staticwebapp.config.json"
DEPLOY_INFO_FILE="$ROOT_DIR/deployment-info.json"
CREDS_FILE="$ROOT_DIR/.external-id-credentials"
FRONTEND_URL=$(jq -r '.urls.frontend // "https://wonderful-tree-08b1a860f.1.azurestaticapps.net"' "$DEPLOY_INFO_FILE" 2>/dev/null || echo "https://wonderful-tree-08b1a860f.1.azurestaticapps.net")

echo -e "${BLUE}=========================================="
echo "Switch to Microsoft Entra External ID"
echo -e "==========================================${NC}"
echo ""

if ! command -v jq >/dev/null 2>&1; then
  echo -e "${RED}✗ jq is required${NC}"
  exit 1
fi

if ! command -v az >/dev/null 2>&1; then
  echo -e "${RED}✗ Azure CLI is required${NC}"
  exit 1
fi

if ! command -v swa >/dev/null 2>&1; then
  echo -e "${RED}✗ Static Web Apps CLI is required (swa)${NC}"
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo -e "${RED}✗ curl is required${NC}"
  exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
  echo -e "${RED}✗ Missing config file: $CONFIG_FILE${NC}"
  exit 1
fi

if [ ! -f "$DEPLOY_INFO_FILE" ]; then
  echo -e "${RED}✗ Missing deployment info: $DEPLOY_INFO_FILE${NC}"
  exit 1
fi

if [ -f "$CREDS_FILE" ]; then
  echo -e "${GREEN}✓ Loading credentials from .external-id-credentials${NC}"
  # shellcheck disable=SC1090
  source "$CREDS_FILE"
else
  echo -e "${RED}✗ .external-id-credentials is required for new External tenant migration${NC}"
  echo "  Create it from .external-id-credentials.template and provide External tenant values."
  exit 1
fi

SWA_NAME=$(jq -r '.azure.staticWebApp // empty' "$DEPLOY_INFO_FILE")
RESOURCE_GROUP=$(jq -r '.azure.resourceGroup // empty' "$DEPLOY_INFO_FILE")

if [ -z "$SWA_NAME" ] || [ -z "$RESOURCE_GROUP" ]; then
  echo -e "${RED}✗ Unable to resolve static web app/resource group from deployment-info.json${NC}"
  exit 1
fi

CURRENT_SETTINGS=$(az staticwebapp appsettings list --name "$SWA_NAME" --resource-group "$RESOURCE_GROUP" --query 'properties.{AAD_CLIENT_ID:AAD_CLIENT_ID,TENANT_ID:TENANT_ID}' -o json 2>/dev/null || echo '{}')
CURRENT_AAD_CLIENT_ID=$(echo "$CURRENT_SETTINGS" | jq -r '.AAD_CLIENT_ID // empty')
CURRENT_TENANT_ID=$(echo "$CURRENT_SETTINGS" | jq -r '.TENANT_ID // empty')

if [ -z "${EXTERNAL_ID_ISSUER:-}" ] || [ "$EXTERNAL_ID_ISSUER" = "null" ]; then
  echo -e "${RED}✗ EXTERNAL_ID_ISSUER is required${NC}"
  echo "  Expected format: https://<tenant-subdomain>.ciamlogin.com/<tenant-id>/v2.0"
  exit 1
fi

if [[ "$EXTERNAL_ID_ISSUER" != *"ciamlogin.com"* ]]; then
  echo -e "${RED}✗ EXTERNAL_ID_ISSUER must use ciamlogin.com for External ID local accounts${NC}"
  echo "  Current value: $EXTERNAL_ID_ISSUER"
  exit 1
fi

if [[ "$EXTERNAL_ID_ISSUER" != */v2.0 ]]; then
  echo -e "${RED}✗ EXTERNAL_ID_ISSUER must end with /v2.0${NC}"
  echo "  Current value: $EXTERNAL_ID_ISSUER"
  exit 1
fi

if [ -z "${TENANT_ID:-}" ] || [ "$TENANT_ID" = "null" ] || [ -z "${AAD_CLIENT_ID:-}" ] || [ "$AAD_CLIENT_ID" = "null" ] || [ -z "${AAD_CLIENT_SECRET:-}" ] || [ "$AAD_CLIENT_SECRET" = "null" ]; then
  echo -e "${RED}✗ Missing required values in .external-id-credentials (TENANT_ID, AAD_CLIENT_ID, AAD_CLIENT_SECRET)${NC}"
  exit 1
fi

ISSUER_TENANT_ID=$(echo "$EXTERNAL_ID_ISSUER" | sed -E 's#https://[^/]+/([^/]+)/v2.0#\1#')
if [ -z "$ISSUER_TENANT_ID" ] || [ "$ISSUER_TENANT_ID" = "$EXTERNAL_ID_ISSUER" ]; then
  echo -e "${RED}✗ Unable to parse tenant id from EXTERNAL_ID_ISSUER${NC}"
  exit 1
fi

if [ "$ISSUER_TENANT_ID" != "$TENANT_ID" ]; then
  echo -e "${RED}✗ TENANT_ID does not match EXTERNAL_ID_ISSUER${NC}"
  echo "  TENANT_ID=$TENANT_ID"
  echo "  Issuer tenant=$ISSUER_TENANT_ID"
  exit 1
fi

echo -e "${BLUE}Step 0: Preflight checks (B2C/External ID)${NC}"
ACTIVE_TENANT_ID=$(az account show --query tenantId -o tsv 2>/dev/null || true)
if [ -z "$ACTIVE_TENANT_ID" ]; then
  echo -e "${RED}✗ Unable to determine active Azure CLI tenant${NC}"
  exit 1
fi

if [ "$ACTIVE_TENANT_ID" = "$TENANT_ID" ]; then
  echo -e "${GREEN}✓ Azure CLI is in target External tenant${NC}"

  if ! APP_INFO=$(az ad app show --id "$AAD_CLIENT_ID" --query '{displayName:displayName,redirectUris:web.redirectUris,idToken:web.implicitGrantSettings.enableIdTokenIssuance,accessToken:web.implicitGrantSettings.enableAccessTokenIssuance}' -o json 2>/dev/null); then
    echo -e "${RED}✗ AAD_CLIENT_ID not found in current External tenant: $AAD_CLIENT_ID${NC}"
    echo "  Use your customer app registration (not b2c-extensions-app)."
    exit 1
  fi

  APP_NAME=$(echo "$APP_INFO" | jq -r '.displayName // ""')
  if [[ "$APP_NAME" == b2c-extensions-app* ]]; then
    echo -e "${RED}✗ AAD_CLIENT_ID points to b2c-extensions-app and cannot be used for website sign-in${NC}"
    exit 1
  fi

  REQUIRED_REDIRECT="$FRONTEND_URL/.auth/login/aad/callback"
  REDIRECT_EXISTS=$(echo "$APP_INFO" | jq -r --arg uri "$REQUIRED_REDIRECT" '(.redirectUris // []) | index($uri) != null')
  if [ "$REDIRECT_EXISTS" != "true" ]; then
    echo -e "${YELLOW}⚠ Missing required redirect URI. Auto-updating app registration...${NC}"
    mapfile -t existing_uris < <(echo "$APP_INFO" | jq -r '.redirectUris[]?' )
    existing_uris+=("$REQUIRED_REDIRECT")
    az ad app update --id "$AAD_CLIENT_ID" --web-redirect-uris "${existing_uris[@]}" >/dev/null
    echo -e "${GREEN}✓ Added redirect URI: $REQUIRED_REDIRECT${NC}"
  else
    echo -e "${GREEN}✓ Redirect URI configured${NC}"
  fi

  ID_TOKEN_ENABLED=$(echo "$APP_INFO" | jq -r '.idToken // false')
  ACCESS_TOKEN_ENABLED=$(echo "$APP_INFO" | jq -r '.accessToken // false')
  if [ "$ID_TOKEN_ENABLED" != "true" ] || [ "$ACCESS_TOKEN_ENABLED" != "true" ]; then
    echo -e "${YELLOW}⚠ ID/access token issuance not enabled. Auto-updating app registration...${NC}"
    az ad app update --id "$AAD_CLIENT_ID" --enable-id-token-issuance true --enable-access-token-issuance true >/dev/null
    echo -e "${GREEN}✓ Enabled ID token and access token issuance${NC}"
  else
    echo -e "${GREEN}✓ ID/access token issuance already enabled${NC}"
  fi
else
  echo -e "${YELLOW}⚠ Azure CLI tenant ($ACTIVE_TENANT_ID) differs from TENANT_ID ($TENANT_ID).${NC}"
  echo "  Skipping app-registration validation/autofix."
  echo "  To run full checks, execute: az login --tenant $TENANT_ID --allow-no-subscriptions"
fi

DISCOVERY_DOC="$EXTERNAL_ID_ISSUER/.well-known/openid-configuration"
DISCOVERY_ISSUER=$(curl -fsSL "$DISCOVERY_DOC" | jq -r '.issuer // empty' || true)
if [ -z "$DISCOVERY_ISSUER" ]; then
  echo -e "${RED}✗ Unable to read issuer from discovery document: $DISCOVERY_DOC${NC}"
  exit 1
fi
if [ "$DISCOVERY_ISSUER" != "$EXTERNAL_ID_ISSUER" ]; then
  echo -e "${RED}✗ EXTERNAL_ID_ISSUER must exactly match discovery issuer${NC}"
  echo "  Provided:  $EXTERNAL_ID_ISSUER"
  echo "  Discovery: $DISCOVERY_ISSUER"
  exit 1
fi
echo -e "${GREEN}✓ Issuer matches discovery metadata${NC}"
echo ""

if [ -n "$CURRENT_TENANT_ID" ] && [ "$CURRENT_TENANT_ID" != "null" ] && [ "$CURRENT_TENANT_ID" = "$TENANT_ID" ]; then
  echo -e "${YELLOW}⚠ Target TENANT_ID matches current SWA TENANT_ID ($CURRENT_TENANT_ID).${NC}"
  echo "  Continue only if this tenant is your new External tenant."
fi

echo "Target Static Web App: $SWA_NAME"
echo "Resource Group: $RESOURCE_GROUP"
echo "Issuer: $EXTERNAL_ID_ISSUER"
echo ""

echo -e "${BLUE}External ID local-account requirements${NC}"
echo "  - MANUAL (portal): Add your app to User flow > Applications (not automatable by this script)."
echo "  - In External Identities > User flows, select only Email Accounts (Email with password or Email OTP)."
echo "  - Do not add Google/Facebook/Apple/OIDC providers for this app user flow."
echo "  - Keep login route as /.auth/login/aad (it uses your External ID issuer)."
echo ""

echo -e "${BLUE}Step 1: Update staticwebapp.config.json issuer${NC}"
tmp_file="$(mktemp)"
jq --arg issuer "$EXTERNAL_ID_ISSUER" '.auth.identityProviders.azureActiveDirectory.registration.openIdIssuer = $issuer' "$CONFIG_FILE" > "$tmp_file"
mv "$tmp_file" "$CONFIG_FILE"
echo -e "${GREEN}✓ Updated openIdIssuer${NC}"
echo ""

echo -e "${BLUE}Step 2: Update SWA app settings${NC}"
if ! az staticwebapp show --name "$SWA_NAME" --resource-group "$RESOURCE_GROUP" --query 'name' -o tsv >/dev/null 2>&1; then
  echo -e "${RED}✗ Unable to access Static Web App in current Azure subscription context${NC}"
  echo "  Run: az account set --subscription <your-swa-subscription-id>"
  exit 1
fi

az staticwebapp appsettings set \
  --name "$SWA_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --setting-names \
    "AAD_CLIENT_ID=$AAD_CLIENT_ID" \
    "AAD_CLIENT_SECRET=$AAD_CLIENT_SECRET" \
    "TENANT_ID=$TENANT_ID" \
  --output none
echo -e "${GREEN}✓ Updated SWA app settings${NC}"
echo ""

echo -e "${BLUE}Step 3: Build and deploy frontend${NC}"
pushd "$FRONTEND_DIR" >/dev/null
npm run build
cp staticwebapp.config.json out/
TOKEN=$(az staticwebapp secrets list --name "$SWA_NAME" --resource-group "$RESOURCE_GROUP" --query 'properties.apiKey' -o tsv)
swa deploy ./out --deployment-token="$TOKEN" --env production
popd >/dev/null
echo -e "${GREEN}✓ Frontend deployed${NC}"
echo ""

echo -e "${BLUE}Step 4: Verify auth settings${NC}"
az staticwebapp appsettings list \
  --name "$SWA_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query 'properties.{AAD_CLIENT_ID:AAD_CLIENT_ID,TENANT_ID:TENANT_ID}' \
  -o json
echo ""

echo -e "${GREEN}Done.${NC}"
echo "Next test URLs:"
echo "  1) https://wonderful-tree-08b1a860f.1.azurestaticapps.net/.auth/logout"
echo "  2) https://wonderful-tree-08b1a860f.1.azurestaticapps.net/.auth/login/aad"
