# Function Refactoring Guide

**Date**: February 25, 2026  
**Purpose**: Extract common utilities to reduce code duplication

---

## Overview

We've created two utility modules to eliminate duplicate code across 44 Azure Functions:

1. **`backend/src/utils/auth.ts`** - Authentication utilities
2. **`backend/src/utils/database.ts`** - Database utilities

---

## New Utility Modules

### 1. Authentication Utilities (`utils/auth.ts`)

**Functions**:
- `parseUserPrincipal(header: string)` - Parse base64-encoded auth header
- `getUserId(principal: any)` - Extract user email from principal
- `hasRole(principal: any, role: string)` - Check if user has role (VTC domain-based)
- `getRolesFromEmail(email: string)` - Get roles from email address

**Usage**:
```typescript
import { parseUserPrincipal, hasRole, getUserId } from '../utils/auth';

// In your function
const principal = parseUserPrincipal(principalHeader);
const userId = getUserId(principal);
if (!hasRole(principal, 'Teacher')) {
  return { status: 403, jsonBody: { error: 'Forbidden' } };
}
```

### 2. Database Utilities (`utils/database.ts`)

**Functions**:
- `getTableClient(tableName: string)` - Get Table Storage client
- `TableNames` - Constant object with all table names

**Usage**:
```typescript
import { getTableClient, TableNames } from '../utils/database';

// In your function
const sessionsTable = getTableClient(TableNames.SESSIONS);
const attendanceTable = getTableClient(TableNames.ATTENDANCE);
```

**Available Table Names**:
- `TableNames.SESSIONS`
- `TableNames.ATTENDANCE`
- `TableNames.CHAINS`
- `TableNames.TOKENS`
- `TableNames.USER_SESSIONS`
- `TableNames.ATTENDANCE_SNAPSHOTS`
- `TableNames.CHAIN_HISTORY`
- `TableNames.SCAN_LOGS`
- `TableNames.DELETION_LOG`
- `TableNames.QUIZ_QUESTIONS`
- `TableNames.QUIZ_RESPONSES`
- `TableNames.QUIZ_METRICS`

---

## Refactoring Steps

### Step 1: Update Imports

**Before**:
```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { TableClient } from '@azure/data-tables';

function parseUserPrincipal(header: string): any {
  try {
    const decoded = Buffer.from(header, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    throw new Error('Invalid authentication header');
  }
}

function hasRole(principal: any, role: string): boolean {
  // ... duplicate code ...
}

function getTableClient(tableName: string): TableClient {
  // ... duplicate code ...
}
```

**After**:
```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseUserPrincipal, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
```

### Step 2: Remove Duplicate Functions

Delete these function definitions from your file:
- `parseUserPrincipal()`
- `hasRole()`
- `getUserId()`
- `getRolesFromEmail()`
- `getTableClient()`

### Step 3: Update Table Name References

**Before**:
```typescript
const sessionsTable = getTableClient('Sessions');
const attendanceTable = getTableClient('Attendance');
const chainsTable = getTableClient('Chains');
```

**After**:
```typescript
const sessionsTable = getTableClient(TableNames.SESSIONS);
const attendanceTable = getTableClient(TableNames.ATTENDANCE);
const chainsTable = getTableClient(TableNames.CHAINS);
```

---

## Refactored Functions (Examples)

### ✅ Already Refactored

These functions have been updated to use the new utilities:

1. **scanChain.ts** - Chain scanning logic
2. **sendQuizQuestion.ts** - Quiz question distribution
3. **submitQuizAnswer.ts** - Quiz answer submission
4. **getStudentQuestions.ts** - Get pending questions

**Use these as templates for refactoring other functions!**

---

## Functions Needing Refactoring

### High Priority (Frequently Used)

1. **createSession.ts** - Session creation
2. **getSession.ts** - Get session details
3. **getAttendance.ts** - Get attendance records
4. **seedEntry.ts** - Seed entry chains
5. **startExitChain.ts** - Start exit chains
6. **closeChain.ts** - Close chains
7. **markExit.ts** - Mark student exit
8. **getTeacherSessions.ts** - List teacher sessions

### Medium Priority

9. **deleteSession.ts**
10. **endSession.ts**
11. **updateSession.ts**
12. **joinSession.ts**
13. **registerSession.ts**
14. **checkSession.ts**
15. **clearSession.ts**
16. **getEntryQR.ts**
17. **getExitQR.ts**
18. **getLateQR.ts**
19. **getEarlyQR.ts**
20. **getEarlyLeaveQR.ts**

### Lower Priority

21. **reseedEntry.ts**
22. **reseedExit.ts**
23. **setChainHolder.ts**
24. **startEarlyLeave.ts**
25. **stopEarlyLeave.ts**
26. **takeSnapshot.ts**
27. **listSnapshots.ts**
28. **getSnapshotTrace.ts**
29. **getChainHistory.ts**
30. **compareSnapshots.ts**
31. **markStudentExit.ts**
32. **getStudentToken.ts**
33. **negotiate.ts**
34. **negotiateDashboard.ts**
35. **negotiateStudent.ts**
36. **studentOnline.ts**
37. **analyzeSlide.ts**
38. **generateQuestions.ts**
39. **getRoles.ts**
40. **getUserRoles.ts**
41. **requestChallenge.ts**

