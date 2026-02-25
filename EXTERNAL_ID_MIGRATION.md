# Microsoft Entra External ID Migration

This project includes `switch-to-external-id.sh` to move authentication to **Microsoft Entra External ID (external tenant)** using **local accounts**.

This flow is for **email/password sign-up + sign-in only**.

## 1) Prepare required values

Collect values from your External ID tenant/app registration:

- `EXTERNAL_ID_ISSUER` (must exactly match the discovery `issuer` value; commonly `https://<tenant-id>.ciamlogin.com/<tenant-id>/v2.0`)
- `AAD_CLIENT_ID`
- `AAD_CLIENT_SECRET`
- `TENANT_ID`

Create credentials file:

```bash
cp .external-id-credentials.template .external-id-credentials
chmod +x ./switch-to-external-id.sh
```

Edit `.external-id-credentials` and fill all values.

Important:

- `.external-id-credentials` is mandatory.
- Script no longer falls back to current SWA/CLI tenant values.
- `TENANT_ID` must match tenant segment in `EXTERNAL_ID_ISSUER`.
- `EXTERNAL_ID_ISSUER` must exactly match the OpenID discovery `issuer` value.

## Manual-only steps (required)

Some External ID steps remain portal/manual and are not fully automated by this script:

1. Add your app registration to the target user flow (**User flows** → flow → **Applications** → **Add application**).
2. Confirm your user flow identity providers are Email Accounts only (Email+password or Email OTP as desired).

The script can validate and auto-fix app registration settings (when Azure CLI is logged into `TENANT_ID`), but it can't assign applications to user flows.

## 2) Configure user flow for local accounts only (portal)

In Microsoft Entra admin center (External tenant):

1. Go to **External Identities** → **User flows** → your sign-up/sign-in flow.
2. Under **Identity providers**, choose only **Email Accounts**:
	- **Email with password** (recommended), or
	- **Email one-time passcode**.
3. Do **not** add Google/Facebook/Apple/Custom OIDC providers.
4. Add your app to this user flow.

## 3) Run migration script

```bash
./switch-to-external-id.sh
```

The script now:

- Runs preflight checks for B2C/External ID:
	- issuer metadata consistency check
	- app registration existence check (when CLI tenant matches `TENANT_ID`)
	- auto-fix for missing callback URI
	- auto-fix for ID/access token issuance flags
- Validates `EXTERNAL_ID_ISSUER` uses `ciamlogin.com` and ends with `/v2.0`
- Requires explicit `TENANT_ID`, `AAD_CLIENT_ID`, `AAD_CLIENT_SECRET` from `.external-id-credentials`
- Enforces issuer tenant ID == `TENANT_ID`
- Updates SWA auth settings (`AAD_CLIENT_ID`, `AAD_CLIENT_SECRET`, `TENANT_ID`)
- Updates `openIdIssuer` in `frontend/staticwebapp.config.json`
- Builds and deploys frontend

## 4) Validate login

Open these URLs in order:

1. `https://wonderful-tree-08b1a860f.1.azurestaticapps.net/.auth/logout`
2. `https://wonderful-tree-08b1a860f.1.azurestaticapps.net/.auth/login/aad`
3. `https://wonderful-tree-08b1a860f.1.azurestaticapps.net/.auth/me`

`/.auth/me` should return a `clientPrincipal` after successful sign-in.

## Troubleshooting

- `AADSTS700054: response_type 'id_token' is not enabled`
	- Enable **ID tokens** (and access tokens) in app registration authentication settings.
- `AADSTS50020` with external users
	- Ensure the app registration is from the External tenant and added to the user flow.
	- Ensure you are not using `b2c-extensions-app` for sign-in.
- Login works but `/api/*` returns 401 missing auth header
	- Verify frontend is deployed with latest `frontend/src/utils/authHeaders.ts` and then retry in private/incognito mode.
