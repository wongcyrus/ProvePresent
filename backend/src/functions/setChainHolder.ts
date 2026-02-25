/**
 * Set Chain Holder API Endpoint
 * Manually assign a student as the current holder of a chain
 * Used when teacher needs to help the last student take the holder status
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseUserPrincipal, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import { broadcastAttendanceUpdate, broadcastChainUpdate } from '../utils/signalrBroadcast';

export async function setChainHolder(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/sessions/{sessionId}/chains/{chainId}/set-holder request');

  try {
    // Parse authentication
    const principalHeader = request.headers.get('x-ms-client-principal') || request.headers.get('x-client-principal');
    if (!principalHeader) {
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Missing authentication header', timestamp: Date.now() } }
      };
    }

    const principal = parseUserPrincipal(principalHeader);
    const principalId = principal.userDetails || principal.userId;
    
    // Require Teacher role
    if (!hasRole(principal, 'Teacher')) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Teacher role required', timestamp: Date.now() } }
      };
    }

    const sessionId = request.params.sessionId;
    const chainId = request.params.chainId;
    
    if (!sessionId || !chainId) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing sessionId or chainId', timestamp: Date.now() } }
      };
    }

    context.log(`[setChainHolder] request: sessionId=${sessionId}, chainId=${chainId}, principalId=${principalId || 'missing'}`);

    // Parse request body
    const body = await request.json() as any;
    const studentId = body.studentId;

    if (!studentId) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing studentId in request body', timestamp: Date.now() } }
      };
    }

    const now = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
    const chainsTable = getTableClient(TableNames.CHAINS);
    const attendanceTable = getTableClient(TableNames.ATTENDANCE);
    const sessionsTable = getTableClient(TableNames.SESSIONS);

    // Verify session exists
    let session;
    try {
      session = await sessionsTable.getEntity('SESSION', sessionId);
    } catch (error: any) {
      if (error.statusCode === 404) {
        return {
          status: 404,
          jsonBody: { error: { code: 'NOT_FOUND', message: 'Session not found', timestamp: now } }
        };
      }
      throw error;
    }

    const hasTeacherRole = hasRole(principal, 'Teacher') || hasRole(principal, 'teacher');
    const isSessionOwner = !!principalId && session.teacherId === principalId;
    context.log(`[setChainHolder] auth: hasTeacherRole=${hasTeacherRole}, isSessionOwner=${isSessionOwner}, sessionTeacherId=${session.teacherId || 'missing'}`);
    if (!hasTeacherRole && !isSessionOwner) {
      context.warn(`[setChainHolder] forbidden: principalId=${principalId || 'missing'} is not teacher/owner for session ${sessionId}`);
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Teacher role required', timestamp: Date.now() } }
      };
    }

    // Get chain
    let chain;
    try {
      chain = await chainsTable.getEntity(sessionId, chainId);
    } catch (error: any) {
      if (error.statusCode === 404) {
        return {
          status: 404,
          jsonBody: { error: { code: 'NOT_FOUND', message: 'Chain not found', timestamp: now } }
        };
      }
      throw error;
    }

    // Verify student is in attendance
    try {
      await attendanceTable.getEntity(sessionId, studentId);
    } catch (error: any) {
      if (error.statusCode === 404) {
        context.warn(`[setChainHolder] student missing in attendance: session=${sessionId}, studentId=${studentId}`);
        return {
          status: 404,
          jsonBody: { error: { code: 'NOT_FOUND', message: 'Student not found in session', timestamp: now } }
        };
      }
      throw error;
    }

    const currentSeq = (chain.lastSeq as number) || 0;
    const newSeq = currentSeq + 1;

    // Update chain with new holder
    await chainsTable.updateEntity({
      partitionKey: sessionId,
      rowKey: chainId,
      lastHolder: studentId,
      lastSeq: newSeq,
      lastAt: now,
      state: 'ACTIVE'
    }, 'Merge');

    context.log(`[setChainHolder] updated: chain=${chainId}, newHolder=${studentId}, seq=${newSeq}`);

    // Broadcast chain update
    await broadcastChainUpdate(sessionId, {
      chainId,
      phase: chain.phase,
      lastHolder: studentId,
      lastSeq: newSeq,
      state: 'ACTIVE'
    }, context);

    return {
      status: 200,
      jsonBody: {
        success: true,
        chainId,
        newHolder: studentId,
        sequence: newSeq
      }
    };

  } catch (error: any) {
    context.error('[setChainHolder] Error setting chain holder:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to set chain holder',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('setChainHolder', {
  methods: ['POST'],
  route: 'sessions/{sessionId}/chains/{chainId}/set-holder',
  authLevel: 'anonymous',
  handler: setChainHolder
});
