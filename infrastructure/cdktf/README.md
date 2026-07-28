# ProvePresent CDKTF Infrastructure

This directory contains a **parallel CDK for Terraform (CDKTF)** implementation of the Azure infrastructure used by ProvePresent.

It is intentionally additive:
- **Existing Bicep templates stay unchanged**
- **Existing deployment scripts stay unchanged**
- this CDKTF version is a new deployment path for infrastructure only

## Scope

The CDKTF stack provisions the same core Azure resources currently managed by Bicep:
- Resource group
- Storage account, tables, blob containers, and blob CORS
- SignalR Service (**required**)
- Log Analytics + Application Insights
- Linux Function App with app settings and managed identity
- Azure AI account, Foundry project, and GPT-5.4 deployment via ARM template deployments
- RBAC role assignments for storage, SignalR, and Azure AI
- Static Web App linked backend (**required**)
- Optional Foundry tracing connection to Application Insights

It does **not** replace the CLI-only application deployment steps yet:
- `func azure functionapp publish`
- `swa deploy`
- agent creation

This directory now also includes a **one-command orchestration script** that runs those remaining steps for a full environment deployment.

## Layout

```text
infrastructure/cdktf/
├── cdktf.json
├── package.json
├── tsconfig.json
└── src/
    ├── config.ts
    ├── main.ts
    └── prove-present-stack.ts
```

## Install

```bash
cd infrastructure/cdktf
npm install
cp .env.dev.example .env.dev
cp .env.staging.example .env.staging
cp .env.prod.example .env.prod
# edit each file so the environment is fully self-contained
```

## Synthesize

```bash
npm run synth:dev
npm run synth:staging
npm run synth:prod
```

## Deploy

Terraform variables are used for secrets and environment-specific overrides.

```bash
cd infrastructure/cdktf
cdktf deploy dev
cdktf deploy staging
cdktf deploy prod
```

## Full deployment script

For a complete end-to-end deployment, use the orchestration script instead of running the phases manually:

```bash
cd infrastructure/cdktf
./deploy-full.sh dev
./deploy-full.sh staging
./deploy-full.sh prod
```

Equivalent npm entrypoints:

```bash
npm run full-deploy:dev
npm run full-deploy:staging
npm run full-deploy:prod
```

The script performs the real working deployment flow:

1. loads `.env.<env>`
2. creates or verifies the resource group and Static Web App prerequisite
3. synthesizes the stack, imports the pre-existing resource group into Terraform state when needed, and runs `cdktf deploy`
4. normalizes Function App auth settings after SWA backend linking
5. builds and publishes the backend Function App
6. builds and deploys the frontend with `swa deploy --env production`
7. runs `create-agents.ts` and applies the required Foundry agent settings
8. verifies the live SWA root and `/api/auth/me`

It assumes the environment file has:

- `CDKTF_DEPLOY_SIGNALR=true`
- `CDKTF_ENABLE_STATIC_WEB_APP_BACKEND_LINK=true`
- explicit `CDKTF_STATIC_WEB_APP_NAME`
- explicit `CDKTF_STATIC_WEB_APP_LINKED_BACKEND_NAME`

## Actual deployment process

The real deployment flow is still **multi-phase**, even though infrastructure moved into CDKTF.

1. **Prepare environment config**
   - Fill `infrastructure/cdktf/.env.<env>`
   - Each file is self-contained for that environment

2. **Create prerequisite Static Web App**
   - CDKTF does **not** create the SWA resource itself
   - The SWA must already exist with the exact name from `CDKTF_STATIC_WEB_APP_NAME`
   - It must be in `CDKTF_RESOURCE_GROUP_NAME`

3. **Apply CDKTF infrastructure**
   - Run `cdktf deploy <env>`
   - If the resource group was pre-created outside Terraform, import it first:

   ```bash
   cd infrastructure/cdktf/cdktf.out/stacks/staging
   terraform import azurerm_resource_group.resource-group /subscriptions/<subscription-id>/resourceGroups/rg-qr-attendance-staging
   ```

4. **Publish backend code**
   - Build backend
   - Publish Function App

5. **Deploy frontend content**
   - Build frontend
   - Deploy to SWA with `--env production`

6. **Create Foundry agents**
   - Run `create-agents.ts`
   - Let it update Function App app settings

7. **Verify live app**
   - SWA root returns `200`
   - SWA `/api/auth/me` returns `200`
   - required AI-backed endpoints work

## Staging runbook

This is the exact working order used for staging:

