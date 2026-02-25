# Security Audit: Authentication Flow

## Current Architecture

```
Internet User
    ↓
[Static Web App (SWA)]  ← Azure AD Auth + Authorization
    ↓
[Function App API]     ← Checks x-ms-client-principal header
    ↓
[Azure Storage]
```

## 🚨 CRITICAL SECURITY ISSUES FOUND

### Issue #1: Direct Function App Access (CRITICAL)
**Problem:** Anyone can call `https://func-qrattendance-dev.azurewebsites.net/api/sessions/{id}` directly, bypassing SWA entirely.

**Current Behavior:**
- Function App authentication is **disabled** (set to `AllowAnonymous`)
- Direct calls return `401 Unauthorized` (missing `x-ms-client-principal` header)
- But malicious actor can still spam/probe the API

**Risk Level:** 🔴 HIGH
- Attackers can discover valid session IDs via brute force
- No rate limiting on direct calls
- No authentication audit trail for direct calls

---

### Issue #2: API Routes Not Protected in SWA Config
**Problem:** `/api/*` routes are excluded from SWA's navigationFallback but NOT from route-level protection.

**Current Config:**
```json
"routes": [
  {
    "route": "/*",
    "allowedRoles": ["anonymous", "authenticated"]
  }
],
"navigationFallback": {
  "exclude": ["/api/*", ...]  // Excluded from fallback
}
```

**What This Means:**
- `/api/*` still requires `allowedRoles` authentication (good)
- BUT this only applies when accessed **through SWA**
- Direct to Function App bypasses this entirely

**Risk Level:** 🔴 HIGH

---

### Issue #3: No Backend Validation of User ID
**Problem:** Function checks `x-ms-client-principal` header but doesn't verify it came from SWA.

**Current Code:**
```typescript
const principalHeader = request.headers.get('x-ms-client-principal');
if (!principalHeader) {
  return { status: 401, ... };  // Only checks if header exists
}
```

**Risk:** An attacker could theoretically forge this header if they could inject it.

**Risk Level:** 🟡 MEDIUM (mitigated by SWA as reverse proxy)

---

## SOLUTION: Implement Network Security

### Option 1: IP Whitelisting (Recommended for Production)
Restrict Function App to only accept traffic from SWA by adding IP access restrictions.

```bash
# Get SWA outbound IP ranges
az staticwebapp show --name swa-qrattendance-prod --query "properties.sku"

# Add Function App access restriction
az webapp config access-restriction add \
  --resource-group $RESOURCE_GROUP \
  --name $FUNCTION_APP \
  --rule-name "SWA-Only" \
  --action Allow \
  --ip-address "20.XXX.XXX.XXX/32"  # SWA outbound IPs
  --priority 100
```

### Option 2: Enable App Service Authentication (Better)
Instead of `AllowAnonymous`, use Azure App Service built-in auth:

```bash
# Enable App Service Authentication on Function App
az webapp auth-classic update \
  --name $FUNCTION_APP \
  --resource-group $RESOURCE_GROUP \
  --enabled true \
  --action LoginWithAzureActiveDirectory \
  --aad-allowed-token-audiences "https://$FUNCTION_APP.azurewebsites.net"
```

### Option 3: Service-to-Service Auth (Best)
Configure Function App to use Managed Identity and validate tokens:

```typescript
// In getSession.ts
const bearerToken = request.headers.get('authorization')?.split(' ')[1];
if (!bearerToken) {
  return { status: 401, ... };
}

// Validate token with Azure AD
const tokenValidator = new TokenValidator();
const claims = await tokenValidator.validate(bearerToken);
```

---

## Recommended Implementation Priority

### Phase 1 (Immediate - Before Production)
✅ Add IP whitelisting for Function App
- Only allow SWA outbound IPs
- Blocks direct internet access

### Phase 2 (Short Term)
✅ Enable App Service Authentication
- Redundant layer of auth
- Protects if SWA is misconfigured

### Phase 3 (Medium Term)
✅ Implement token validation
- Fully secure service-to-service auth
- Audit trail for all requests

---

## Current Backend Verification

### What Works ✅
1. **Header check:** `x-ms-client-principal` is validated
2. **Role enforcement:** Functions check for specific roles (Teacher/Student)
3. **Error handling:** 401/403 responses are correct

### Example from getSession.ts:
```typescript
// Step 1: Check header exists
const principalHeader = request.headers.get('x-ms-client-principal');
if (!principalHeader) {
  return { status: 401, ... };  // ✅ Rejects anonymous
}

// Step 2: Parse principal
const principal = parseUserPrincipal(principalHeader);
const isTeacher = hasRole(principal, 'Teacher');

// Step 3: Role-based access
if (isTeacher && session.teacherId !== userId) {
  return { status: 403, ... };  // ✅ Only owner can access
}
```

---

## Testing Recommendations

### Test 1: SWA Access (Should Work)
```bash
curl -H "Authorization: Bearer $SWA_TOKEN" \
  https://your-swa.azurestaticapps.net/api/sessions/test-id
# Result: 200 or 403 (role-based), never 401
```

### Test 2: Direct Function Access (Should Fail)
```bash
curl https://func-qrattendance-dev.azurewebsites.net/api/sessions/test-id
# Result: 401 (missing header) ← Currently works, but should be blocked at network level
```

### Test 3: Forged Header (Should Fail After Fix)
```bash
curl -H "x-ms-client-principal: $(echo '{}' | base64)" \
  https://func-qrattendance-dev.azurewebsites.net/api/sessions/test-id
# Result: 401 (invalid principal) ← Should fail signature validation
```

---

## Summary

| Layer | Current Status | Risk |
|-------|---|---|
| **SWA Auth** | ✅ Enforced | Low |
| **Header Validation** | ✅ Present | Low |
| **Role-Based Access** | ✅ Implemented | Low |
| **Network Isolation** | ❌ Missing | HIGH |
| **Token Verification** | ❌ Missing | MEDIUM |

**Verdict:** Application-level auth works, but **network-level security is missing**. Implement IP whitelisting immediately before production deployment.
