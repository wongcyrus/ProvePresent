/**
 * Get Capture History API Endpoint
 * 
 * GET /api/sessions/{sessionId}/capture/history
 * 
 * This function allows teachers to retrieve all capture requests for a session.
 * Returns a list of capture requests with their status and upload counts.
 * 
 * Requirements: 8.4
 * 
 * Validates: Requirements 8.4 (Historical data retrieval)
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getTableClient, TableNames } from '../utils/database';
import { CaptureErrorCode } from '../types/studentImageCapture';

interface CaptureHistoryItem {
  captureRequestId: string;
  createdAt: string;
  status: 'ACTIVE' | 'EXPIRED' | 'ANALYZING' | 'COMPLETED' | 'FAILED';
  uploadedCount: number;
  totalCount: number;
}

interface CaptureHistoryResponse {
  sessionId: string;
  captures: CaptureHistoryItem[];
}

/**
 * Get capture history for a session
 * 
 * Returns all capture requests for the session, ordered by creation time (newest first)
 */
export async function getCaptureHistory(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing GET /api/sessions/{sessionId}/capture/history request');

  try {
    // ========================================================================
    // 1. Extract and validate parameters
    // ========================================================================
    
    const sessionId = request.params.sessionId;
    
    if (!sessionId) {
      context.warn('Missing sessionId parameter');
      return {
        status: 400,
        jsonBody: {
          error: {
            code: CaptureErrorCode.INVALID_REQUEST,
            message: 'Session ID is required',
            timestamp: Date.now()
          }
        }
      };
    }

    context.log(`Fetching capture history for session: ${sessionId}`);

    // ========================================================================
    // 2. Authenticate and authorize
    // ========================================================================
    
    // TODO: Add authentication check
    // - Verify user is authenticated
    // - Verify user is a teacher
    // - Verify user owns the session
    // For now, we'll proceed without auth (to be added in production)

    // ========================================================================
    // 3. Query capture requests for the session
    // ========================================================================
    
    const captureRequestsTable = getTableClient(TableNames.CAPTURE_REQUESTS);
    
    // Query all capture requests with this sessionId
    const captureRequests: CaptureHistoryItem[] = [];
    
    const entities = captureRequestsTable.listEntities({
      queryOptions: {
        filter: `sessionId eq '${sessionId}'`
      }
    });

    for await (const entity of entities) {
      captureRequests.push({
        captureRequestId: entity.rowKey as string,
        createdAt: entity.createdAt as string,
        status: entity.status as any,
        uploadedCount: (entity.uploadedCount as number) || 0,
        totalCount: (entity.onlineStudentCount as number) || 0
      });
    }

    // Sort by creation time (newest first)
    captureRequests.sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    context.log(`Found ${captureRequests.length} capture requests for session ${sessionId}`);

    // ========================================================================
    // 4. Return response
    // ========================================================================
    
    const response: CaptureHistoryResponse = {
      sessionId,
      captures: captureRequests
    };

    return {
      status: 200,
      jsonBody: response
    };

  } catch (error: any) {
    context.error('Error retrieving capture history:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: CaptureErrorCode.INTERNAL_ERROR,
          message: 'Failed to retrieve capture history',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

// Register the Azure Function
app.http('getCaptureHistory', {
  methods: ['GET'],
  route: 'sessions/{sessionId}/capture/history',
  authLevel: 'anonymous',
  handler: getCaptureHistory
});
