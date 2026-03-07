/**
 * Get Co-Teachers API Endpoint
 * Returns list of co-teachers for a session
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import { checkSessionAccess, getCoTeachers as parseCoTeachers } from '../utils/sessionAccess';

export async function getCoTeachers(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing GET /api/sessions/{sessionId}/co-teachers request');

  try {
    const sessionId = request.params.sessionId;
    if (!sessionId) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Session ID is required', timestamp: Date.now() } }
      };
    }

    // Parse authentication
    const principal = parseAuthFromRequest(request);
    if (!principal) {
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Missing authentication header', timestamp: Date.now() } }
      };
    }    const userId = getUserId(principal);

    // Require Teacher role
    if (!hasRole(principal, 'Teacher') && !hasRole(principal, 'teacher')) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Teacher role required', timestamp: Date.now() } }
      };
    }

    const sessionsTable = getTableClient(TableNames.SESSIONS);

    // Get session
    let session: any;
    try {
      session = await sessionsTable.getEntity('SESSION', sessionId);
    } catch (error: any) {
      if (error.statusCode === 404) {
        return {
          status: 404,
          jsonBody: { error: { code: 'NOT_FOUND', message: 'Session not found', timestamp: Date.now() } }
        };
      }
      throw error;
    }

    // Verify access (owner or co-teacher can view co-teachers list)
    const access = checkSessionAccess(session, userId);
    if (!access.hasAccess) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'You do not have access to this session', timestamp: Date.now() } }
      };
    }

    const coTeachers = parseCoTeachers(session);

    return {
      status: 200,
      jsonBody: {
        sessionId,
        teacherId: session.teacherId,
        coTeachers,
        isOwner: access.isOwner
      }
    };

  } catch (error: any) {
    context.error('Error getting co-teachers:', error);
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get co-teachers',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('getCoTeachers', {
  methods: ['GET'],
  route: 'sessions/{sessionId}/co-teachers',
  authLevel: 'anonymous',
  handler: getCoTeachers
});
