/**
 * Close Chain API Endpoint
 * Marks the final holder as present and closes the chain
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseUserPrincipal, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import { broadcastAttendanceUpdate, broadcastChainUpdate } from '../utils/signalrBroadcast';

export async function closeChain(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/sessions/{sessionId}/chains/{chainId}/close request');

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

    const now = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
    const chainsTable = getTableClient(TableNames.CHAINS);
    const attendanceTable = getTableClient(TableNames.ATTENDANCE);
    const sessionsTable = getTableClient(TableNames.SESSIONS);
    const tokensTable = getTableClient(TableNames.TOKENS);

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

    const lastHolder = chain.lastHolder as string;
    
    if (!lastHolder) {
      return {
        status: 400,
        jsonBody: { error: { code: 'NO_HOLDER', message: 'Chain has no current holder', timestamp: now } }
      };
    }

    // Mark final holder based on chain phase
    try {
      const attendance = await attendanceTable.getEntity(sessionId, lastHolder);
      const chainPhase = chain.phase as string;
      
      if (chainPhase === 'ENTRY') {
        // Entry chain - mark entry status
        if (!attendance.entryStatus) {
          // Determine if late or present based on session start time
          const sessionStartTime = session.startTime as number;
          const lateCutoffMinutes = 15;
          const lateCutoffTime = sessionStartTime + (lateCutoffMinutes * 60);
          
          const entryStatus = now > lateCutoffTime ? 'LATE_ENTRY' : 'PRESENT_ENTRY';
          
          await attendanceTable.updateEntity({
            partitionKey: sessionId,
            rowKey: lastHolder,
            entryStatus,
            entryMethod: 'CHAIN',
            entryAt: now
          }, 'Merge');
          
          context.log(`Marked final holder ${lastHolder} as ${entryStatus} via CHAIN`);
          
          // Broadcast attendance update
          await broadcastAttendanceUpdate(sessionId, {
            studentId: lastHolder,
            entryStatus: entryStatus,
          }, context);
        }
      } else if (chainPhase === 'EXIT') {
        // Exit chain - mark exit verified
        if (!attendance.exitVerified) {
          await attendanceTable.updateEntity({
            partitionKey: sessionId,
            rowKey: lastHolder,
            exitVerified: true,
            exitMethod: 'CHAIN',
            exitedAt: now // Already in seconds
          }, 'Merge');
          
          context.log(`Marked final holder ${lastHolder} as exit verified via CHAIN`);
          
          // Broadcast attendance update
          await broadcastAttendanceUpdate(sessionId, {
            studentId: lastHolder,
            exitVerified: true,
          }, context);
        }
      }
    } catch (error: any) {
      context.log(`Warning: Could not update attendance for final holder: ${error.message}`);
    }

    // Mark chain as completed
    await chainsTable.updateEntity({
      partitionKey: sessionId,
      rowKey: chainId,
      state: 'COMPLETED',
      completedAt: now
    }, 'Merge');

    // Delete any remaining tokens for this chain
    const tokens = tokensTable.listEntities({
      queryOptions: {
        filter: `PartitionKey eq '${sessionId}' and chainId eq '${chainId}'`
      }
    });

    for await (const token of tokens) {
      await tokensTable.deleteEntity(sessionId, token.rowKey as string);
    }

    context.log(`Chain ${chainId} closed, final holder ${lastHolder} marked present`);

    // Broadcast chain update
    await broadcastChainUpdate(sessionId, {
      chainId,
      phase: chain.phase,
      lastHolder,
      lastSeq: chain.lastSeq,
      state: 'COMPLETED'
    }, context);

    return {
      status: 200,
      jsonBody: {
        success: true,
        chainId,
        finalHolder: lastHolder,
        markedPresent: true
      }
    };

  } catch (error: any) {
    context.error('Error closing chain:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to close chain',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('closeChain', {
  methods: ['POST'],
  route: 'sessions/{sessionId}/chains/{chainId}/close',
  authLevel: 'anonymous',
  handler: closeChain
});
