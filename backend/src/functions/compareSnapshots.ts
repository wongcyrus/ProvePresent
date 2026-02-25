/**
 * Compare Snapshots API Endpoint
 * Compares attendance between two snapshots
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseUserPrincipal, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import { compareSnapshots } from '../utils/snapshotService';

export async function compareSnapshotsHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/sessions/{sessionId}/snapshots/compare request');

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
    const snapshotId1 = request.query.get('snap1');
    const snapshotId2 = request.query.get('snap2');

    if (!sessionId || !snapshotId1 || !snapshotId2) {
      return {
        status: 400,
        jsonBody: { 
          error: { 
            code: 'INVALID_REQUEST', 
            message: 'Missing sessionId, snap1, or snap2 query parameter', 
            timestamp: Date.now() 
          } 
        }
      };
    }

    if (snapshotId1 === snapshotId2) {
      return {
        status: 400,
        jsonBody: { 
          error: { 
            code: 'SAME_SNAPSHOT', 
            message: 'Cannot compare a snapshot with itself', 
            timestamp: Date.now() 
          } 
        }
      };
    }

    // Get tables
    const snapshotsTable = getTableClient(TableNames.ATTENDANCE_SNAPSHOTS);
    const scanLogsTable = getTableClient(TableNames.SCAN_LOGS);

    // Verify both snapshots exist
    try {
      await snapshotsTable.getEntity(sessionId, snapshotId1);
      await snapshotsTable.getEntity(sessionId, snapshotId2);
    } catch (error: any) {
      if (error.statusCode === 404) {
        return {
          status: 404,
          jsonBody: { error: { code: 'SNAPSHOT_NOT_FOUND', message: 'One or both snapshots not found', timestamp: Date.now() } }
        };
      }
      throw error;
    }

    // Compare snapshots
    const comparison = await compareSnapshots(
      sessionId,
      snapshotId1,
      snapshotId2,
      scanLogsTable,
      context
    );

    return {
      status: 200,
      jsonBody: {
        success: true,
        comparison,
        summary: {
          newStudentsCount: comparison.differences.newStudents.length,
          absentStudentsCount: comparison.differences.absentStudents.length,
          duplicateScansCount: comparison.differences.duplicateScans.length,
          attendanceGrowth: comparison.differences.newStudents.length - comparison.differences.absentStudents.length
        }
      }
    };
  } catch (error: any) {
    context.error('Error comparing snapshots:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to compare snapshots',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('compareSnapshots', {
  methods: ['POST'],
  route: 'sessions/{sessionId}/snapshots/compare',
  authLevel: 'anonymous',
  handler: compareSnapshotsHandler
});
