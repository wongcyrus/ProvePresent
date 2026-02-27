/**
 * Notify Image Upload API Endpoint
 * 
 * POST /api/sessions/{sessionId}/capture/{captureRequestId}/upload
 * 
 * This function handles student upload completion notifications:
 * 1. Validates student authentication
 * 2. Extracts sessionId, captureRequestId, blobName from request
 * 3. Validates timing and blob existence (Task 5.2)
 * 4. Records upload in Table Storage (Task 5.3)
 * 5. Notifies teacher via SignalR (Task 5.4)
 * 6. Returns success response (Task 5.5)
 * 
 * Validates: Requirements 3.3
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import * as df from 'durable-functions';
import { parseUserPrincipal, hasRole, getUserId } from '../utils/auth';
import {
  NotifyUploadRequest,
  NotifyUploadResponse,
  CaptureErrorCode,
  CaptureUpload,
  UploadCompleteEvent
} from '../types/studentImageCapture';
import { getCaptureRequest, updateCaptureRequest, createCaptureUpload } from '../utils/captureStorage';
import { verifyBlobExists, STUDENT_CAPTURES_CONTAINER } from '../utils/blobStorage';
import { broadcastToHub } from '../utils/signalrBroadcast';
import { logError, logInfo, logWarning } from '../utils/errorLogging';

/**
 * Handle student upload completion notification
 * 
 * This is task 5.1 - creates the function skeleton with:
 * - Student authentication validation
 * - Parameter extraction (sessionId, captureRequestId, blobName)
 * 
 * Subsequent tasks (5.2-5.5) will add:
 * - Timing validation and blob verification
 * - Table Storage recording
 * - SignalR teacher notification
 * - Response handling
 */
