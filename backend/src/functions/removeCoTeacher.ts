/**
 * Remove Co-Teacher API Endpoint
 * Allows session owner to remove a co-teacher from session
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';

interface RemoveCoTeacherRequest {
  coTeacherEmail: string;
}

export async function removeCoTeacher(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing DELETE /api/sessions/{sessionId}/share request');

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

    // Parse request body
    const body = await request.json() as RemoveCoTeacherRequest;
    if (!body.coTeacherEmail) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'coTeacherEmail is required', timestamp: Date.now() } }
      };
    }

    const coTeacherEmail = body.coTeacherEmail.toLowerCase();

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

    // Only session owner can remove co-teachers
    if (session.teacherId !== userId) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Only session owner can remove co-teachers', timestamp: Date.now() } }
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

    // Check if co-teacher exists
    const index = coTeachers.indexOf(coTeacherEmail);
    if (index === -1) {
      return {
        status: 404,
        jsonBody: { error: { code: 'NOT_FOUND', message: 'Co-teacher not found in this session', timestamp: Date.now() } }
      };
    }

    // Remove co-teacher
    coTeachers.splice(index, 1);

    // Update session
    await sessionsTable.updateEntity({
      partitionKey: 'SESSION',
      rowKey: sessionId,
      coTeachers: JSON.stringify(coTeachers)
    }, 'Merge');

    context.log(`Co-teacher ${coTeacherEmail} removed from session ${sessionId} by ${userId}`);

    return {
      status: 200,
      jsonBody: {
        message: 'Co-teacher removed successfully',
        sessionId,
        coTeachers
      }
    };

  } catch (error: any) {
    context.error('Error removing co-teacher:', error);
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to remove co-teacher',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('removeCoTeacher', {
  methods: ['DELETE'],
  route: 'sessions/{sessionId}/share',
  authLevel: 'anonymous',
  handler: removeCoTeacher
});