```bash
# 1. Pre-create staging SWA prerequisite
az group create --name rg-qr-attendance-staging --location eastus2
az staticwebapp create \
  --name swa-qrattendance-staging \
  --resource-group rg-qr-attendance-staging \
  --location eastus2 \
  --sku Standard

# 2. Deploy CDKTF infrastructure
cd infrastructure/cdktf
npm install
npx cdktf deploy staging --auto-approve

# 3. If the RG already existed before deploy, import it and rerun
cd cdktf.out/stacks/staging
terraform import azurerm_resource_group.resource-group /subscriptions/<subscription-id>/resourceGroups/rg-qr-attendance-staging
cd ../../..
npx cdktf deploy staging --auto-approve

# 4. Publish backend
cd ../../backend
npm run build
func azure functionapp publish func-qrattendance-staging --typescript

# 5. Deploy frontend to the real SWA hostname
cd ../frontend
NEXT_PUBLIC_API_URL=/api NEXT_PUBLIC_ENVIRONMENT=staging npm run build
cp staticwebapp.config.json out/
DEPLOYMENT_TOKEN=$(az staticwebapp secrets list --name swa-qrattendance-staging --resource-group rg-qr-attendance-staging --query 'properties.apiKey' -o tsv)
swa deploy ./out --deployment-token="$DEPLOYMENT_TOKEN" --env production

# 6. Create Foundry agents and update Function App settings
cd ..
npm install
printf 'y\n' | npx tsx create-agents.ts rg-qr-attendance-staging openai-qrattendance-staging openai-qrattendance-staging-project
```

## App deployment after infra apply

After the infrastructure stack is applied, application code still needs to be deployed separately.

### Backend publish

Build the backend first, then publish the Function App:

```bash
cd backend
npm run build
func azure functionapp publish func-qrattendance-staging --typescript
```

For this repo, the explicit `npm run build` matters. Publishing without a fresh compiled `dist/` can upload a package that contains source files but no compiled function entrypoints, which leaves the Function App running with zero indexed functions.

After publish, confirm Azure indexed real functions. If the output shows an empty function list, the deployed package is incomplete and the app will serve the default Function App page but not real API routes.

### Frontend deploy

Deploy the built frontend to the Static Web App **production** environment:

```bash
cd frontend
NEXT_PUBLIC_API_URL=/api NEXT_PUBLIC_ENVIRONMENT=staging npm run build
cp staticwebapp.config.json out/
DEPLOYMENT_TOKEN=$(az staticwebapp secrets list --name swa-qrattendance-staging --resource-group rg-qr-attendance-staging --query 'properties.apiKey' -o tsv)
swa deploy ./out --deployment-token="$DEPLOYMENT_TOKEN" --env production
```

Use `--env production` for the real default SWA hostname. The SWA CLI defaults to `preview`, which deploys to a preview hostname instead of the main environment.

### Foundry agent creation

CDKTF creates the Foundry account and project, but it does **not** create the persistent agents used by the app. Run the repo's agent-creation script after infra deploy:

```bash
cd /path/to/ProvePresent
npm install
printf 'y\n' | npx tsx create-agents.ts <resource-group> <openai-resource-name> <project-name>
```

For staging, the complete deployment required these four agents:

1. `QuizQuestionGenerator`
2. `SlideAnalysisAgent`
3. `PositionEstimationAgent`
4. `ImageAnalysisAgent`

Without them, AI-backed features return runtime errors even though the infrastructure and app code are deployed.

## Critical safety notes

1. Each environment is fully self-contained in its own file: `.env.dev`, `.env.staging`, or `.env.prod`.
2. There is no shared runtime config file. Auth, naming, location, tags, feature toggles, and app settings all come from the selected environment file.
3. This stack does **not** create the Static Web App itself and does **not** upload SWA content.
4. SignalR is a **must-have** for full system behavior, especially real-time and capture flows. Do not disable `CDKTF_DEPLOY_SIGNALR`.
5. Static Web App backend linking is a **must-have** for the current frontend because it defaults to same-origin `/api` calls. Do not disable `CDKTF_ENABLE_STATIC_WEB_APP_BACKEND_LINK`.
6. `CDKTF_STATIC_WEB_APP_NAME` must be the **exact existing** Static Web App name. CDKTF will fail fast if it is missing.
7. The backend-link ARM deployment runs in `CDKTF_RESOURCE_GROUP_NAME`, so the referenced Static Web App must already exist in that same resource group.
8. The riskiest naming issue is Static Web App naming because Azure may append a random suffix. Do not assume `swa-${baseName}-${environment}` is correct for an existing app.

## Resource naming

The CDKTF stack uses these naming rules:

