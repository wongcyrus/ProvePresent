/**
 * Authentication Middleware
 * Helper to simplify auth parsing in Azure Functions
 */

import { HttpRequest } from '@azure/functions';
import { parseAuthFromHeaders } from './auth';

export interface AuthResult {
  authenticated: boolean;
  principal: any | null;
  userId: string | null;
  roles: string[];
}

/**
 * Parse and validate authentication from request
 * Returns structured auth result
 */
export function authenticate(request: HttpRequest): AuthResult {
  const principal = parseAuthFromHeaders(request.headers);
  
  if (!principal) {
    return {
      authenticated: false,
      principal: null,
      userId: null,
      roles: []
    };
  }
  
  return {
    authenticated: true,
    principal,
    userId: principal.userDetails || principal.userId,
    roles: principal.userRoles || []
  };
}

/**
 * Check if user has a specific role
 */
export function hasRole(auth: AuthResult, role: string): boolean {
  return auth.roles.some(r => r.toLowerCase() === role.toLowerCase());
}

/**
 * Require authentication - returns error response if not authenticated
 */
export function requireAuth(request: HttpRequest): AuthResult | { status: number; jsonBody: any } {
  const auth = authenticate(request);
  
  if (!auth.authenticated) {
    return {
      status: 401,
      jsonBody: {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          timestamp: Date.now()
        }
      }
    };
  }
  
  return auth;
}

/**
 * Require specific role - returns error response if not authorized
 */
export function requireRole(request: HttpRequest, role: string): AuthResult | { status: number; jsonBody: any } {
  const authOrError = requireAuth(request);
  
  // If it's an error response, return it
  if ('status' in authOrError) {
    return authOrError;
  }
  
  const auth = authOrError as AuthResult;
  
  if (!hasRole(auth, role)) {
    return {
      status: 403,
      jsonBody: {
        error: {
          code: 'FORBIDDEN',
          message: `${role} role required`,
          timestamp: Date.now()
        }
      }
    };
  }
  
  return auth;
}
