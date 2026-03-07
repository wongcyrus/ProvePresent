/**
 * Get Capture Results API Endpoint
 * 
 * GET /api/sessions/{sessionId}/capture/{captureRequestId}/results
 * 
 * This function allows teachers to retrieve capture results:
 * 1. Validates teacher authentication and session ownership
 * 2. Retrieves capture request from Table Storage
 * 3. Returns results based on status:
 *    - ACTIVE: Returns 202 with progress (still capturing)
 *    - ANALYZING: Returns 202 with progress (analysis in progress)
 *    - COMPLETED: Returns 200 with full results including positions
 *    - FAILED: Returns 200 with error message
 * 
 * Validates: Requirements 6.3, 8.4
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import {
  GetCaptureResultsResponse,
  CaptureErrorCode,
  SeatingPosition
} from '../types/studentImageCapture';
import { getCaptureRequest, getCaptureResult } from '../utils/captureStorage';

/**
 * Get capture results for a capture request
 * 
 * This function implements Task 9:
 * - Task 9.1: Create HTTP trigger function with proper routing
 * - Task 9.2: Return results based on status
 * 
 * Response varies by capture request status:
 * - ACTIVE/ANALYZING: 202 Accepted (still processing)
 * - COMPLETED: 200 OK with positions and analysis
 * - FAILED: 200 OK with error message
 */
