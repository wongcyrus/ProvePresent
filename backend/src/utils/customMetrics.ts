/**
 * Custom Metrics Utility
 * 
 * Provides helper functions to emit custom metrics to Application Insights.
 * 
 * Azure Functions v4 automatically integrates with Application Insights when
 * APPLICATIONINSIGHTS_CONNECTION_STRING is configured. Custom metrics can be
 * emitted using structured logging with customDimensions.
 * 
 * These metrics will appear in the Application Insights customMetrics table
 * and can be queried using Kusto queries.
 */

import { InvocationContext } from '@azure/functions';

/**
 * Track a custom metric value
 * 
 * Emits a custom metric to Application Insights using structured logging.
 * The metric will be available in the customMetrics table.
 * 
 * @param context - Azure Functions invocation context
 * @param metricName - Name of the metric (e.g., "CaptureOrchestrator.Duration")
 * @param value - Numeric value of the metric
 * @param properties - Optional additional properties/dimensions
 */
export function trackMetric(
  context: InvocationContext,
  metricName: string,
  value: number,
  properties?: Record<string, string | number | boolean>
): void {
  // Use structured logging to emit custom metrics
  // Application Insights will automatically capture this as a custom metric
  const metricData = {
    metric: metricName,
    value: value,
    ...properties
  };
  
  context.log(`[METRIC] ${metricName}: ${value}`, metricData);
}

/**
 * Track orchestrator duration metric
 * 
 * @param context - Azure Functions invocation context
 * @param captureRequestId - Capture request ID
 * @param durationMs - Duration in milliseconds
 * @param isEarlyTermination - Whether this was an early termination
 */
export function trackOrchestratorDuration(
  context: InvocationContext,
  captureRequestId: string,
  durationMs: number,
  isEarlyTermination: boolean
): void {
  trackMetric(
    context,
    'CaptureOrchestrator.Duration',
    durationMs,
    {
      captureRequestId,
      earlyTermination: isEarlyTermination
    }
  );
}

/**
 * Track early termination event
 * 
 * @param context - Azure Functions invocation context
 * @param captureRequestId - Capture request ID
 */
export function trackEarlyTermination(
  context: InvocationContext,
  captureRequestId: string
): void {
  trackMetric(
    context,
    'CaptureOrchestrator.EarlyTermination',
    1,
    {
      captureRequestId
    }
  );
}

/**
 * Track orchestrator success/failure
 * 
 * @param context - Azure Functions invocation context
 * @param captureRequestId - Capture request ID
 * @param success - Whether the orchestrator completed successfully
 */
export function trackOrchestratorSuccess(
  context: InvocationContext,
  captureRequestId: string,
  success: boolean
): void {
  trackMetric(
    context,
    'CaptureOrchestrator.Success',
    success ? 1 : 0,
    {
      captureRequestId,
      success
    }
  );
}

/**
 * Track activity function success/failure
 * 
 * @param context - Azure Functions invocation context
 * @param captureRequestId - Capture request ID
 * @param uploadedCount - Number of uploads processed
 * @param success - Whether the activity completed successfully
 */
export function trackActivitySuccess(
  context: InvocationContext,
  captureRequestId: string,
  uploadedCount: number,
  success: boolean
): void {
  trackMetric(
    context,
    'CaptureTimeout.Success',
    success ? 1 : 0,
    {
      captureRequestId,
      uploadedCount,
      success
    }
  );
}

/**
 * Track upload count metric
 * 
 * @param context - Azure Functions invocation context
 * @param captureRequestId - Capture request ID
 * @param uploadedCount - Number of uploads
 * @param totalCount - Total expected uploads
 */
export function trackUploadCount(
  context: InvocationContext,
  captureRequestId: string,
  uploadedCount: number,
  totalCount: number
): void {
  trackMetric(
    context,
    'CaptureTimeout.UploadCount',
    uploadedCount,
    {
      captureRequestId,
      totalCount,
      uploadPercentage: Math.round((uploadedCount / totalCount) * 100)
    }
  );
}