| Resource | Naming rule |
|---|---|
| Resource Group | `CDKTF_RESOURCE_GROUP_NAME` |
| Storage Account | `st${baseName}${environment}` sanitized to lowercase alphanumeric, max 24 chars |
| SignalR Service | `signalr-${baseName}-${environment}` |
| App Service Plan | `asp-${baseName}-${environment}` |
| Function App | `func-${baseName}-${environment}` |
| Application Insights | `appi-${baseName}-${environment}` |
| Log Analytics Workspace | `${appiName}-workspace` |
| Azure OpenAI / Foundry account | `openai-${baseName}-${environment}` |
| Foundry Project | `${openAiName}-project` |
| GPT deployment | `gpt-5.4` |
| Foundry tracing connection | `appinsights-tracing` |
| Static Web App name used for backend link | `CDKTF_STATIC_WEB_APP_NAME` |
| Static Web App linked backend name | `CDKTF_STATIC_WEB_APP_LINKED_BACKEND_NAME` |
| ARM deployment record: OpenAI | `openai-${environment}` |
| ARM deployment record: tracing | `foundry-tracing-${environment}` |
| ARM deployment record: SWA link | `static-web-app-link-${environment}` |

Current configured Static Web App names:

| Environment | `CDKTF_RESOURCE_GROUP_NAME` | `CDKTF_STATIC_WEB_APP_NAME` | `CDKTF_ENABLE_STATIC_WEB_APP_BACKEND_LINK` |
|---|---|---|---|
| dev | `rg-qr-attendance-dev` | `swa-qrattendance-dev` | `true` |
| staging | `rg-qr-attendance-staging` | `swa-qrattendance-staging` | `true` |
| prod | `rg-qr-attendance-prod` | `swa-qrattendance-prod-1770905786` | `true` |

Current SignalR deployment flags:

| Environment | `CDKTF_DEPLOY_SIGNALR` | SignalR name |
|---|---|---|
| dev | `true` | `signalr-qrattendance-dev` |
| staging | `true` | `signalr-qrattendance-staging` |
| prod | `true` | `signalr-qrattendance-prod` |

Current staging synthesized behavior:

| Area | Current staging result |
|---|---|
| SignalR | enabled, creates `signalr-qrattendance-staging` |
| Function app SignalR setting | `SIGNALR_CONNECTION_STRING` wired from the staging SignalR resource |
| Static Web App backend link | enabled, uses `swa-qrattendance-staging` with linked backend name `function-staging` |

## What CDKTF manages vs what it does not

| Area | Managed by CDKTF? | Notes |
|---|---|---|
| Resource group | yes | Import required if pre-created outside Terraform |
| Storage / tables / containers | yes | |
| Function App resource + settings | yes | App code publish is separate |
| SignalR resource | yes | Required |
| App Insights / Log Analytics | yes | |
| OpenAI / Foundry account + project | yes | via ARM template deployments |
| SWA backend link | yes | SWA resource itself must already exist |
| Function code package | no | `func azure functionapp publish` |
| SWA static content | no | `swa deploy --env production` |
| Persistent Foundry agents | no | `create-agents.ts` |

## Undeploy / teardown

For a **self-contained environment** like the current staging setup, the practical undeploy is usually:

```bash
az group delete --name rg-qr-attendance-staging --yes --no-wait
```

That removes the whole resource group and therefore also removes:

- Function App
- SignalR
- Storage account, tables, and containers
- Application Insights / Log Analytics
- OpenAI / Foundry account and project
- Static Web App **if it was created in the same resource group**
- SWA backend link
- agent resources stored under the deleted Foundry project/account

### When deleting the resource group is safe

Deleting the whole resource group is the simplest teardown **only if**:

1. the environment is truly self-contained
2. the Static Web App is in that same resource group
3. there are no manually added shared resources inside that group

For the current staging deployment, that condition is true:

| Environment | Resource group | Safe to delete RG for full teardown? |
|---|---|---|
| staging | `rg-qr-attendance-staging` | yes |

### What deleting the resource group does not clean up

Deleting the Azure resource group does **not** remove local deployment artifacts such as:

- `infrastructure/cdktf/cdktf.out/`
- local Terraform state under `infrastructure/cdktf/cdktf.out/stacks/<env>/`
- `.agent-config.env`
- local `.env.<env>` files

If you want to clear local deployment state too, remove those files manually after Azure deletion.

## Notes

1. The stacks are synthesized as separate environments: `dev`, `staging`, and `prod`.
2. Static Web App **resource creation and content upload** are still outside this CDKTF stack. Only the backend link can be created here, and the current config expects backend linking to be enabled for every environment.
3. Foundry agent creation is still outside this stack. The tracing connection is now managed here, but agent creation remains a post-deploy SDK or CLI step.
4. A complete deployment is not just `cdktf deploy`. The working process is: prereq SWA → CDKTF infra → backend publish → frontend deploy → agent creation.
