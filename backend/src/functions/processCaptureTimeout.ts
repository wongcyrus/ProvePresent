/**
 * Process Capture Timeout Timer Function
 * 
 * Timer Trigger: Runs every 10 seconds
 * 
 * This function handles capture window expiration and triggers position estimation:
 * 1. Queries CaptureRequests table for expired requests (expiresAt < now, status = ACTIVE)
 * 2. For each expired request:
 *    - Marks status as 'ANALYZING'
 *    - Queries CaptureUploads for all uploaded images
 *    - Broadcasts captureExpired event to all students and teacher
 *    - Triggers GPT position estimation (if uploads > 0)
 *    - Updates status to 'COMPLETED' or 'FAILED'
 *    - Broadcasts results to teacher
 * 
 * Validates: Requirements 5.1, 5.2, 5.3, 6.1, 7.3
 */

import { app, InvocationContext, Timer } from '@azure/functions';
import { getTableClient } from '../utils/database';
import {
  CaptureRequest,
  CaptureExpiredEvent,
  CaptureResultsEvent,
  CaptureResult,
  PositionEstimationInput
} from '../types/studentImageCapture';
import {
  CaptureTableNames,
  getCaptureRequest,
  updateCaptureRequest,
  getCaptureUploads,
  createCaptureResult
} from '../utils/captureStorage';
import { broadcastToHub } from '../utils/signalrBroadcast';
import { estimateSeatingPositions } from '../utils/gptPositionEstimation';
import { logError, logInfo, logWarning } from '../utils/errorLogging';

/**
 * Process expired capture requests
 * 
 * This timer function runs every 10 seconds to check for expired capture requests
 * and trigger the analysis workflow.
 */
export async function processCaptureTimeout(
  myTimer: Timer,
  context: InvocationContext
): Promise<void> {
  context.log('Timer trigger: Processing capture timeouts');
  
  try {
    // ========================================================================
    // Task 6.1: Query CaptureRequests table for expired requests
    // ========================================================================
    
    const captureRequestsTable = getTableClient(CaptureTableNames.CAPTURE_REQUESTS);
    const now = new Date();
    const expiredRequests: CaptureRequest[] = [];
    
    context.log(`Checking for expired capture requests (current time: ${now.toISOString()})`);
    
    // Query all ACTIVE capture requests
    for await (const entity of captureRequestsTable.listEntities<CaptureRequest>({
      queryOptions: {
        filter: `PartitionKey eq 'CAPTURE_REQUEST' and status eq 'ACTIVE'`
      }
    })) {
      const expiresAt = new Date(entity.expiresAt);
      
      // Check if expired
      if (now > expiresAt) {
        expiredRequests.push(entity as CaptureRequest);
        context.log(`Found expired capture request: ${entity.rowKey} (expired at ${expiresAt.toISOString()})`);
      }
    }
    
    if (expiredRequests.length === 0) {
      context.log('No expired capture requests found');
      return;
    }
    
    context.log(`Processing ${expiredRequests.length} expired capture request(s)`);
    
    // ========================================================================
    // Process each expired request
    // ========================================================================
    
    for (const request of expiredRequests) {
      await processExpiredRequest(request, context);
    }
    
    context.log('Capture timeout processing completed');
    
  } catch (error: any) {
    logError(
      context,
      'Error processing capture timeouts',
      error,
      {
        errorType: error.name
      }
    );
    // Don't throw - allow timer to continue running
  }
}

/**
 * Process a single expired capture request
 */
