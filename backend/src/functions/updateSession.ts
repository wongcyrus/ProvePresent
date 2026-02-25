/**
 * Update Session API Endpoint
 * Updates a session with support for recurring session scopes
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseUserPrincipal, hasRole, getUserId, getRolesFromEmail } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
interface UpdateSessionRequest {
  classId?: string;
  startAt?: string;
  endAt?: string;
  lateCutoffMinutes?: number;
  exitWindowMinutes?: number;
}

export async function updateSession(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing PATCH /api/sessions/{sessionId} request');

  try {
    // Extract session ID from URL
    const sessionId = request.params.sessionId;
    if (!sessionId) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Session ID is required', timestamp: Date.now() } }
      };
    }

    // Extract update scope for recurring sessions (default: 'this')
    const updateScope = request.query.get('scope') || 'this';
    if (!['this', 'future', 'all'].includes(updateScope)) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Invalid update scope. Must be: this, future, or all', timestamp: Date.now() } }
      };
    }

    // Extract and validate authentication
    const principalHeader = request.headers.get('x-ms-client-principal') || request.headers.get('x-client-principal');
    if (!principalHeader) {
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Not authenticated', timestamp: Date.now() } }
      };
    }

    const principal = parseUserPrincipal(principalHeader);
    const userId = getUserId(principal);
    
    const teacherEmail = principal.userDetails || '';
    const roles = getRolesFromEmail(teacherEmail);

    // Verify teacher role
    if (!roles.includes('teacher')) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Only teachers can update sessions', timestamp: Date.now() } }
      };
    }

    // Parse request body
    const updates = await request.json() as UpdateSessionRequest;
    
    if (Object.keys(updates).length === 0) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'No update fields provided', timestamp: Date.now() } }
      };
    }

    const sessionsTable = getTableClient(TableNames.SESSIONS);
    
    // Verify session exists and belongs to this teacher
    let session: any;
    try {
      const entity = await sessionsTable.getEntity('SESSION', sessionId);
      session = entity as any;
      
      if (session.teacherId !== userId) {
        return {
          status: 403,
          jsonBody: { error: { code: 'FORBIDDEN', message: 'You can only update your own sessions', timestamp: Date.now() } }
        };
      }
    } catch (error: any) {
      if (error.statusCode === 404) {
        return {
          status: 404,
          jsonBody: { error: { code: 'NOT_FOUND', message: 'Session not found', timestamp: Date.now() } }
        };
      }
      throw error;
    }

    // Determine which sessions to update
    let sessionIdsToUpdate: string[] = [sessionId];
    let isRecurringSession = !!session.parentSessionId || !!session.isRecurring;

    if (isRecurringSession && updateScope !== 'this') {
      const parentId = session.parentSessionId || sessionId;
      const currentOccurrence = session.occurrenceNumber || 1;

      context.log(`Recurring session detected. Parent: ${parentId}, Current: ${currentOccurrence}, Scope: ${updateScope}`);

      try {
        const allSessions: any[] = [];
        for await (const entity of sessionsTable.listEntities()) {
          const s = entity as any;
          // Include parent session and all child sessions
          if (s.rowKey === parentId || s.parentSessionId === parentId) {
            allSessions.push(s);
          }
        }

        // Sort by occurrence number to maintain order
        allSessions.sort((a: any, b: any) => (a.occurrenceNumber || 1) - (b.occurrenceNumber || 1));

        if (updateScope === 'future') {
          sessionIdsToUpdate = allSessions
            .filter((s: any) => (s.occurrenceNumber || 1) >= currentOccurrence)
            .map((s: any) => s.rowKey);
          context.log(`Future scope: updating ${sessionIdsToUpdate.length} sessions from occurrence ${currentOccurrence} onwards`);
        } else if (updateScope === 'all') {
          sessionIdsToUpdate = allSessions.map((s: any) => s.rowKey);
          context.log(`All scope: updating all ${sessionIdsToUpdate.length} sessions in recurring group`);
        }
      } catch (error: any) {
        context.warn(`Error fetching recurring sessions: ${error.message}`);
      }
    }

    // Apply updates to all sessions in scope
    let updatedCount = 0;
    for (const sid of sessionIdsToUpdate) {
      try {
        const existingSession = await sessionsTable.getEntity('SESSION', sid);
        
        // Handle time updates for recurring sessions
        let updatedStartAt = updates.startAt;
        let updatedEndAt = updates.endAt;
        
        if (sessionIdsToUpdate.length > 1 && (updates.startAt || updates.endAt)) {
          // For recurring sessions, calculate offset from original
          const originalStart = new Date(session.startAt);
          const originalEnd = new Date(session.endAt);
          const currentStart = new Date((existingSession as any).startAt);
          
          if (updates.startAt && updates.endAt) {
            const newStart = new Date(updates.startAt);
            const newEnd = new Date(updates.endAt);
            const duration = newEnd.getTime() - newStart.getTime();
            const timeChange = newStart.getTime() - originalStart.getTime();
            
            // Apply the same time change to this occurrence
            const adjustedStart = new Date(currentStart.getTime() + timeChange);
            const adjustedEnd = new Date(adjustedStart.getTime() + duration);
            
            updatedStartAt = adjustedStart.toISOString();
            updatedEndAt = adjustedEnd.toISOString();
          }
        }
        
        const updatedEntity = {
          ...existingSession,
          partitionKey: 'SESSION',
          rowKey: sid,
          ...(updates.classId && { classId: updates.classId }),
          ...(updatedStartAt && { startAt: updatedStartAt }),
          ...(updatedEndAt && { endAt: updatedEndAt }),
          ...(updates.lateCutoffMinutes !== undefined && { lateCutoffMinutes: updates.lateCutoffMinutes }),
          ...(updates.exitWindowMinutes !== undefined && { exitWindowMinutes: updates.exitWindowMinutes }),
          updatedAt: new Date().toISOString()
        };
        
        await sessionsTable.updateEntity(updatedEntity, 'Merge');
        updatedCount++;
        context.log(`Updated session: ${sid}`);
      } catch (error: any) {
        context.error(`Error updating session ${sid}: ${error.message}`);
      }
    }

    return {
      status: 200,
      jsonBody: {
        success: true,
        message: `${updatedCount} session${updatedCount > 1 ? 's' : ''} updated successfully`,
        details: {
          sessionId,
          sessionsUpdated: updatedCount,
          updateScope: isRecurringSession ? updateScope : undefined,
          isRecurring: isRecurringSession
        }
      }
    };

  } catch (error: any) {
    context.error('Error updating session:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update session',
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('updateSession', {
  methods: ['PATCH', 'PUT'],
  route: 'sessions/{sessionId}',
  authLevel: 'anonymous',
  handler: updateSession
});
