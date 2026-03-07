/**
 * Share Session API Endpoint
 * Allows session owner to share session with co-teachers
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, hasRoleAsync, getUserId, isValidTeacherEmail } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';

interface ShareSessionRequest {
  coTeacherEmail: string;
}

export async function shareSession(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/sessions/{sessionId}/share request');

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
    if (!await hasRoleAsync(principal, 'Teacher') && !await hasRoleAsync(principal, 'teacher')) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Teacher role required', timestamp: Date.now() } }
      };
    }

    // Parse request body
    const body = await request.json() as ShareSessionRequest;
    if (!body.coTeacherEmail) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'coTeacherEmail is required', timestamp: Date.now() } }
      };
    }

    const coTeacherEmail = body.coTeacherEmail.toLowerCase();

    // Validate co-teacher email is a teacher (VTC domain or external teacher)
    if (!await isValidTeacherEmail(coTeacherEmail)) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Co-teacher must have a valid teacher email', timestamp: Date.now() } }
      };
    }

    // Cannot share with yourself
    if (coTeacherEmail === userId.toLowerCase()) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Cannot share session with yourself', timestamp: Date.now() } }
      };
    }

    const sessionsTable = getTableClient(TableNames.SESSIONS);

    // Get session and verify ownership
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

    // Only session owner can share
    if (session.teacherId !== userId) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Only session owner can share the session', timestamp: Date.now() } }
      };
    }

    // Parse existing co-teachers
    let coTeachers: string[] = [];
    if (session.coTeachers) {
      try {
        coTeachers = JSON.parse(session.coTeachers);
      } catch {
        coTeachers = [];
      }
    }

    // Check if already shared
    if (coTeachers.includes(coTeacherEmail)) {
      return {
        status: 400,
        jsonBody: { error: { code: 'ALREADY_SHARED', message: 'Session already shared with this teacher', timestamp: Date.now() } }
      };
    }

    // Add co-teacher
    coTeachers.push(coTeacherEmail);

    // Update session
    await sessionsTable.updateEntity({
      partitionKey: 'SESSION',
      rowKey: sessionId,
      coTeachers: JSON.stringify(coTeachers)
    }, 'Merge');

    context.log(`Session ${sessionId} shared with ${coTeacherEmail} by ${userId}`);

    return {
      status: 200,
      jsonBody: {
        message: 'Session shared successfully',
        sessionId,
        coTeachers
      }
    };

  } catch (error: any) {
    context.error('Error sharing session:', error);
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to share session',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('shareSession', {
  methods: ['POST'],
  route: 'sessions/{sessionId}/share',
  authLevel: 'anonymous',
  handler: shareSession
});
