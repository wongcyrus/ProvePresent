/**
 * Take Snapshot API Endpoint
 * Creates a snapshot of current attendance by starting chains on demand
 * Records who is present at this specific moment in time
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import { randomUUID } from 'crypto';
import { broadcastChainUpdate } from '../utils/signalrBroadcast';

export async function takeSnapshot(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/sessions/{sessionId}/snapshot request');

  try {
    // Parse authentication
    const principal = parseAuthFromRequest(request);
    if (!principal) {
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Missing authentication header', timestamp: Math.floor(Date.now() / 1000) } }
      };
    }    
    // Require Teacher role
    if (!hasRole(principal, 'Teacher')) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Teacher role required', timestamp: Math.floor(Date.now() / 1000) } }
      };
    }

    const sessionId = request.params.sessionId;
    const count = parseInt(request.query.get('count') || '3', 10);
    
    if (!sessionId) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing sessionId', timestamp: Math.floor(Date.now() / 1000) } }
      };
    }

    if (count < 1 || count > 20) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Count must be between 1 and 20', timestamp: Math.floor(Date.now() / 1000) } }
      };
    }

    const now = Math.floor(Date.now() / 1000); // Unix timestamp in seconds

    // Get tables
    const sessionsTable = getTableClient(TableNames.SESSIONS);
    const attendanceTable = getTableClient(TableNames.ATTENDANCE);
    const chainsTable = getTableClient(TableNames.CHAINS);
    const tokensTable = getTableClient(TableNames.TOKENS);
    const snapshotsTable = getTableClient(TableNames.ATTENDANCE_SNAPSHOTS);

    // Verify session exists
    let session;
    try {
      session = await sessionsTable.getEntity('SESSION', sessionId);
    } catch (error: any) {
      if (error.statusCode === 404) {
        return {
          status: 404,
          jsonBody: { error: { code: 'SESSION_NOT_FOUND', message: 'Session not found', timestamp: now } }
        };
      }
      throw error;
    }

    // Get all online students
    const onlineStudents: string[] = [];
    const onlineThreshold = 30; // Consider online if seen in last 30 seconds
    
    try {
      for await (const entity of attendanceTable.listEntities({
        queryOptions: {
          filter: `PartitionKey eq '${sessionId}'`
        }
      })) {
        const lastSeen = entity.lastSeen as number || 0;
        const isOnline = entity.isOnline === true;
        const isRecentlyActive = (now - lastSeen) < onlineThreshold;
        
        if (isOnline || isRecentlyActive) {
          onlineStudents.push(entity.rowKey as string);
        }
      }
    } catch (error) {
      context.warn(`Warning: Could not fetch online students: ${error}`);
    }

    if (onlineStudents.length === 0) {
      return {
        status: 400,
        jsonBody: { error: { code: 'NO_STUDENTS', message: 'No online students available', timestamp: now } }
      };
    }

    // Get existing snapshot count to determine snapshotIndex
    let snapshotIndex = 1;
    try {
      let snapshotCount = 0;
      for await (const entity of snapshotsTable.listEntities({
        queryOptions: {
          filter: `PartitionKey eq '${sessionId}'`
        }
      })) {
        snapshotCount++;
      }
      snapshotIndex = snapshotCount + 1;
    } catch (error) {
      context.warn(`Warning: Could not determine snapshot index: ${error}`);
    }

    // Create snapshot record
    const snapshotId = randomUUID();
    await snapshotsTable.createEntity({
      partitionKey: sessionId,
      rowKey: snapshotId,
      snapshotIndex,
      capturedAt: now,
      totalStudents: onlineStudents.length,
      chainsCreated: Math.min(count, onlineStudents.length),
      status: 'ACTIVE'
    });

    // Select random students and create chains
    const actualCount = Math.min(count, onlineStudents.length);
    const selectedStudents: string[] = [];
    
    // Fisher-Yates shuffle
    const shuffled = [...onlineStudents];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    for (let i = 0; i < actualCount; i++) {
      selectedStudents.push(shuffled[i]);
    }

    // Create chains
    const tokenTTL = 10; // 10 seconds
    const expiresAt = now + tokenTTL;

    for (let i = 0; i < actualCount; i++) {
      const chainId = randomUUID();
      const tokenId = randomUUID();
      const holderId = selectedStudents[i];

      // Create chain entity with snapshot reference
      const chainEntity = {
        partitionKey: sessionId,
        rowKey: chainId,
        phase: 'SNAPSHOT',
        snapshotId,
        snapshotIndex,
        index: i,
        state: 'ACTIVE',
        lastHolder: holderId,
        lastSeq: 0,
        lastAt: now,
        createdAt: now
      };
      await chainsTable.createEntity(chainEntity);

      // Create initial token
      const tokenEntity = {
        partitionKey: sessionId,
        rowKey: tokenId,
        chainId,
        snapshotId,
        holderId,
        seq: 0,
        expiresAt,
        createdAt: now
      };
      await tokensTable.createEntity(tokenEntity);

      // Broadcast so student sees their QR code
      await broadcastChainUpdate(sessionId, {
        chainId,
        phase: 'SNAPSHOT',
        lastHolder: holderId,
        lastSeq: 0,
        state: 'ACTIVE'
      }, context);
    }

    context.log(`Snapshot #${snapshotIndex} created: ${snapshotId}, chains: ${actualCount}`);

    return {
      status: 200,
      jsonBody: {
        success: true,
        snapshotId,
        snapshotIndex,
        chainsCreated: actualCount,
        totalStudents: onlineStudents.length,
        initialHolders: selectedStudents
      }
    };
  } catch (error: any) {
    context.error('Error taking snapshot:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to take snapshot',
          details: error.message,
          timestamp: Math.floor(Date.now() / 1000)
        }
      }
    };
  }
}

app.http('takeSnapshot', {
  methods: ['POST'],
  route: 'sessions/{sessionId}/snapshot',
  authLevel: 'anonymous',
  handler: takeSnapshot
});
