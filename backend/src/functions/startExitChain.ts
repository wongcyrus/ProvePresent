/**
 * Start Exit Chain API Endpoint
 * Creates initial exit chain holders from students who have completed entry
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import { randomUUID } from 'crypto';
import { broadcastChainUpdate } from '../utils/signalrBroadcast';

export async function startExitChain(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/sessions/{sessionId}/start-exit-chain request');

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
    if (!hasRole(principal, 'Teacher') && !hasRole(principal, 'teacher')) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Teacher role required', timestamp: Date.now() } }
      };
    }

    const sessionId = request.params.sessionId;
    const countParam = request.query.get('count');
    const count = countParam ? parseInt(countParam) : 3;
    
    if (!sessionId) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing sessionId', timestamp: Date.now() } }
      };
    }

    if (count <= 0 || count > 50) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Count must be between 1 and 50', timestamp: Date.now() } }
      };
    }

    // Verify session exists
    const sessionsTable = getTableClient(TableNames.SESSIONS);
    let session;
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

    // Get all students who have completed entry (marked present)
    const attendanceTable = getTableClient(TableNames.ATTENDANCE);
    const attendanceRecords = attendanceTable.listEntities({
      queryOptions: { filter: `PartitionKey eq '${sessionId}'` }
    });

    const eligibleStudents: string[] = [];
    const now = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
    const onlineThreshold = 30; // Consider online if seen in last 30 seconds
    
    for await (const record of attendanceRecords) {
      // Only include students who:
      // 1. Have completed entry (entryStatus is set)
      // 2. Haven't exited yet (exitVerified is false)
      // 3. Are currently online (or recently active)
      const hasEntry = record.entryStatus === 'PRESENT_ENTRY' || record.entryStatus === 'LATE_ENTRY';
      const hasNotExited = !record.exitVerified;
      const isOnline = record.isOnline === true;
      const lastSeen = record.lastSeen ? (record.lastSeen as number) : 0;
      const isRecentlyActive = (now - lastSeen) < onlineThreshold;
      
      if (hasEntry && hasNotExited && (isOnline || isRecentlyActive)) {
        eligibleStudents.push(record.rowKey as string);
      }
    }

    if (eligibleStudents.length === 0) {
      return {
        status: 400,
        jsonBody: { 
          error: { 
            code: 'NO_STUDENTS', 
            message: 'No eligible students available for exit chains (students must have completed entry and be online)', 
            timestamp: Date.now() 
          } 
        }
      };
    }

    // Limit count to available students
    const actualCount = Math.min(count, eligibleStudents.length);
    
    // Randomly select initial holders
    const shuffled = eligibleStudents.sort(() => Math.random() - 0.5);
    const initialHolders = shuffled.slice(0, actualCount);

    // Create chains and tokens
    const chainsTable = getTableClient(TableNames.CHAINS);
    const tokensTable = getTableClient(TableNames.TOKENS);
    const expiresAt = now + 10; // 10 seconds

    for (let i = 0; i < actualCount; i++) {
      const chainId = randomUUID();
      const tokenId = randomUUID();
      const holderId = initialHolders[i];

      // Create chain entity
      const chainEntity = {
        partitionKey: sessionId,
        rowKey: chainId,
        phase: 'EXIT',
        index: i,
        state: 'ACTIVE',
        lastHolder: holderId,
        lastSeq: 0,
        lastAt: now,
        createdAt: now
      };
      await chainsTable.createEntity(chainEntity);

      // Record initial holder in chain history
      const chainHistoryTable = getTableClient(TableNames.CHAIN_HISTORY);
      try {
        await chainHistoryTable.createEntity({
          partitionKey: chainId,
          rowKey: `0000000000_${now}`,  // Sequence 0
          sessionId,
          chainId,
          sequence: 0,
          fromHolder: 'TEACHER',  // Initial seed
          toHolder: holderId,
          scannedAt: now,
          phase: 'EXIT'
        });
      } catch (historyError: any) {
        context.log(`Warning: Failed to record initial chain history: ${historyError.message}`);
      }

      // Create token entity
      const tokenEntity = {
        partitionKey: sessionId,
        rowKey: tokenId,
        chainId,
        holderId,
        seq: 0,
        expiresAt,
        createdAt: now
      };
      await tokensTable.createEntity(tokenEntity);

      context.log(`Created exit chain ${chainId} with holder ${holderId}`);
      
      // Broadcast chain update so student knows they're a holder
      await broadcastChainUpdate(sessionId, {
        chainId,
        phase: 'EXIT',
        lastHolder: holderId,
        lastSeq: 0,
        state: 'ACTIVE'
      }, context);
    }

    return {
      status: 201,
      jsonBody: {
        chainsCreated: actualCount,
        initialHolders,
        phase: 'EXIT'
      }
    };

  } catch (error: any) {
    context.error('Error starting exit chains:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to start exit chains',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('startExitChain', {
  methods: ['GET', 'POST'],
  route: 'sessions/{sessionId}/start-exit-chain',
  authLevel: 'anonymous',
  handler: startExitChain
});
