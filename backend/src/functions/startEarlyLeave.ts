/**
 * startEarlyLeave - STUB (Not Yet Implemented)
 * This function deploys successfully but returns a placeholder response
 */
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, hasRole, getUserId } from '../utils/auth';

export async function startEarlyLeave(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('startEarlyLeave called - not yet implemented');

  const principal = parseAuthFromRequest(request);
  if (!principal) {
    return {
      status: 401,
      jsonBody: {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing authentication header',
          function: 'startEarlyLeave',
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
          function: 'startEarlyLeave',
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
        function: 'startEarlyLeave',
        timestamp: Date.now()
      }
    }
  };
}

app.http('startEarlyLeave', {
  methods: ['GET', 'POST'],
  route: 'startEarlyLeave',
  authLevel: 'anonymous',
  handler: startEarlyLeave
});
