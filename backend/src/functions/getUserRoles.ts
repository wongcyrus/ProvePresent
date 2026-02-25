/**
 * Get User Roles API Endpoint - REFACTORED (Self-contained)
 * No external service dependencies
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

// Assign roles based on email domain
function getRolesFromEmail(email: string): string[] {
  const roles: string[] = ['authenticated'];
  
  if (!email) return roles;
  
  const emailLower = email.toLowerCase();
  
  if (emailLower.endsWith('@stu.vtc.edu.hk')) {
    roles.push('student');
  } else if (emailLower.endsWith('@vtc.edu.hk')) {
    roles.push('teacher');
  }
  
  return roles;
}

export async function getUserRoles(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing GET /api/auth/me request');

  try {
    const principalHeader = request.headers.get('x-ms-client-principal') || request.headers.get('x-client-principal');
    
    if (!principalHeader) {
      return {
        status: 401,
        jsonBody: { error: 'Not authenticated' }
      };
    }

    // Decode the principal
    const principal = JSON.parse(Buffer.from(principalHeader, 'base64').toString('utf-8'));
    
    // Compute roles from email domain
    const email = principal.userDetails || '';
    const roles = getRolesFromEmail(email);
    
    return {
      status: 200,
      jsonBody: {
        clientPrincipal: {
          userId: principal.userId,
          userDetails: email,
          identityProvider: principal.identityProvider,
          userRoles: roles,
          claims: principal.claims || []
        },
        userId: principal.userId,
        userDetails: email,
        identityProvider: principal.identityProvider,
        userRoles: roles,
        claims: principal.claims || []
      }
    };

  } catch (error: any) {
    context.error('Error getting user roles:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: 'Failed to get user roles',
        details: error.message
      }
    };
  }
}

app.http('getUserRoles', {
  methods: ['GET'],
  route: 'auth/me',
  authLevel: 'anonymous',
  handler: getUserRoles
});
