/**
 * Register Session API Endpoint
 * Registers a new user session
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
export async function registerSession(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/auth/register-session request');

  try {
    const principal = parseAuthFromRequest(request);
    if (!principal) {
      return {
        status: 401,
        jsonBody: { error: 'Not authenticated' }
      };
    }    if (!hasRole(principal, 'authenticated')) {
      return {
        status: 403,
        jsonBody: { error: 'Forbidden' }
      };
    }

    const body = await request.json() as any;
    const { email, userId, sessionId } = body;

    if (!email || !userId || !sessionId) {
      return {
        status: 400,
        jsonBody: { error: 'Email, userId, and sessionId are required' }
      };
    }

    const principalEmail = principal.userDetails || '';
    if (principalEmail && principalEmail.toLowerCase() !== String(email).toLowerCase()) {
      return {
        status: 403,
        jsonBody: { error: 'Email does not match authenticated user' }
      };
    }

    const principalUserId = principal.userId || '';
    if (principalUserId && principalUserId !== userId) {
      return {
        status: 403,
        jsonBody: { error: 'User ID does not match authenticated user' }
      };
    }

    const sessionsTable = getTableClient(TableNames.USER_SESSIONS);
    const now = Math.floor(Date.now() / 1000); // Unix timestamp in seconds

    // Create or update session
    const sessionEntity = {
      partitionKey: 'USERSESSION',
      rowKey: email,
      userId: principalUserId || userId,
      sessionId,
      createdAt: now,
      lastActiveAt: now
    };

    await sessionsTable.upsertEntity(sessionEntity, 'Replace');

    context.log(`Registered session for user: ${email}`);

    return {
      status: 200,
      jsonBody: {
        success: true,
        sessionId
      }
    };

  } catch (error: any) {
    context.error('Error registering session:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: 'Failed to register session',
        details: error.message
      }
    };
  }
}

app.http('registerSession', {
  methods: ['POST'],
  route: 'auth/register-session',
  authLevel: 'anonymous',
  handler: registerSession
});
