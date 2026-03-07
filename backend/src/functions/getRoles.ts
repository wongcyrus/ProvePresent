/**
 * Get Roles Function for Azure Static Web Apps
 * This function is called by Static Web Apps to assign custom roles
 * Based on: https://learn.microsoft.com/en-us/azure/static-web-apps/assign-roles-microsoft-graph
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getRolesFromEmail, parseAuthFromRequest } from '../utils/auth';

export async function getRoles(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/auth/roles request');

  try {
    // Get the user principal from JWT cookie or Authorization header
    const principal = parseAuthFromRequest(request);
    
    if (!principal) {
      context.log('No authentication found');
      return {
        status: 200,
        jsonBody: {
          roles: []
        }
      };
    }

    const email = principal.userDetails || principal.userId || '';
    
    context.log('User email:', email);
    
    // Compute roles from email domain
    const roles = getRolesFromEmail(email);
    
    context.log('Assigned roles:', roles);
    
    // Return roles in the format expected by Static Web Apps
    return {
      status: 200,
      jsonBody: {
        roles: roles
      }
    };

  } catch (error: any) {
    context.error('Error getting roles:', error);
    
    // Return empty roles on error (fail safe)
    return {
      status: 200,
      jsonBody: {
        roles: []
      }
    };
  }
}

app.http('getRoles', {
  methods: ['POST'],
  route: 'auth/roles',
  authLevel: 'anonymous',
  handler: getRoles
});
