/**
 * Capture Timeout Orchestrator
 * 
 * Manages the lifecycle of a capture request timeout using Azure Durable Functions.
 * This orchestrator creates a durable timer for the capture expiration and waits for
 * either the timer to fire OR an external event signaling early termination.
 * 
 * Requirements:
 * - 1.1: Start orchestrator instance when capture request is initiated
 * - 8.1: Log when orchestrator instance is started with captureRequestId
 */

import * as df from 'durable-functions';
import { OrchestrationContext, OrchestrationHandler } from 'durable-functions';
import {
  trackOrchestratorDuration,
  trackEarlyTermination,
  trackOrchestratorSuccess
} from '../utils/customMetrics';

/**
 * Input data for the capture timeout orchestrator
 */
interface CaptureTimeoutInput {
  captureRequestId: string;  // UUID of the capture request
  expiresAt: string;          // ISO 8601 timestamp when capture expires
  sessionId: string;          // Session ID for logging and correlation
}

/**
 * Capture Timeout Orchestrator Function
 * 
 * This orchestrator manages the timeout lifecycle for a student image capture request.
 * It creates a durable timer that fires at the exact expiration time and also listens
 * for an external event that signals early termination (when all students have uploaded).
 * 
 * The orchestrator uses Task.any() to race between the timer and external event,
 * ensuring that timeout processing occurs exactly once - either when the timer expires
 * or when all students have uploaded, whichever comes first.
 * 
 * @param context - Durable orchestration context
 * @returns Orchestration result with status
 */
const captureTimeoutOrchestrator: OrchestrationHandler = function* (context: OrchestrationContext) {
  const input: CaptureTimeoutInput = context.df.getInput();
  
  // Deterministic logging for orchestrator start (Requirement 8.1)
  context.log(`Orchestrator started for capture: ${input.captureRequestId}`);
  
  // Record start time for duration metric
  const startTime = context.df.currentUtcDateTime;
  
  // Task 3.2: Create durable timer for expiration (Requirement 1.2, 8.2)
  const expirationDate = new Date(input.expiresAt);
  context.log(`Timer created with expiration: ${input.expiresAt}`);
  const timerTask = context.df.createTimer(expirationDate);
  
  // Task 3.3: Set up listener for external event (Requirement 1.3, 3.2)
  const eventTask = context.df.waitForExternalEvent('allUploadsComplete');
  
  // Task 3.4: Race between timer and external event (Requirements 1.3, 1.4, 1.5, 3.3)
  const winner = yield context.df.Task.any([timerTask, eventTask]);
  
  // Determine which completed first and cancel timer if external event won
  let isEarlyTermination = false;
  if (winner === eventTask) {
    // Early termination: all students uploaded before timeout (Requirement 1.5, 3.3)
    context.log(`Early termination for capture: ${input.captureRequestId}`);
    timerTask.cancel();
    isEarlyTermination = true;
    
    // Track early termination metric (Requirement 8.6)
    trackEarlyTermination(context, input.captureRequestId);
  } else {
    // Timer expired naturally (Requirement 1.4)
    context.log(`Timer expired for capture: ${input.captureRequestId}`);
  }
  
  // Task 3.5: Invoke activity function for timeout processing (Requirements 1.4, 1.5, 7.1)
  // Configure retry policy: 3 attempts with exponential backoff (2s, 4s, 8s)
  const retryOptions = new df.RetryOptions(2000, 3);
  retryOptions.backoffCoefficient = 2;
  
  try {
    // Call activity function to process the timeout
    yield context.df.callActivityWithRetry(
      'processCaptureTimeoutActivity',
      retryOptions,
      input.captureRequestId
    );
    
    // Calculate duration for metrics (Requirement 8.6)
    const endTime = context.df.currentUtcDateTime;
    const durationMs = endTime.getTime() - startTime.getTime();
    
    // Task 3.6: Log orchestrator completion status (Requirement 8.5)
    context.log(`Orchestrator completed successfully for capture: ${input.captureRequestId}`);
    
    // Track success metrics (Requirement 8.6)
    trackOrchestratorDuration(context, input.captureRequestId, durationMs, isEarlyTermination);
    trackOrchestratorSuccess(context, input.captureRequestId, true);
    
    // Return result indicating success
    return { 
      status: 'completed',
      captureRequestId: input.captureRequestId,
      completedAt: context.df.currentUtcDateTime.toISOString(),
      durationMs,
      earlyTermination: isEarlyTermination
    };
    
  } catch (error: any) {
    // Calculate duration for metrics even on failure
    const endTime = context.df.currentUtcDateTime;
    const durationMs = endTime.getTime() - startTime.getTime();
    
    // Task 3.6: Log orchestrator failure status (Requirement 8.5)
    context.log(`Orchestrator failed for capture: ${input.captureRequestId}`, error);
    
    // Track failure metrics (Requirement 8.6)
    trackOrchestratorDuration(context, input.captureRequestId, durationMs, isEarlyTermination);
    trackOrchestratorSuccess(context, input.captureRequestId, false);
    
    // Return result indicating failure
    return { 
      status: 'failed',
      captureRequestId: input.captureRequestId,
      error: error.message || 'Unknown error',
      failedAt: context.df.currentUtcDateTime.toISOString(),
      durationMs
    };
  }
};

// Register the orchestrator function (Requirement 1.1)
df.app.orchestration('captureTimeoutOrchestrator', captureTimeoutOrchestrator);
