/**
 * Process Capture Timeout Activity Function
 * 
 * Activity function that processes an expired or completed capture request.
 * This function is invoked by the captureTimeoutOrchestrator when either:
 * 1. The durable timer expires (natural timeout)
 * 2. An external event signals early termination (all students uploaded)
 * 
 * This activity function contains the core processing logic extracted from
 * the old processCaptureTimeout.ts timer function.
 * 
 * Requirements:
 * - 2.1: Query CaptureUploads table for all uploaded images
 * - 2.2: Update Capture_Request status to 'ANALYZING'
 * - 2.3: Broadcast captureExpired event via SignalR
 * - 2.4: Invoke Position_Estimation function when uploads > 0
 * - 2.5: Update status to 'COMPLETED' when uploads = 0
 * - 2.6: Store results and update status to 'COMPLETED' on success
 * - 2.7: Update status to 'FAILED' and broadcast error on failure
 * - 2.8: Broadcast captureResults event to teacher
 */

import { InvocationContext } from '@azure/functions';
import * as df from 'durable-functions';
import {
  CaptureExpiredEvent,
  CaptureResultsEvent,
  CaptureResult,
  PositionEstimationInput
} from '../types/studentImageCapture';
import {
  getCaptureRequest,
  updateCaptureRequest,
  getCaptureUploads,
  createCaptureResult
} from '../utils/captureStorage';
import { broadcastToHub } from '../utils/signalrBroadcast';
import { estimateSeatingPositions } from '../utils/gptPositionEstimation';
import { logError, logInfo, logWarning } from '../utils/errorLogging';
import {
  trackActivitySuccess,
  trackUploadCount
} from '../utils/customMetrics';

/**
 * Result returned by the activity function
 */
interface ActivityResult {
  status: 'COMPLETED' | 'FAILED';
  uploadedCount: number;
  errorMessage?: string;
}

/**
 * Process Capture Timeout Activity
 * 
 * Processes an expired or completed capture request by:
 * 1. Querying uploaded images
 * 2. Updating status to ANALYZING
 * 3. Broadcasting expiration event
 * 4. Triggering GPT position estimation (if uploads > 0)
 * 5. Storing results and broadcasting to teacher
 * 
 * @param captureRequestId - UUID of the capture request to process
 * @param context - Azure Functions invocation context
 * @returns Activity result with status and upload count
 */
