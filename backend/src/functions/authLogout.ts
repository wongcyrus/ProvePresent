/**
 * Auth Logout Function
 * POST /api/auth/logout
 * Clears authentication cookie
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

export async function authLogout(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/auth/logout request');

  try {
    // Clear the auth-token cookie
    const clearCookieHeader = [
      'auth-token=',
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=0' // Expire immediately
    ].join('; ');

    return {
      status: 200,
      headers: {
        'Set-Cookie': clearCookieHeader
      },
      jsonBody: {
        success: true,
        message: 'Logged out successfully'
      }
    };

  } catch (error: any) {
    context.error('Error in authLogout:', error);
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to logout',
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('authLogout', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/logout',
  handler: authLogout
});
