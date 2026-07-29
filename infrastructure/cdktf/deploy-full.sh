#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

print_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

print_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
  echo -e "${RED}[ERROR]${NC} $1" >&2
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    print_error "Required command not found: $1"
    exit 1
  fi
}

load_env_file() {
  local env_file="$1"
  python - "$env_file" <<'PY'
import sys

env_path = sys.argv[1]

with open(env_path, "r", encoding="utf-8") as handle:
    for raw_line in handle:
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        print(f"{key}={value}", end="\0")
PY
}

usage() {
  cat <<'EOF'
Usage: ./deploy-full.sh <dev|staging|prod>

Runs the full deployment flow for a CDKTF environment:
1. loads .env.<env>
2. creates/verifies the resource group and Static Web App prerequisite
3. synthesizes/imports/deploys the CDKTF stack
4. normalizes Function App auth settings after SWA backend linking
5. builds and publishes the backend Function App
6. builds and deploys the frontend to the SWA production environment
7. creates Foundry agents and updates Function App agent settings
8. verifies the live SWA and /api/auth/me endpoint
EOF
}

if [ $# -ne 1 ]; then
  usage
  exit 1
fi

ENVIRONMENT="$1"
case "$ENVIRONMENT" in
  dev|staging|prod) ;;
  *)
    print_error "Invalid environment: $ENVIRONMENT"
    usage
    exit 1
    ;;
esac

ENV_FILE="$SCRIPT_DIR/.env.$ENVIRONMENT"
if [ ! -f "$ENV_FILE" ]; then
  print_error "Environment file not found: $ENV_FILE"
  exit 1
fi

require_command az
require_command npm
require_command npx
require_command func
require_command swa
require_command terraform
require_command python
require_command curl

while IFS= read -r -d '' entry; do
  key="${entry%%=*}"
  value="${entry#*=}"
  export "$key=$value"
done < <(load_env_file "$ENV_FILE")

required_vars=(
  CDKTF_BASE_NAME
  CDKTF_LOCATION
  CDKTF_RESOURCE_GROUP_NAME
  CDKTF_STATIC_WEB_APP_NAME
  CDKTF_STATIC_WEB_APP_LINKED_BACKEND_NAME
)

for key in "${required_vars[@]}"; do
  if [ -z "${!key:-}" ]; then
    print_error "Missing required variable in $ENV_FILE: $key"
    exit 1
  fi
done

if [ "${CDKTF_DEPLOY_SIGNALR:-}" != "true" ]; then
  print_error "CDKTF_DEPLOY_SIGNALR must be true for a complete deployment"
  exit 1
fi

if [ "${CDKTF_ENABLE_STATIC_WEB_APP_BACKEND_LINK:-}" != "true" ]; then
  print_error "CDKTF_ENABLE_STATIC_WEB_APP_BACKEND_LINK must be true for a complete deployment"
  exit 1
fi

RESOURCE_GROUP_NAME="$CDKTF_RESOURCE_GROUP_NAME"
LOCATION="$CDKTF_LOCATION"
STATIC_WEB_APP_NAME="$CDKTF_STATIC_WEB_APP_NAME"
FUNCTION_APP_NAME="func-${CDKTF_BASE_NAME}-${ENVIRONMENT}"
OPENAI_NAME="openai-${CDKTF_BASE_NAME}-${ENVIRONMENT}"
PROJECT_NAME="${OPENAI_NAME}-project"
SIGNALR_NAME="signalr-${CDKTF_BASE_NAME}-${ENVIRONMENT}"
SUBSCRIPTION_ID="${ARM_SUBSCRIPTION_ID:-$(az account show --query id -o tsv)}"

purge_soft_deleted_openai_account() {
  if [ "${CDKTF_DEPLOY_AZURE_OPENAI:-}" != "true" ]; then
    return
  fi

  local deleted_count
  deleted_count="$(az cognitiveservices account list-deleted \
    --subscription "$SUBSCRIPTION_ID" \
    --query "[?name=='${OPENAI_NAME}' && location=='${LOCATION}'] | length(@)" \
    -o tsv)"

  if [ "${deleted_count:-0}" -gt 0 ]; then
    print_warn "Purging soft-deleted Azure OpenAI account: ${OPENAI_NAME}"
    az cognitiveservices account purge \
      --subscription "$SUBSCRIPTION_ID" \
      --location "$LOCATION" \
      --resource-group "$RESOURCE_GROUP_NAME" \
      --name "$OPENAI_NAME" \
      --only-show-errors \
      >/dev/null
  fi
}