export async function getCaptureResults(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing GET /api/sessions/{sessionId}/capture/{captureRequestId}/results request');

  try {
    // ========================================================================
    // Step 1: Validate teacher authentication
    // ========================================================================
    
    const principal = parseAuthFromRequest(request);
    
    if (!principal) {
      return {
        status: 401,
        jsonBody: {
          error: {
            code: CaptureErrorCode.UNAUTHORIZED,
            message: 'Missing authentication header',
            timestamp: Date.now()
          }
        }
      };
    }    
    // Require Teacher role
    if (!hasRole(principal, 'Teacher') && !hasRole(principal, 'teacher')) {
      return {
        status: 403,
        jsonBody: {
          error: {
            code: CaptureErrorCode.FORBIDDEN,
            message: 'Teacher role required',
            timestamp: Date.now()
          }
        }
      };
    }

    const teacherId = getUserId(principal);
    const sessionId = request.params.sessionId;
    const captureRequestId = request.params.captureRequestId;
    
    if (!sessionId) {
      return {
        status: 400,
        jsonBody: {
          error: {
            code: CaptureErrorCode.INVALID_REQUEST,
            message: 'Missing sessionId',
            timestamp: Date.now()
          }
        }
      };
    }

    if (!captureRequestId) {
      return {
        status: 400,
        jsonBody: {
          error: {
            code: CaptureErrorCode.INVALID_REQUEST,
            message: 'Missing captureRequestId',
            timestamp: Date.now()
          }
        }
      };
    }

    context.log(`Get results - Session: ${sessionId}, Capture: ${captureRequestId}, Teacher: ${teacherId}`);

    // ========================================================================
    // Step 2: Verify session exists and teacher owns it
    // ========================================================================
    
    const sessionsTable = getTableClient(TableNames.SESSIONS);
    let session: any;
    
    try {
      session = await sessionsTable.getEntity('SESSION', sessionId);
    } catch (error: any) {
      if (error.statusCode === 404) {
        return {
          status: 404,
          jsonBody: {
            error: {
              code: CaptureErrorCode.SESSION_NOT_FOUND,
              message: 'Session not found',
              timestamp: Date.now()
            }
          }
        };
      }
      throw error;
    }

    // Verify ownership
    if (session.teacherId !== teacherId) {
      return {
        status: 403,
        jsonBody: {
          error: {
            code: CaptureErrorCode.FORBIDDEN,
            message: 'You do not own this session',
            timestamp: Date.now()
          }
        }
      };
    }

    // ========================================================================
    // Step 3: Retrieve capture request
    // ========================================================================
    
    const captureRequest = await getCaptureRequest(captureRequestId);
    
    if (!captureRequest) {
      context.log(`Capture request not found: ${captureRequestId}`);
      return {
        status: 404,
        jsonBody: {
          error: {
            code: CaptureErrorCode.CAPTURE_NOT_FOUND,
            message: 'Capture request not found',
            timestamp: Date.now()
          }
        }
      };
    }

    // Verify session ID matches
    if (captureRequest.sessionId !== sessionId) {
      context.log(`Session ID mismatch: expected ${captureRequest.sessionId}, got ${sessionId}`);
      return {
        status: 400,
        jsonBody: {
          error: {
            code: CaptureErrorCode.INVALID_REQUEST,
            message: 'Session ID does not match capture request',
            timestamp: Date.now()
          }
        }
      };
    }

    context.log(`Capture request status: ${captureRequest.status}`);

    // ========================================================================
    // Step 4: Return results based on status
    // ========================================================================
    
    const baseResponse: GetCaptureResultsResponse = {
      captureRequestId: captureRequest.rowKey,
      status: captureRequest.status,
      uploadedCount: captureRequest.uploadedCount,
      totalCount: captureRequest.onlineStudentCount
    };

    // Handle different statuses
    switch (captureRequest.status) {
      case 'ACTIVE':
      case 'EXPIRED':
        // Still capturing or just expired, analysis not started yet
        context.log(`Capture still in progress: ${captureRequest.uploadedCount}/${captureRequest.onlineStudentCount} uploaded`);
        return {
          status: 202, // Accepted - still processing
          jsonBody: baseResponse
        };

      case 'ANALYZING':
        // Analysis in progress
        context.log('Analysis in progress');
        return {
          status: 202, // Accepted - still processing
          jsonBody: baseResponse
        };

      case 'COMPLETED':
        // Analysis completed successfully - retrieve results
        context.log('Retrieving completed analysis results');
        
        const captureResult = await getCaptureResult(captureRequestId);
        
        if (!captureResult) {
          // This shouldn't happen - status is COMPLETED but no results
          context.error('Capture marked as COMPLETED but no results found');
          return {
            status: 500,
            jsonBody: {
              error: {
                code: CaptureErrorCode.INTERNAL_ERROR,
                message: 'Results not found for completed capture',
                timestamp: Date.now()
              }
            }
          };
        }

        // Parse positions from JSON string
        const positions: SeatingPosition[] = JSON.parse(captureResult.positions);
        
        // Retrieve image URLs for all students with fresh SAS tokens
        // Note: SAS URLs are regenerated on each request to ensure they're always valid
        const imageUrls: Record<string, string> = {};
        const uploadsTable = getTableClient(TableNames.CAPTURE_UPLOADS);
        
        try {
          const uploads = uploadsTable.listEntities({
            queryOptions: {
              filter: `PartitionKey eq '${captureRequestId}'`
            }
          });
          
          for await (const upload of uploads) {
            const studentId = upload.rowKey as string;
            const blobUrl = upload.blobUrl as string;
            if (studentId && blobUrl) {
              // Generate fresh read SAS URL with 1-year expiry for long-term viewing
              const { generateReadSasUrl } = await import('../utils/blobStorage');
              const sasUrl = generateReadSasUrl(blobUrl);
              imageUrls[studentId] = sasUrl;
            }
          }
          
          context.log(`Generated fresh SAS URLs for ${Object.keys(imageUrls).length} images`);
        } catch (error: any) {
          context.warn('Failed to retrieve image URLs:', error);
          // Continue without images - not critical
        }
        
        const completedResponse: GetCaptureResultsResponse = {
          ...baseResponse,
          positions,
          imageUrls,
          analysisNotes: captureResult.analysisNotes,
          analyzedAt: captureResult.analyzedAt
        };

        context.log(`Returning completed results with ${positions.length} positions and ${Object.keys(imageUrls).length} images`);
        
        return {
          status: 200,
          jsonBody: completedResponse
        };

      case 'FAILED':
        // Analysis failed
        context.log(`Analysis failed: ${captureRequest.errorMessage}`);
        
        const failedResponse: GetCaptureResultsResponse = {
          ...baseResponse,
          errorMessage: captureRequest.errorMessage || 'Analysis failed'
        };

        return {
          status: 200,
          jsonBody: failedResponse
        };

      default:
        // Unknown status
        context.error(`Unknown capture request status: ${captureRequest.status}`);
        return {
          status: 500,
          jsonBody: {
            error: {
              code: CaptureErrorCode.INTERNAL_ERROR,
              message: 'Unknown capture request status',
              timestamp: Date.now()
            }
          }
        };
    }

  } catch (error: any) {
    context.error('Error retrieving capture results:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: CaptureErrorCode.INTERNAL_ERROR,
          message: 'Failed to retrieve capture results',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

// Register the Azure Function
app.http('getCaptureResults', {
  methods: ['GET'],
  route: 'sessions/{sessionId}/capture/{captureRequestId}/results',
  authLevel: 'anonymous',
  handler: getCaptureResults
});
