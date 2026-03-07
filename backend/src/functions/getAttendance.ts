/**
 * Get Attendance API Endpoint - REFACTORED (Self-contained)
 * No external service dependencies
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import { checkSessionAccess } from '../utils/sessionAccess';
export async function getAttendance(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing GET /api/sessions/{sessionId}/attendance request');

  try {
    // Parse authentication
    const principal = parseAuthFromRequest(request);
    if (!principal) {
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Missing authentication header', timestamp: Date.now() } }
      };
    }    
    // Require Teacher role
    if (!hasRole(principal, 'Teacher')) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Teacher role required', timestamp: Date.now() } }
      };
    }

    const teacherId = getUserId(principal);
    const sessionId = request.params.sessionId;
    
    if (!sessionId) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing sessionId', timestamp: Date.now() } }
      };
    }

    // Verify session exists and teacher owns it
    const sessionsTable = getTableClient(TableNames.SESSIONS);
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

    // Verify access (owner or co-teacher)
    const access = checkSessionAccess(session, teacherId);
    if (!access.hasAccess) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'You do not have access to this session', timestamp: Date.now() } }
      };
    }

    // Get attendance records
    const attendanceTable = getTableClient(TableNames.ATTENDANCE);
    const attendance: any[] = [];
    
    for await (const entity of attendanceTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${sessionId}'` } })) {
      attendance.push({
        studentId: entity.rowKey,
        entryStatus: entity.entryStatus,
        entryMethod: entity.entryMethod, // DIRECT_QR or CHAIN
        entryAt: entity.entryAt,
        exitVerified: entity.exitVerified,
        exitMethod: entity.exitMethod, // DIRECT_QR or CHAIN
        exitedAt: entity.exitedAt, // Exit timestamp
        earlyLeaveAt: entity.earlyLeaveAt,
        finalStatus: entity.finalStatus,
        locationWarning: entity.locationWarning,
        locationDistance: entity.locationDistance,
        // Use joinedAt if available, otherwise fall back to Timestamp (for existing records)
        joinedAt: entity.joinedAt || (entity.timestamp ? Math.floor(new Date(entity.timestamp).getTime() / 1000) : undefined)
      });
    }

    return {
      status: 200,
      jsonBody: { attendance }
    };

  } catch (error: any) {
    context.error('Error getting attendance:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get attendance',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('getAttendance', {
  methods: ['GET'],
  route: 'sessions/{sessionId}/attendance',
  authLevel: 'anonymous',
  handler: getAttendance
});