ensure_prerequisites() {
  print_info "Ensuring resource group exists: $RESOURCE_GROUP_NAME"
  az group create \
    --name "$RESOURCE_GROUP_NAME" \
    --location "$LOCATION" \
    >/dev/null

  if az staticwebapp show --name "$STATIC_WEB_APP_NAME" --resource-group "$RESOURCE_GROUP_NAME" >/dev/null 2>&1; then
    print_info "Static Web App already exists: $STATIC_WEB_APP_NAME"
  else
    print_info "Creating Static Web App prerequisite: $STATIC_WEB_APP_NAME"
    az staticwebapp create \
      --name "$STATIC_WEB_APP_NAME" \
      --resource-group "$RESOURCE_GROUP_NAME" \
      --location "$LOCATION" \
      --sku Standard \
      >/dev/null
  fi

  CURRENT_SWA_SKU="$(az staticwebapp show --name "$STATIC_WEB_APP_NAME" --resource-group "$RESOURCE_GROUP_NAME" --query 'sku.name' -o tsv)"
  if [ "$CURRENT_SWA_SKU" != "Standard" ]; then
    print_info "Upgrading Static Web App to Standard SKU"
    az staticwebapp update \
      --name "$STATIC_WEB_APP_NAME" \
      --resource-group "$RESOURCE_GROUP_NAME" \
      --sku Standard \
      >/dev/null
  fi
}

prepare_cdktf() {
  print_info "Installing CDKTF dependencies if needed"
  cd "$SCRIPT_DIR"
  [ -d node_modules ] || npm install

  print_info "Synthesizing stack: $ENVIRONMENT"
  npx cdktf synth "$ENVIRONMENT" >/dev/null

  local stack_dir="$SCRIPT_DIR/cdktf.out/stacks/$ENVIRONMENT"
  cd "$stack_dir"
  terraform init -input=false >/dev/null

  if ! terraform state show azurerm_resource_group.resource-group >/dev/null 2>&1; then
    print_info "Importing pre-existing resource group into Terraform state"
    terraform import \
      azurerm_resource_group.resource-group \
      "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP_NAME}" \
      >/dev/null
  fi

  cd "$SCRIPT_DIR"
}

deploy_cdktf() {
  print_info "Deploying CDKTF stack: $ENVIRONMENT"
  cd "$SCRIPT_DIR"
  npx cdktf deploy "$ENVIRONMENT" --auto-approve
}

normalize_function_app_auth() {
  print_info "Normalizing Function App auth settings to match working environments"

  local url="https://management.azure.com/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP_NAME}/providers/Microsoft.Web/sites/${FUNCTION_APP_NAME}/config/authsettingsV2?api-version=2023-12-01"
  local before_file payload_file
  before_file="$(mktemp)"
  payload_file="$(mktemp)"

  az rest --method get --url "$url" > "$before_file"

  python - "$before_file" "$payload_file" <<'PY'
import json
import sys

source_path, output_path = sys.argv[1], sys.argv[2]
obj = json.load(open(source_path))
props = obj["properties"]
runtime_version = props.get("platform", {}).get("runtimeVersion", "~1")
props["platform"] = {
    "enabled": False,
    "runtimeVersion": runtime_version,
}
props["globalValidation"] = {
    "requireAuthentication": False,
    "unauthenticatedClientAction": "AllowAnonymous",
}
props["identityProviders"] = {}

payload = {
    "location": obj["location"],
    "properties": props,
    "tags": obj.get("tags", {}),
}

with open(output_path, "w") as handle:
    json.dump(payload, handle)
PY

  az rest --method put --url "$url" --body "@${payload_file}" >/dev/null
  rm -f "$before_file" "$payload_file"
}