export async function processCaptureTimeoutActivity(
  captureRequestId: string,
  context: InvocationContext
): Promise<ActivityResult> {
  
  context.log(`Processing timeout for capture: ${captureRequestId}`);
  
  try {
    // ========================================================================
    // Step 1: Get capture request (Requirement 2.1)
    // ========================================================================
    
    const captureRequest = await getCaptureRequest(captureRequestId);
    if (!captureRequest) {
      throw new Error(`Capture request not found: ${captureRequestId}`);
    }
    
    const sessionId = captureRequest.sessionId;
    
    // ========================================================================
    // Step 2: Update status to ANALYZING (Requirement 2.2)
    // ========================================================================
    
    await updateCaptureRequest(captureRequestId, {
      status: 'ANALYZING',
      analysisStartedAt: new Date().toISOString()
    });
    
    context.log(`Updated status to ANALYZING for request: ${captureRequestId}`);
    
    // ========================================================================
    // Step 3: Query uploads (Requirement 2.1)
    // ========================================================================
    
    const uploads = await getCaptureUploads(captureRequestId);
    const uploadedCount = uploads.length;
    const totalCount = captureRequest.onlineStudentCount;
    
    context.log(`Found ${uploadedCount}/${totalCount} uploads for request: ${captureRequestId}`);
    
    // Track upload count metric (Requirement 8.6)
    trackUploadCount(context, captureRequestId, uploadedCount, totalCount);
    
    // Log warning if partial uploads
    if (uploadedCount < totalCount) {
      logWarning(context, `Capture window expired with partial uploads: ${uploadedCount}/${totalCount}`, {
        sessionId,
        captureRequestId
      });
    }
    
    // ========================================================================
    // Step 4: Broadcast captureExpired event (Requirement 2.3)
    // ========================================================================
    
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
    // Step 5: Handle zero uploads case (Requirement 2.5)
    // ========================================================================
    
    if (uploadedCount === 0) {
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
      
      // Track success metric (Requirement 8.6)
      trackActivitySuccess(context, captureRequestId, 0, true);
      
      return { status: 'COMPLETED', uploadedCount: 0 };
    }
    
    // ========================================================================
    // Step 6: Call GPT position estimation (Requirement 2.4)
    // ========================================================================
    
    const estimationInput: PositionEstimationInput = {
      captureRequestId,
      imageUrls: uploads.map(upload => ({
        studentId: upload.rowKey,
        blobUrl: upload.blobUrl
      }))
    };
    
    context.log(`Calling GPT position estimation with ${uploadedCount} images`);
    
    try {
      const estimationOutput = await estimateSeatingPositions(estimationInput, context);
      
      context.log(`Position estimation completed successfully`);
      
      // ========================================================================
      // Step 7: Store results and update status (Requirement 2.6)
      // ========================================================================
      
      const captureResult: CaptureResult = {
        partitionKey: captureRequestId,
        rowKey: 'RESULT',
        sessionId,
        positions: JSON.stringify(estimationOutput.positions),
        analysisNotes: estimationOutput.analysisNotes,
        analyzedAt: new Date().toISOString(),
        gptModel: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5.4',
        gptTokensUsed: 0 // Could be populated from GPT response if needed
      };
      
      await createCaptureResult(captureResult);
      
      context.log(`Stored capture results for request: ${captureRequestId}`);
      
      // Update status to COMPLETED
      await updateCaptureRequest(captureRequestId, {
        status: 'COMPLETED',
        analysisCompletedAt: new Date().toISOString()
      });
      
      // ========================================================================
      // Step 8: Broadcast results to teacher (Requirement 2.8)
      // ========================================================================
      
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
      
      // Track success metric (Requirement 8.6)
      trackActivitySuccess(context, captureRequestId, uploadedCount, true);
      
      return { status: 'COMPLETED', uploadedCount };
      
    } catch (error: any) {
      // ========================================================================
      // Step 9: Handle GPT failure (Requirement 2.7)
      // ========================================================================
      
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
      
      // Update status to FAILED
      await updateCaptureRequest(captureRequestId, {
        status: 'FAILED',
        analysisCompletedAt: new Date().toISOString(),
        errorMessage: `Position estimation failed: ${error.message}`
      });
      
      // Broadcast error to teacher
      const errorEvent: CaptureResultsEvent = {
        captureRequestId,
        status: 'FAILED',
        errorMessage: `Position analysis failed. Images have been saved for manual review. Error: ${error.message}`
      };
      
      await broadcastToHub(
        sessionId,
        'captureResults',
        errorEvent,
        context
      );
      
      context.log(`Broadcasted error results for request: ${captureRequestId}`);
      
      // Track failure metric (Requirement 8.6)
      trackActivitySuccess(context, captureRequestId, uploadedCount, false);
      
      // Re-throw to trigger orchestrator retry (Requirement 7.1)
      throw error;
    }
    
  } catch (error: any) {
    // ========================================================================
    // Step 10: Handle unexpected errors (Requirement 7.1, 7.2, 7.3)
    // ========================================================================
    
    logError(
      context,
      'Error processing capture timeout',
      error,
      {
        captureRequestId,
        errorType: error.name
      }
    );
    
    // Try to update status to FAILED if we have the capture request
    try {
      const captureRequest = await getCaptureRequest(captureRequestId);
      if (captureRequest) {
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
          captureRequest.sessionId,
          'captureResults',
          errorEvent,
          context
        );
      }
    } catch (updateError: any) {
      context.error(`Failed to update error status for request ${captureRequestId}:`, updateError);
    }
    
    // Track failure metric (Requirement 8.6)
    trackActivitySuccess(context, captureRequestId, 0, false);
    
    // Re-throw to trigger orchestrator retry
    throw error;
  }
}

// Register the activity function
df.app.activity('processCaptureTimeoutActivity', {
  handler: processCaptureTimeoutActivity
});
