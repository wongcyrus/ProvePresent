/**
 * Auth Me Function
 * GET /api/auth/me
 * Returns current user authentication status
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { 
  verifyToken, 
  jwtToClientPrincipal, 
  extractTokenFromCookie, 
  extractTokenFromHeader 
} from '../utils/jwt';

export async function authMe(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing GET /api/auth/me request');

  try {
    // Try to get token from cookie first (preferred)
    const cookieHeader = request.headers.get('cookie');
    let token = extractTokenFromCookie(cookieHeader);

    // Fallback to Authorization header
    if (!token) {
      const authHeader = request.headers.get('authorization');
      token = extractTokenFromHeader(authHeader);
    }

    // No authentication found
    if (!token) {
      return {
        status: 200,
        jsonBody: {
          clientPrincipal: null
        }
      };
    }

    // Verify JWT token
    const payload = verifyToken(token);
    if (!payload) {
      // Invalid or expired token
      return {
        status: 200,
        jsonBody: {
          clientPrincipal: null
        }
      };
    }

    // Convert to clientPrincipal format
    const clientPrincipal = jwtToClientPrincipal(payload);

    return {
      status: 200,
      jsonBody: {
        clientPrincipal
      }
    };

  } catch (error: any) {
    context.error('Error in authMe:', error);
    // Return no auth on error (fail safe)
    return {
      status: 200,
      jsonBody: {
        clientPrincipal: null
      }
    };
  }
}

app.http('authMe', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/me',
  handler: authMe
});