publish_backend() {
  print_info "Building backend"
  cd "$REPO_ROOT/backend"
  [ -d node_modules ] || npm install
  npm run build

  print_info "Publishing backend to $FUNCTION_APP_NAME"
  func azure functionapp publish "$FUNCTION_APP_NAME" --typescript

  local function_count=0
  for _ in 1 2 3 4 5; do
    function_count="$(az functionapp function list --name "$FUNCTION_APP_NAME" --resource-group "$RESOURCE_GROUP_NAME" --query 'length(@)' -o tsv 2>/dev/null || echo 0)"
    if [ "${function_count:-0}" -gt 0 ]; then
      break
    fi
    sleep 10
  done

  if [ "${function_count:-0}" -le 0 ]; then
    print_error "Function App published but Azure did not index any functions"
    exit 1
  fi

  print_info "Azure indexed $function_count functions"
}

deploy_frontend() {
  print_info "Building frontend"
  cd "$REPO_ROOT/frontend"
  [ -d node_modules ] || npm install

  NEXT_PUBLIC_API_URL=/api \
  NEXT_PUBLIC_ENVIRONMENT="$ENVIRONMENT" \
  NEXT_PUBLIC_BUILD_ENV="$ENVIRONMENT" \
  NEXT_PUBLIC_BUILD_TIME="$(date -u +"%Y-%m-%d %H:%M:%S UTC")" \
  npm run build

  cp staticwebapp.config.json out/

  local deployment_token
  deployment_token="$(az staticwebapp secrets list --name "$STATIC_WEB_APP_NAME" --resource-group "$RESOURCE_GROUP_NAME" --query 'properties.apiKey' -o tsv)"

  print_info "Deploying frontend to Static Web App production environment"
  swa deploy ./out --deployment-token="$deployment_token" --env production
}

create_agents() {
  print_info "Creating Foundry agents and updating Function App settings"
  cd "$REPO_ROOT"
  [ -d node_modules ] || npm install
  rm -f .agent-config.env
  printf 'y\n' | npx tsx create-agents.ts "$RESOURCE_GROUP_NAME" "$OPENAI_NAME" "$PROJECT_NAME"

  if [ ! -f "$REPO_ROOT/.agent-config.env" ]; then
    print_error "Agent creation completed without generating .agent-config.env"
    exit 1
  fi
}

verify_agent_settings() {
  local settings_count
  settings_count="$(az functionapp config appsettings list \
    --name "$FUNCTION_APP_NAME" \
    --resource-group "$RESOURCE_GROUP_NAME" \
    --query "[?starts_with(name, 'AZURE_AI_')].name | length(@)" \
    -o tsv)"

  if [ "${settings_count:-0}" -lt 7 ]; then
    print_error "Expected AI agent app settings were not fully applied"
    exit 1
  fi
}

verify_live_app() {
  print_info "Verifying live SWA and backend link"

  local swa_host homepage_status auth_me_status
  swa_host="$(az staticwebapp show --name "$STATIC_WEB_APP_NAME" --resource-group "$RESOURCE_GROUP_NAME" --query 'defaultHostname' -o tsv)"

  homepage_status=0
  auth_me_status=0

  for _ in 1 2 3 4 5 6; do
    homepage_status="$(curl -s -o /dev/null -w '%{http_code}' "https://${swa_host}" || true)"
    auth_me_status="$(curl -s -o /dev/null -w '%{http_code}' "https://${swa_host}/api/auth/me" || true)"
    if [ "$homepage_status" = "200" ] && [ "$auth_me_status" = "200" ]; then
      break
    fi
    sleep 10
  done

  if [ "$homepage_status" != "200" ]; then
    print_error "Static Web App homepage check failed with HTTP $homepage_status"
    exit 1
  fi

  if [ "$auth_me_status" != "200" ]; then
    print_error "Static Web App /api/auth/me check failed with HTTP $auth_me_status"
    exit 1
  fi

  print_info "Live app verified"
  echo "SWA_URL=https://${swa_host}"
  echo "FUNCTION_APP_NAME=${FUNCTION_APP_NAME}"
  echo "STATIC_WEB_APP_NAME=${STATIC_WEB_APP_NAME}"
  echo "SIGNALR_NAME=${SIGNALR_NAME}"
  echo "OPENAI_NAME=${OPENAI_NAME}"
}

main() {
  print_info "Starting full CDKTF deployment for ${ENVIRONMENT}"
  purge_soft_deleted_openai_account
  ensure_prerequisites
  prepare_cdktf
  deploy_cdktf
  normalize_function_app_auth
  publish_backend
  deploy_frontend
  create_agents
  verify_agent_settings
  verify_live_app
  print_info "Full deployment completed successfully for ${ENVIRONMENT}"
}

main
