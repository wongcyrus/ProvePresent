# Preventing Concurrent Logins (Multiple Devices/Browsers)

## Problem

Currently, a student can log in on multiple devices/browsers at the same time:
- Student logs in on laptop
- Student logs in on phone
- Both sessions are active simultaneously
- Student can use the system from both devices

This can lead to:
- Account sharing
- Cheating (friend uses account on different device)
- Confusion about which device is "active"
- Security concerns

## Solution: Single Device Login Enforcement

Track active authentication sessions per user and automatically invalidate previous sessions when a new login occurs.

## Architecture

### USER_SESSIONS Table (Already Exists)

```typescript
{
  partitionKey: userId,           // Student email
  rowKey: sessionToken,           // Unique session identifier
  deviceInfo: string,             // Browser/device info
  ipAddress: string,              // IP address
  loginAt: number,                // Login timestamp
  lastSeen: number,               // Last activity timestamp
  isActive: boolean               // Session status
}
```

### Flow

```
1. Student logs in on Device A
   → Azure AD authenticates
   → Create session record in USER_SESSIONS
   → sessionToken stored in browser (cookie/localStorage)

2. Student logs in on Device B
   → Azure AD authenticates
   → Check USER_SESSIONS for existing active sessions
   → Invalidate all previous sessions for this user
   → Create new session record
   → Device A's next API call fails with "SESSION_INVALIDATED"

3. Device A tries to make API call
   → Backend checks session validity
   → Session is invalidated
   → Return 401 with "SESSION_INVALIDATED" error
   → Frontend redirects to login with message
```

## Implementation

### Step 1: Session Tracking Middleware

Create a middleware that validates session on every API call:

```typescript
// backend/src/middleware/sessionValidator.ts

import { HttpRequest, InvocationContext } from '@azure/functions';
import { getTableClient, TableNames } from '../utils/database';
import { parseUserPrincipal, getUserId } from '../utils/auth';

export interface SessionValidationResult {
  isValid: boolean;
  userId?: string;
  sessionToken?: string;
  error?: {
    code: string;
    message: string;
  };
}

export async function validateSession(
  request: HttpRequest,
  context: InvocationContext
): Promise<SessionValidationResult> {
  
  // Parse authentication
  const principalHeader = request.headers.get('x-ms-client-principal') || 
                         request.headers.get('x-client-principal');
  
  if (!principalHeader) {
    return {
      isValid: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing authentication header'
      }
    };
  }

  const principal = parseUserPrincipal(principalHeader);
  const userId = getUserId(principal);
  
  // Get session token from header
  const sessionToken = request.headers.get('x-session-token');
  
  if (!sessionToken) {
    return {
      isValid: false,
      error: {
        code: 'NO_SESSION',
        message: 'No session token provided'
      }
    };
  }

  // Check if session is valid
  const userSessionsTable = getTableClient(TableNames.USER_SESSIONS);
  
  try {
    const session = await userSessionsTable.getEntity(userId, sessionToken);
    
    // Check if session is active
    if (!session.isActive) {
      context.log(`Session ${sessionToken} for user ${userId} is inactive`);
      return {
        isValid: false,
        error: {
          code: 'SESSION_INVALIDATED',
          message: 'Your session has been invalidated. Please log in again.'
        }
      };
    }
    
    // Check if session is expired (24 hours)
    const now = Math.floor(Date.now() / 1000);
    const sessionAge = now - (session.loginAt as number);
    const maxAge = 24 * 60 * 60; // 24 hours
    
    if (sessionAge > maxAge) {
      context.log(`Session ${sessionToken} for user ${userId} has expired`);
      
      // Mark as inactive
      await userSessionsTable.updateEntity({
        partitionKey: userId,
        rowKey: sessionToken,
        isActive: false
      }, 'Merge');
      
      return {
        isValid: false,
        error: {
          code: 'SESSION_EXPIRED',
          message: 'Your session has expired. Please log in again.'
        }
      };
    }
    
    // Update last seen
    await userSessionsTable.updateEntity({
      partitionKey: userId,
      rowKey: sessionToken,
      lastSeen: now
    }, 'Merge');
    
    return {
      isValid: true,
      userId,
      sessionToken
    };
    
  } catch (error: any) {
    if (error.statusCode === 404) {
      return {
        isValid: false,
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found. Please log in again.'
        }
      };
    }
    throw error;
  }
}
```

### Step 2: Session Creation on Login