async function processExpiredRequest(
  request: CaptureRequest,
  context: InvocationContext
): Promise<void> {
  const captureRequestId = request.rowKey;
  const sessionId = request.sessionId;
  
  context.log(`Processing expired request: ${captureRequestId}`);
  
  try {
    // ========================================================================
    // Task 6.2: Handle capture expiration
    // ========================================================================
    
    // Update status to 'ANALYZING'
    await updateCaptureRequest(captureRequestId, {
      status: 'ANALYZING',
      analysisStartedAt: new Date().toISOString()
    });
    
    context.log(`Updated status to ANALYZING for request: ${captureRequestId}`);
    
    // Query CaptureUploads for all uploaded images
    const uploads = await getCaptureUploads(captureRequestId);
    const uploadedCount = uploads.length;
    const totalCount = request.onlineStudentCount;
    
    context.log(`Found ${uploadedCount}/${totalCount} uploads for request: ${captureRequestId}`);
    
    // Log warning if partial uploads
    if (uploadedCount < totalCount) {
      logWarning(context, `Capture window expired with partial uploads: ${uploadedCount}/${totalCount}`, {
        sessionId,
        captureRequestId
      });
    }
    
    // Broadcast captureExpired event to all students and teacher
    const expiredEvent: CaptureExpiredEvent = {
      captureRequestId,
      uploadedCount,
      totalCount
    };
    
    await broadcastToHub(
      sessionId,
      'captureExpired',
      expiredEvent,
      context
    );
    
    context.log(`Broadcasted captureExpired event for request: ${captureRequestId}`);
    
    // ========================================================================
    // Task 6.3: Trigger position estimation
    // ========================================================================
    
    if (uploadedCount === 0) {
      // No uploads - mark as COMPLETED with no results
      context.log(`No uploads for request ${captureRequestId}, marking as COMPLETED`);
      
      await updateCaptureRequest(captureRequestId, {
        status: 'COMPLETED',
        analysisCompletedAt: new Date().toISOString()
      });
      
      // Broadcast completion with no results
      const resultsEvent: CaptureResultsEvent = {
        captureRequestId,
        status: 'COMPLETED',
        positions: [],
        analysisNotes: 'No student photos were uploaded during the capture window'
      };
      
      await broadcastToHub(
        sessionId,
        'captureResults',
        resultsEvent,
        context
      );
      
      context.log(`Broadcasted empty results for request: ${captureRequestId}`);
      return;
    }
    
    // Prepare input for GPT position estimation
    const estimationInput: PositionEstimationInput = {
      captureRequestId,
      imageUrls: uploads.map(upload => ({
        studentId: upload.rowKey,
        blobUrl: upload.blobUrl
      }))
    };
    
    context.log(`Calling GPT position estimation with ${uploadedCount} images`);
    
    let estimationOutput;
    let gptError: Error | null = null;
    
    try {
      // Call GPT position estimation
      estimationOutput = await estimateSeatingPositions(estimationInput, context);
      
      context.log(`Position estimation completed successfully`);
      
    } catch (error: any) {
      gptError = error;
      logError(
        context,
        'GPT position estimation failed',
        error,
        {
          sessionId,
          captureRequestId,
          errorType: error.name
        }
      );
    }
    
    // ========================================================================
    // Task 6.4: Broadcast results to teacher
    // ========================================================================
    
    if (gptError) {
      // Analysis failed - update status and broadcast error
      await updateCaptureRequest(captureRequestId, {
        status: 'FAILED',
        analysisCompletedAt: new Date().toISOString(),
        errorMessage: `Position estimation failed: ${gptError.message}`
      });
      
      const errorEvent: CaptureResultsEvent = {
        captureRequestId,
        status: 'FAILED',
        errorMessage: `Position analysis failed. Images have been saved for manual review. Error: ${gptError.message}`
      };
      
      await broadcastToHub(
        sessionId,
        'captureResults',
        errorEvent,
        context
      );
      
      context.log(`Broadcasted error results for request: ${captureRequestId}`);
      
    } else if (estimationOutput) {
      // Analysis succeeded - store results and broadcast
      const captureResult: CaptureResult = {
        partitionKey: captureRequestId,
        rowKey: 'RESULT',
        sessionId,
        positions: JSON.stringify(estimationOutput.positions),
        analysisNotes: estimationOutput.analysisNotes,
        analyzedAt: new Date().toISOString(),
        gptModel: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5.2-chat',
        gptTokensUsed: 0 // Could be populated from GPT response if needed
      };
      
      await createCaptureResult(captureResult);
      
      context.log(`Stored capture results for request: ${captureRequestId}`);
      
      // Update status to COMPLETED
      await updateCaptureRequest(captureRequestId, {
        status: 'COMPLETED',
        analysisCompletedAt: new Date().toISOString()
      });
      
      // Broadcast results to teacher
      const resultsEvent: CaptureResultsEvent = {
        captureRequestId,
        status: 'COMPLETED',
        positions: estimationOutput.positions,
        analysisNotes: estimationOutput.analysisNotes
      };
      
      await broadcastToHub(
        sessionId,
        'captureResults',
        resultsEvent,
        context
      );
      
      context.log(`Broadcasted successful results for request: ${captureRequestId}`);
      
      logInfo(context, 'Capture analysis completed successfully', {
        sessionId,
        captureRequestId
      });
    }
    
  } catch (error: any) {
    logError(
      context,
      'Error processing expired capture request',
      error,
      {
        sessionId,
        captureRequestId,
        errorType: error.name
      }
    );
    
    // Try to update status to FAILED
    try {
      await updateCaptureRequest(captureRequestId, {
        status: 'FAILED',
        analysisCompletedAt: new Date().toISOString(),
        errorMessage: `Processing failed: ${error.message}`
      });
      
      // Try to broadcast error
      const errorEvent: CaptureResultsEvent = {
        captureRequestId,
        status: 'FAILED',
        errorMessage: `An unexpected error occurred during processing: ${error.message}`
      };
      
      await broadcastToHub(
        sessionId,
        'captureResults',
        errorEvent,
        context
      );
      
    } catch (updateError: any) {
      context.error(`Failed to update error status for request ${captureRequestId}:`, updateError);
    }
  }
}

// Register the Azure Function with timer trigger
// Schedule: Every 10 seconds (0/10 * * * * *)
app.timer('processCaptureTimeout', {
  schedule: '0/10 * * * * *',
  handler: processCaptureTimeout
});