---

## Benefits

### Code Reduction

**Before**: Each function had ~40-60 lines of duplicate code
**After**: Each function saves ~40-60 lines

**Total Savings**: ~1,600-2,400 lines of code across 40 functions!

### Maintainability

- ✅ Single source of truth for auth logic
- ✅ Consistent error handling
- ✅ Easier to update role assignment rules
- ✅ Centralized table name management
- ✅ Easier to add new authentication methods

### Type Safety

- ✅ Consistent type definitions
- ✅ Better IDE autocomplete
- ✅ Compile-time error checking

---

## Testing

After refactoring each function:

1. **Build**: `npm run build` (in backend directory)
2. **Check for errors**: TypeScript will catch any issues
3. **Test locally**: Run the function with test data
4. **Verify behavior**: Ensure auth and database access still work

---

## Example: Refactoring createSession.ts

### Before (Partial)

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { TableClient } from '@azure/data-tables';
import { randomUUID } from 'crypto';

function parseUserPrincipal(header: string): any {
  try {
    const decoded = Buffer.from(header, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    throw new Error('Invalid authentication header');
  }
}

function getUserId(principal: any): string {
  return principal.userDetails || principal.userId;
}

function hasRole(principal: any, role: string): boolean {
  const email = principal.userDetails || '';
  const emailLower = email.toLowerCase();
  
  if (role.toLowerCase() === 'teacher' && 
      emailLower.endsWith('@vtc.edu.hk') && 
      !emailLower.endsWith('@stu.vtc.edu.hk')) {
    return true;
  }
  
  const roles = principal.userRoles || [];
  return roles.some((r: string) => r.toLowerCase() === role.toLowerCase());
}

function getTableClient(tableName: string): TableClient {
  const connectionString = process.env.AzureWebJobsStorage;
  if (!connectionString) {
    throw new Error('AzureWebJobsStorage not configured');
  }
  const isLocal = connectionString.includes("127.0.0.1") || 
                  connectionString.includes("localhost");
  return TableClient.fromConnectionString(
    connectionString, 
    tableName, 
    { allowInsecureConnection: isLocal }
  );
}

export async function createSession(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  // ... function logic ...
  const sessionsTable = getTableClient('Sessions');
  const userSessionsTable = getTableClient('UserSessions');
  // ...
}
```

### After (Partial)

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { randomUUID } from 'crypto';
import { parseUserPrincipal, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';

export async function createSession(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  // ... function logic ...
  const sessionsTable = getTableClient(TableNames.SESSIONS);
  const userSessionsTable = getTableClient(TableNames.USER_SESSIONS);
  // ...
}
```

**Lines Saved**: ~50 lines per function!

---

## Rollout Strategy

### Phase 1: Core Functions (Completed ✅)
- scanChain.ts
- sendQuizQuestion.ts
- submitQuizAnswer.ts
- getStudentQuestions.ts

### Phase 2: High-Traffic Functions (Next)
- createSession.ts
- getSession.ts
- getAttendance.ts
- seedEntry.ts
- startExitChain.ts

### Phase 3: Remaining Functions
- All other 35+ functions

### Phase 4: Verification
- Run full test suite
- Deploy to dev environment
- Verify all functions work correctly
- Deploy to production

---

## Common Issues & Solutions

### Issue 1: Import Path Errors

**Error**: `Cannot find module '../utils/auth'`

**Solution**: Check your relative path. From `functions/` directory, use `../utils/`

### Issue 2: TableNames Not Found

**Error**: `Property 'SESSIONS' does not exist on type 'typeof TableNames'`

**Solution**: Make sure you imported `TableNames` from `../utils/database`

### Issue 3: Build Errors After Refactoring

**Error**: Various TypeScript errors

**Solution**: 
1. Delete duplicate function definitions
2. Ensure all imports are correct
3. Run `npm run build` to check

---

## Verification Checklist

After refactoring a function:

- [ ] Removed duplicate `parseUserPrincipal` function
- [ ] Removed duplicate `hasRole` function
- [ ] Removed duplicate `getUserId` function (if present)
- [ ] Removed duplicate `getTableClient` function
- [ ] Added import for auth utilities
- [ ] Added import for database utilities
- [ ] Replaced string table names with `TableNames` constants
- [ ] Build succeeds (`npm run build`)
- [ ] Function logic unchanged (only imports/utilities changed)

---

## Next Steps

1. **Review Examples**: Study the 4 refactored functions
2. **Start with High Priority**: Refactor frequently-used functions first
3. **Test Incrementally**: Build and test after each function
4. **Deploy Gradually**: Deploy in phases to minimize risk

---

**Status**: 4 of 44 functions refactored (9% complete)  
**Estimated Time**: ~2-3 hours to refactor all remaining functions  
**Estimated Savings**: ~1,600-2,400 lines of code

---

**Last Updated**: February 25, 2026