```typescript
// backend/src/functions/createUserSession.ts

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseUserPrincipal, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import * as crypto from 'crypto';

export async function createUserSession(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/auth/create-session request');

  try {
    const principalHeader = request.headers.get('x-ms-client-principal') || 
                           request.headers.get('x-client-principal');
    
    if (!principalHeader) {
      return {
        status: 401,
        jsonBody: {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Missing authentication header',
            timestamp: Date.now()
          }
        }
      };
    }

    const principal = parseUserPrincipal(principalHeader);
    const userId = getUserId(principal);
    
    // Get device info from request
    const userAgent = request.headers.get('user-agent') || 'Unknown';
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'Unknown';
    
    // Generate unique session token
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const now = Math.floor(Date.now() / 1000);
    
    const userSessionsTable = getTableClient(TableNames.USER_SESSIONS);
    
    // Invalidate all existing sessions for this user
    context.log(`Invalidating existing sessions for user ${userId}`);
    
    try {
      for await (const existingSession of userSessionsTable.listEntities({
        queryOptions: {
          filter: `PartitionKey eq '${userId}' and isActive eq true`
        }
      })) {
        await userSessionsTable.updateEntity({
          partitionKey: existingSession.partitionKey,
          rowKey: existingSession.rowKey,
          isActive: false,
          invalidatedAt: now
        }, 'Merge');
        
        context.log(`Invalidated session ${existingSession.rowKey} for user ${userId}`);
      }
    } catch (error: any) {
      context.warn(`Error invalidating existing sessions: ${error.message}`);
      // Continue anyway
    }
    
    // Create new session
    await userSessionsTable.createEntity({
      partitionKey: userId,
      rowKey: sessionToken,
      deviceInfo: userAgent,
      ipAddress: ipAddress,
      loginAt: now,
      lastSeen: now,
      isActive: true
    });
    
    context.log(`Created new session ${sessionToken} for user ${userId}`);
    
    return {
      status: 200,
      jsonBody: {
        success: true,
        sessionToken,
        userId,
        expiresIn: 24 * 60 * 60 // 24 hours in seconds
      }
    };

  } catch (error: any) {
    context.error('Error creating user session:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create session',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('createUserSession', {
  methods: ['POST'],
  route: 'auth/create-session',
  authLevel: 'anonymous',
  handler: createUserSession
});
```

### Step 3: Modify All API Functions

Add session validation to every API function:

```typescript
// Example: backend/src/functions/joinSession.ts

import { validateSession } from '../middleware/sessionValidator';

export async function joinSession(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  
  // Validate session FIRST
  const sessionValidation = await validateSession(request, context);
  
  if (!sessionValidation.isValid) {
    return {
      status: 401,
      jsonBody: {
        error: {
          ...sessionValidation.error,
          timestamp: Date.now()
        }
      }
    };
  }
  
  // Continue with existing logic...
  const studentId = sessionValidation.userId!;
  // ...
}
```

### Step 4: Frontend Session Management

```typescript
// frontend/src/utils/sessionManager.ts

const SESSION_TOKEN_KEY = 'qr-attendance-session-token';

export class SessionManager {
  
  // Initialize session after Azure AD login
  static async initializeSession(): Promise<boolean> {
    try {
      const response = await fetch('/api/auth/create-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        localStorage.setItem(SESSION_TOKEN_KEY, data.sessionToken);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Failed to initialize session:', error);
      return false;
    }
  }
  
  // Get session token for API calls
  static getSessionToken(): string | null {
    return localStorage.getItem(SESSION_TOKEN_KEY);
  }
  
  // Clear session on logout or invalidation
  static clearSession(): void {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  }
  
  // Add session token to API headers
  static getAuthHeaders(): Record<string, string> {
    const sessionToken = this.getSessionToken();
    
    return {
      'Content-Type': 'application/json',
      ...(sessionToken && { 'x-session-token': sessionToken })
    };
  }
  
  // Handle session invalidation
  static handleSessionInvalidated(): void {
    this.clearSession();
    
    // Show message to user
    alert('Your session has been invalidated because you logged in on another device. Please log in again.');
    
    // Redirect to login
    window.location.href = '/.auth/logout';
  }
}
```

### Step 5: Frontend API Interceptor

```typescript
// frontend/src/utils/apiClient.ts

import { SessionManager } from './sessionManager';

export async function apiCall(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  
  // Add session token to headers
  const headers = {
    ...options.headers,
    ...SessionManager.getAuthHeaders()
  };
  
  const response = await fetch(url, {
    ...options,
    headers
  });
  
  // Handle session invalidation
  if (response.status === 401) {
    const error = await response.json();
    
    if (error.error?.code === 'SESSION_INVALIDATED') {
      SessionManager.handleSessionInvalidated();
      throw new Error('Session invalidated');
    }
  }
  
  return response;
}
```

### Step 6: Frontend Login Flow

```typescript
// frontend/src/pages/student.tsx or teacher.tsx

import { SessionManager } from '../utils/sessionManager';

useEffect(() => {
  async function initSession() {
    if (user && !SessionManager.getSessionToken()) {
      const success = await SessionManager.initializeSession();
      
      if (!success) {
        console.error('Failed to initialize session');
        // Handle error
      }
    }
  }
  
  initSession();
}, [user]);
```

## Alternative: Simpler Approach (Recommended)

Instead of tracking every API call, use a simpler approach:

### Track Login Sessions Only

```typescript
// On login: Create session and invalidate others
// On API call: Just check if Azure AD token is valid (existing behavior)
// On heartbeat: Check if session is still active

// This is simpler because:
// 1. Azure AD already handles token validation
// 2. We only need to track "which device is allowed"
// 3. Less overhead on every API call
```

### Implementation

1. **On Login (Frontend):**
   ```typescript
   // After Azure AD login succeeds
   await fetch('/api/auth/register-device', {
     method: 'POST',
     body: JSON.stringify({
       deviceId: generateDeviceId(), // Browser fingerprint
       deviceInfo: navigator.userAgent
     })
   });
   ```

2. **Backend registers device and invalidates others:**
   ```typescript
   // Invalidate all other devices for this user
   // Store current device as "active"
   ```

3. **On Heartbeat (every 30s):**
   ```typescript
   // Check if this device is still the active one
   const response = await fetch('/api/auth/check-device');
   if (!response.ok) {
     // Device was invalidated
     alert('You have been logged out because you logged in on another device');
     window.location.href = '/.auth/logout';
   }
   ```

## Recommendation

Use the **Simpler Approach** because:
- Less code changes
- Lower overhead
- Easier to maintain
- Azure AD already handles authentication
- We just need to track "which device is allowed"

Would you like me to implement the simpler approach?
