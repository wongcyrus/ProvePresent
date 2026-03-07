/**
 * getEarlyQR - STUB (Not Yet Implemented)
 * This function deploys successfully but returns a placeholder response
 */
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, hasRole, getUserId } from '../utils/auth';

export async function getEarlyQR(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('getEarlyQR called - not yet implemented');

  const principal = parseAuthFromRequest(request);
  if (!principal) {
    return {
      status: 401,
      jsonBody: {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing authentication header',
          function: 'getEarlyQR',
          timestamp: Date.now()
        }
      }
    };
  }  if (!hasRole(principal, 'teacher')) {
    return {
      status: 403,
      jsonBody: {
        error: {
          code: 'FORBIDDEN',
          message: 'Teacher role required',
          function: 'getEarlyQR',
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
        function: 'getEarlyQR',
        timestamp: Date.now()
      }
    }
  };
}

app.http('getEarlyQR', {
  methods: ['GET', 'POST'],
  route: 'getEarlyQR',
  authLevel: 'anonymous',
  handler: getEarlyQR
});
