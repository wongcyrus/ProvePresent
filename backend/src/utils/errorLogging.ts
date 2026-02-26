/**
 * Error Logging Utility
 * 
 * Provides structured error logging for capture-related operations
 * with all required fields as specified in the design document.
 * 
 * Log Levels:
 * - ERROR: Upload failures, GPT failures, database failures
 * - WARN: Timeouts, retries, SAS URL expiration
 * - INFO: Successful captures, analysis completion
 * - DEBUG: SignalR events, SAS URL generation
 */

import { InvocationContext } from '@azure/functions';

export interface ErrorLogContext {
  sessionId?: string;
  captureRequestId?: string;
  studentId?: string;
  errorType?: string;
  errorCode?: string;
  requestHeaders?: Record<string, string>;
  requestBody?: any;
}

/**
 * Log an error with structured context
 */
export function logError(
  context: InvocationContext,
  message: string,
  error: Error | any,
  logContext?: ErrorLogContext
): void {
  const timestamp = new Date().toISOString();
  
  const logEntry = {
    timestamp,
    level: 'ERROR',
    message,
    errorType: error?.name || logContext?.errorType || 'UnknownError',
    errorCode: logContext?.errorCode,
    errorMessage: error?.message || String(error),
    stackTrace: error?.stack,
    sessionId: logContext?.sessionId,
    captureRequestId: logContext?.captureRequestId,
    studentId: logContext?.studentId,
    requestContext: {
      headers: logContext?.requestHeaders,
      body: logContext?.requestBody
    }
  };

  context.error(JSON.stringify(logEntry, null, 2));
}

/**
 * Log a warning with structured context
 */
export function logWarning(
  context: InvocationContext,
  message: string,
  logContext?: ErrorLogContext
): void {
  const timestamp = new Date().toISOString();
  
  const logEntry = {
    timestamp,
    level: 'WARN',
    message,
    sessionId: logContext?.sessionId,
    captureRequestId: logContext?.captureRequestId,
    studentId: logContext?.studentId
  };

  context.warn(JSON.stringify(logEntry, null, 2));
}

/**
 * Log an info message with structured context
 */
export function logInfo(
  context: InvocationContext,
  message: string,
  logContext?: ErrorLogContext
): void {
  const timestamp = new Date().toISOString();
  
  const logEntry = {
    timestamp,
    level: 'INFO',
    message,
    sessionId: logContext?.sessionId,
    captureRequestId: logContext?.captureRequestId,
    studentId: logContext?.studentId
  };

  context.log(JSON.stringify(logEntry, null, 2));
}

/**
 * Log a debug message with structured context
 */
export function logDebug(
  context: InvocationContext,
  message: string,
  logContext?: ErrorLogContext
): void {
  const timestamp = new Date().toISOString();
  
  const logEntry = {
    timestamp,
    level: 'DEBUG',
    message,
    sessionId: logContext?.sessionId,
    captureRequestId: logContext?.captureRequestId,
    studentId: logContext?.studentId
  };

  context.log(JSON.stringify(logEntry, null, 2));
}
