/**
 * Student Online Status Tracking
 * Called when student connects/disconnects from SignalR
 * Broadcasts status changes to teacher dashboard via SignalR
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseUserPrincipal, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import { broadcastAttendanceUpdate } from '../utils/signalrBroadcast';

export async function studentOnline(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/sessions/{sessionId}/student-online request');

  try {
    const principalHeader = request.headers.get('x-ms-client-principal') || request.headers.get('x-client-principal');
    if (!principalHeader) {
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Missing authentication header', timestamp: Date.now() } }
      };
    }

    const principal = parseUserPrincipal(principalHeader);
    if (!hasRole(principal, 'student')) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Student role required', timestamp: Date.now() } }
      };
    }
    const sessionId = request.params.sessionId;
    const studentId = principal.userDetails || principal.userId;
    
    if (!sessionId || !studentId) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing sessionId or email', timestamp: Date.now() } }
      };
    }

    const body = await request.json() as any;
    const isOnline = body.isOnline !== false; // Default to true

    // Update attendance record with online status
    const attendanceTable = getTableClient(TableNames.ATTENDANCE);
    
    try {
      const record = await attendanceTable.getEntity(sessionId, studentId);
      
      // Update online status and last seen timestamp
      await attendanceTable.updateEntity({
        partitionKey: sessionId,
        rowKey: studentId,
        isOnline: isOnline,
        lastSeen: Math.floor(Date.now() / 1000)
      }, 'Merge');

      context.log(`Updated online status for ${studentId}: ${isOnline}`);

      // Broadcast to SignalR so teacher dashboard updates in real-time
      await broadcastAttendanceUpdate(sessionId, {
        studentId: studentId,
        isOnline: isOnline,
      }, context);

      return {
        status: 200,
        jsonBody: { success: true }
      };
    } catch (error: any) {
      if (error.statusCode === 404) {
        return {
          status: 404,
          jsonBody: { error: { code: 'NOT_FOUND', message: 'Student not in session', timestamp: Date.now() } }
        };
      }
      throw error;
    }

  } catch (error: any) {
    context.error('Error updating online status:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update online status',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('studentOnline', {
  methods: ['POST'],
  route: 'sessions/{sessionId}/student-online',
  authLevel: 'anonymous',
  handler: studentOnline
});
