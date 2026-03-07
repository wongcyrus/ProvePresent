/**
 * Get Snapshot Chain Traces API Endpoint
 * Returns detailed chain transfer data for a snapshot
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import { getSnapshotChainTraces } from '../utils/snapshotService';

export async function getSnapshotTrace(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing GET /api/sessions/{sessionId}/snapshots/{snapshotId}/chain-trace request');

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

    const sessionId = request.params.sessionId;
    const snapshotId = request.params.snapshotId;

    if (!sessionId || !snapshotId) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing sessionId or snapshotId', timestamp: Date.now() } }
      };
    }

    // Get tables
    const snapshotsTable = getTableClient(TableNames.ATTENDANCE_SNAPSHOTS);
    const chainsTable = getTableClient(TableNames.CHAINS);
    const scanLogsTable = getTableClient(TableNames.SCAN_LOGS);

    // Verify snapshot exists
    try {
      await snapshotsTable.getEntity(sessionId, snapshotId);
    } catch (error: any) {
      if (error.statusCode === 404) {
        return {
          status: 404,
          jsonBody: { error: { code: 'SNAPSHOT_NOT_FOUND', message: 'Snapshot not found', timestamp: Date.now() } }
        };
      }
      throw error;
    }

    // Get chain traces
    const traces = await getSnapshotChainTraces(
      sessionId,
      snapshotId,
      chainsTable,
      scanLogsTable,
      context
    );

    return {
      status: 200,
      jsonBody: {
        success: true,
        snapshotId,
        chains: traces,
        totalChains: traces.length,
        totalTransfers: traces.reduce((sum, t) => sum + t.totalTransfers, 0),
        successfulTransfers: traces.reduce((sum, t) => sum + t.successfulTransfers, 0),
        failedTransfers: traces.reduce((sum, t) => sum + t.failedTransfers, 0)
      }
    };
  } catch (error: any) {
    context.error('Error getting snapshot trace:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get snapshot trace',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('getSnapshotTrace', {
  methods: ['GET'],
  route: 'sessions/{sessionId}/snapshots/{snapshotId}/chain-trace',
  authLevel: 'anonymous',
  handler: getSnapshotTrace
});
