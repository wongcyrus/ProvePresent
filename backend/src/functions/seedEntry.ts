/**
 * Seed Entry API Endpoint - REFACTORED (Self-contained)
 * Creates initial entry chain holders
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseUserPrincipal, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import { randomUUID } from 'crypto';
import { broadcastChainUpdate } from '../utils/signalrBroadcast';

export async function seedEntry(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const traceId = randomUUID();
  context.log(`[seedEntry][${traceId}] Processing POST /api/sessions/{sessionId}/seed-entry request`);

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

    const sessionId = request.params.sessionId;
    const countParam = request.query.get('count');
    const count = countParam ? parseInt(countParam) : 3;
    context.log(`[seedEntry][${traceId}] request: sessionId=${sessionId || 'missing'}, count=${count}, principalId=${principalId || 'missing'}`);
    
    if (!sessionId) {
      context.warn(`[seedEntry][${traceId}] invalid request: missing sessionId`);
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing sessionId', traceId, details: { sessionId, count }, timestamp: Date.now() } }
      };
    }

    if (count <= 0 || count > 50) {
      context.warn(`[seedEntry][${traceId}] invalid request: count out of range, count=${count}, countParam=${countParam}`);
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Count must be between 1 and 50', traceId, details: { count, countParam }, timestamp: Date.now() } }
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

    const hasTeacherRole = hasRole(principal, 'Teacher') || hasRole(principal, 'teacher');
    const isSessionOwner = !!principalId && session.teacherId === principalId;
    context.log(`[seedEntry][${traceId}] auth: hasTeacherRole=${hasTeacherRole}, isSessionOwner=${isSessionOwner}, sessionTeacherId=${session.teacherId || 'missing'}`);
    if (!hasTeacherRole && !isSessionOwner) {
      context.warn(`[seedEntry][${traceId}] forbidden: principalId=${principalId || 'missing'} is not teacher/owner for session ${sessionId}`);
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Teacher role required', traceId, details: { principalId, sessionTeacherId: session.teacherId }, timestamp: Date.now() } }
      };
    }

    // Get all students enrolled in the session
    const attendanceTable = getTableClient(TableNames.ATTENDANCE);
    const attendanceRecords = attendanceTable.listEntities({
      queryOptions: { filter: `PartitionKey eq '${sessionId}'` }
    });

    const students: string[] = [];
    let totalAttendanceRecords = 0;
    let onlineStudents = 0;
    let eligibleStudents = 0;
    const now = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
    const onlineThreshold = 30; // Consider online if seen in last 30 seconds
    
    for await (const record of attendanceRecords) {
      totalAttendanceRecords += 1;

      // Include students who are still in session and currently online/recently active.
      // Note: entryStatus may already be set by direct join flow, so it cannot be used
      // as the sole eligibility gate for starting entry chains.
      const isOnline = record.isOnline === true;
      const lastSeen = record.lastSeen ? (record.lastSeen as number) : 0;
      const isRecentlyActive = (now - lastSeen) < onlineThreshold;
      const hasNotExited = !record.exitVerified && !(record as any).exitedAt;

      if (isOnline || isRecentlyActive) {
        onlineStudents += 1;
      }

      if (hasNotExited && (isOnline || isRecentlyActive)) {
        students.push(record.rowKey as string);
        eligibleStudents += 1;
      }
    }

    context.log(`[seedEntry][${traceId}] candidates: total=${totalAttendanceRecords}, online=${onlineStudents}, eligible=${eligibleStudents}`);

    if (students.length === 0) {
      context.warn(`[seedEntry][${traceId}] no students: session=${sessionId}, total=${totalAttendanceRecords}, online=${onlineStudents}, eligible=${eligibleStudents}`);
      return {
        status: 400,
        jsonBody: { 
          error: { 
            code: 'NO_STUDENTS', 
            message: 'No online students available to seed chains', 
            traceId,
            details: {
              sessionId,
              requestedCount: count,
              totalAttendanceRecords,
              onlineStudents,
              eligibleStudents,
              onlineThreshold
            },
            timestamp: Date.now() 
          } 
        }
      };
    }

    // Limit count to available students
    const actualCount = Math.min(count, students.length);
    
    // Randomly select initial holders
    const shuffled = students.sort(() => Math.random() - 0.5);
    const initialHolders = shuffled.slice(0, actualCount);
    context.log(`[seedEntry][${traceId}] selected holders: session=${sessionId}, requested=${count}, created=${actualCount}, holders=${initialHolders.join(',')}`);

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
        phase: 'ENTRY',
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
          phase: 'ENTRY'
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

      context.log(`[seedEntry][${traceId}] created chain ${chainId} holder=${holderId}`);
      
      // Broadcast chain update so student knows they're a holder
      await broadcastChainUpdate(sessionId, {
        chainId,
        phase: 'ENTRY',
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
        traceId
      }
    };

  } catch (error: any) {
    context.error(`[seedEntry][${traceId}] Error seeding entry chains:`, error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to seed entry chains',
          traceId,
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('seedEntry', {
  methods: ['POST'],
  route: 'sessions/{sessionId}/seed-entry',
  authLevel: 'anonymous',
  handler: seedEntry
});
