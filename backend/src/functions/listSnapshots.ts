/**
 * List Snapshots API Endpoint
 * Returns all snapshots for a session
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseUserPrincipal, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import { getSessionSnapshots } from '../utils/snapshotService';

export async function listSnapshots(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing GET /api/sessions/{sessionId}/snapshots request');

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

    if (!sessionId) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing sessionId', timestamp: Date.now() } }
      };
    }

    // Get tables
    const snapshotsTable = getTableClient(TableNames.ATTENDANCE_SNAPSHOTS);

    // Get all snapshots
    const snapshots = await getSessionSnapshots(sessionId, snapshotsTable);

    // Add computed fields
    const enrichedSnapshots = snapshots.map(snap => ({
      snapshotId: snap.rowKey,
      sessionId: snap.partitionKey,
      snapshotType: snap.snapshotType,
      snapshotIndex: snap.snapshotIndex,
      capturedAt: snap.capturedAt,
      capturedAtFormatted: new Date(snap.capturedAt * 1000).toLocaleString(),
      chainsCreated: snap.chainsCreated,
      studentsCaptured: snap.studentsCaptured,
      notes: snap.notes,
      createdAt: snap.createdAt
    }));

    return {
      status: 200,
      jsonBody: {
        success: true,
        sessionId,
        snapshots: enrichedSnapshots,
        totalSnapshots: enrichedSnapshots.length,
        entrySnapshots: enrichedSnapshots.filter(s => s.snapshotType === 'ENTRY').length,
        exitSnapshots: enrichedSnapshots.filter(s => s.snapshotType === 'EXIT').length
      }
    };
  } catch (error: any) {
    context.error('Error listing snapshots:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to list snapshots',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('listSnapshots', {
  methods: ['GET'],
  route: 'sessions/{sessionId}/snapshots',
  authLevel: 'anonymous',
  handler: listSnapshots
});