export async function notifyImageUpload(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/sessions/{sessionId}/capture/{captureRequestId}/upload request');

  let sessionId: string | undefined;
  let captureRequestId: string | undefined;
  let studentId: string | undefined;

  try {
    // ========================================================================
    // Step 1: Validate student authentication
    // ========================================================================
    
    const principalHeader = request.headers.get('x-ms-client-principal') || 
                           request.headers.get('x-client-principal');
    
    if (!principalHeader) {
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

    const principal = parseUserPrincipal(principalHeader);
    
    // Require Student role
    if (!hasRole(principal, 'Student') && !hasRole(principal, 'student')) {
      return {
        status: 403,
        jsonBody: {
          error: {
            code: CaptureErrorCode.FORBIDDEN,
            message: 'Student role required',
            timestamp: Date.now()
          }
        }
      };
    }

    studentId = getUserId(principal);
    context.log(`Student authenticated: ${studentId}`);

    // ========================================================================
    // Step 2: Extract sessionId, captureRequestId, blobName from request
    // ========================================================================
    
    sessionId = request.params.sessionId;
    captureRequestId = request.params.captureRequestId;
    
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

    // Parse request body
    let body: NotifyUploadRequest;
    try {
      const bodyText = await request.text();
      body = JSON.parse(bodyText) as NotifyUploadRequest;
    } catch (error) {
      return {
        status: 400,
        jsonBody: {
          error: {
            code: CaptureErrorCode.INVALID_REQUEST,
            message: 'Invalid JSON body',
            timestamp: Date.now()
          }
        }
      };
    }

    const { blobName } = body;
    
    if (!blobName) {
      return {
        status: 400,
        jsonBody: {
          error: {
            code: CaptureErrorCode.INVALID_REQUEST,
            message: 'Missing blobName in request body',
            timestamp: Date.now()
          }
        }
      };
    }

    context.log(`Upload notification - Session: ${sessionId}, Capture: ${captureRequestId}, Blob: ${blobName}`);
    context.log(`Blob name details - Length: ${blobName.length}, Contains @: ${blobName.includes('@')}, Contains %40: ${blobName.includes('%40')}`);

    // ========================================================================
    // Task 5.2: Validate timing and blob existence
    // ========================================================================
    
    // Check if capture request exists and is still active
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

    // Check if capture window has expired
    const now = new Date();
    const expiresAt = new Date(captureRequest.expiresAt);
    
    if (now > expiresAt) {
      context.log(`Capture window expired at ${expiresAt.toISOString()}, current time: ${now.toISOString()}`);
      return {
        status: 400,
        jsonBody: {
          error: {
            code: CaptureErrorCode.CAPTURE_EXPIRED,
            message: 'Capture window has expired',
            timestamp: Date.now()
          }
        }
      };
    }

    // Verify blob exists in storage
    const blobExists = await verifyBlobExists(blobName);
    
    if (!blobExists) {
      context.log(`Blob not found: ${blobName}`);
      return {
        status: 400,
        jsonBody: {
          error: {
            code: CaptureErrorCode.BLOB_NOT_FOUND,
            message: 'Uploaded blob not found in storage',
            timestamp: Date.now()
          }
        }
      };
    }

    context.log(`Validation passed - blob exists and capture window is active`);

    // ========================================================================
    // Task 5.3: Record upload in Table Storage
    // ========================================================================
    
    const uploadedAt = new Date().toISOString();
    const uploadedAtTimestamp = Date.now();
    
    // Create CaptureUpload entity
    const captureUpload: CaptureUpload = {
      partitionKey: captureRequestId,
      rowKey: studentId,
      sessionId: sessionId,
      blobName: blobName,
      blobUrl: `https://${process.env.AzureWebJobsStorage?.match(/AccountName=([^;]+)/)?.[1]}.blob.core.windows.net/${STUDENT_CAPTURES_CONTAINER}/${blobName}`,
      uploadedAt: uploadedAt,
      fileSizeBytes: 0 // Will be populated by blob metadata if needed
    };

    await createCaptureUpload(captureUpload);
    context.log(`Created CaptureUpload record for student: ${studentId}`);

    // Increment uploadedCount in CaptureRequest
    const updatedRequest = await updateCaptureRequest(captureRequestId, {
      uploadedCount: captureRequest.uploadedCount + 1
    });
    
    const uploadedCount = updatedRequest.uploadedCount;
    const totalCount = updatedRequest.onlineStudentCount;
    
    context.log(`Upload count updated: ${uploadedCount}/${totalCount}`);

    // ========================================================================
    // Task 5.4: Notify teacher via SignalR
    // ========================================================================
    
    const uploadCompleteEvent: UploadCompleteEvent = {
      captureRequestId: captureRequestId,
      studentId: studentId,
      uploadedAt: uploadedAtTimestamp,
      uploadedCount: uploadedCount,
      totalCount: totalCount
    };

    await broadcastToHub(
      sessionId,
      'uploadComplete',
      uploadCompleteEvent,
      context
    );
    
    context.log(`Broadcast uploadComplete event to teacher`);

    // ========================================================================
    // Task 6.2-6.5: Check for early termination and raise external event
    // ========================================================================
    
    // Check if all students have uploaded
    if (uploadedCount === totalCount) {
      context.log(`All students uploaded for capture: ${captureRequestId} (${uploadedCount}/${totalCount})`);
      
      // Get Durable Functions client
      const client = df.getClient(context);
      
      try {
        // Raise external event to orchestrator for early termination
        await client.raiseEvent(
          captureRequestId, // instance ID (same as captureRequestId)
          'allUploadsComplete', // event name
          { uploadedCount, totalCount } // event payload
        );
        
        context.log(`Raised allUploadsComplete event for capture: ${captureRequestId}`);
        
      } catch (error: any) {
        // Log warning but don't fail the upload notification
        // Orchestrator will still complete via timer if event fails
        context.warn(`Failed to raise external event for early termination: ${error.message} (captureRequestId: ${captureRequestId}, uploadedCount: ${uploadedCount}/${totalCount})`);
      }
    }

    // ========================================================================
    // Task 5.5: Return success response
    // ========================================================================
    
    const response: NotifyUploadResponse = {
      success: true,
      uploadedAt: uploadedAtTimestamp
    };

    context.log(`Upload notification processed successfully for student: ${studentId}`);

    logInfo(context, 'Upload notification processed successfully', {
      sessionId,
      captureRequestId,
      studentId
    });

    return {
      status: 200,
      jsonBody: response
    };

  } catch (error: any) {
    logError(
      context,
      'Failed to process upload notification',
      error,
      {
        sessionId,
        captureRequestId,
        studentId,
        errorType: error.name,
        errorCode: CaptureErrorCode.INTERNAL_ERROR
      }
    );
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: CaptureErrorCode.INTERNAL_ERROR,
          message: 'Failed to process upload notification',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

// Register the Azure Function
app.http('notifyImageUpload', {
  methods: ['POST'],
  route: 'sessions/{sessionId}/capture/{captureRequestId}/upload',
  authLevel: 'anonymous',
  extraInputs: [df.input.durableClient()],
  handler: notifyImageUpload
});
