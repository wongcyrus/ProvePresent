/**
 * getLateQR - STUB (Not Yet Implemented)
 * This function deploys successfully but returns a placeholder response
 */
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseUserPrincipal, hasRole, getUserId } from '../utils/auth';

export async function getLateQR(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('getLateQR called - not yet implemented');

  const principalHeader = request.headers.get('x-ms-client-principal') || request.headers.get('x-client-principal');
  if (!principalHeader) {
    return {
      status: 401,
      jsonBody: {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing authentication header',
          function: 'getLateQR',
          timestamp: Date.now()
        }
      }
    };
  }

  const principal = parseUserPrincipal(principalHeader);
  if (!hasRole(principal, 'teacher')) {
    return {
      status: 403,
      jsonBody: {
        error: {
          code: 'FORBIDDEN',
          message: 'Teacher role required',
          function: 'getLateQR',
          timestamp: Date.now()
        }
      }
    };
  }
  
  return {
    status: 501,
    jsonBody: {
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'This function is not yet implemented',
        function: 'getLateQR',
        timestamp: Date.now()
      }
    }
  };
}

app.http('getLateQR', {
  methods: ['GET', 'POST'],
  route: 'getLateQR',
  authLevel: 'anonymous',
  handler: getLateQR
});
