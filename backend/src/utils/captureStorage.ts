/**
 * Azure Table Storage Helper Functions for Student Image Capture
 * 
 * This module provides CRUD operations for capture-related entities with:
 * - Retry logic with exponential backoff (3 attempts: 1s, 2s, 4s delays)
 * - Proper error handling and logging
 * - Type-safe operations using defined interfaces
 * 
 * Validates: Requirements 8.2, 8.3, 8.4
 */

import { TableClient, RestError } from '@azure/data-tables';
import { getTableClient } from './database';
import {
  CaptureRequest,
  CaptureUpload,
  CaptureResult,
  CaptureRequestStatus
} from '../types/studentImageCapture';

/**
 * Table names for capture-related entities
 */
export const CaptureTableNames = {
  CAPTURE_REQUESTS: 'CaptureRequests',
  CAPTURE_UPLOADS: 'CaptureUploads',
  CAPTURE_RESULTS: 'CaptureResults'
} as const;

/**
 * Retry configuration for Table Storage operations
 */
const RETRY_CONFIG = {
  maxAttempts: 3,
  delays: [1000, 2000, 4000] // milliseconds
};

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a Table Storage operation with exponential backoff retry logic
 * 
 * @param operation - Async function to execute
 * @param operationName - Name for logging purposes
 * @returns Result of the operation
 * @throws Error after all retry attempts fail
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < RETRY_CONFIG.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      // Check if error is retryable (transient)
      const isRetryable = isTransientError(error);
      
      if (!isRetryable || attempt === RETRY_CONFIG.maxAttempts - 1) {
        // Non-retryable error or last attempt - throw immediately
        console.error(`${operationName} failed after ${attempt + 1} attempt(s):`, error);
        throw error;
      }

      // Log retry attempt
      const delay = RETRY_CONFIG.delays[attempt];
      console.warn(
        `${operationName} failed (attempt ${attempt + 1}/${RETRY_CONFIG.maxAttempts}), ` +
        `retrying in ${delay}ms:`,
        error
      );

      // Wait before retry
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError || new Error(`${operationName} failed after all retries`);
}

/**
 * Determine if an error is transient and should be retried
 */
function isTransientError(error: unknown): boolean {
  if (error instanceof RestError) {
    // Retry on network errors and specific HTTP status codes
    const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
    return error.statusCode ? retryableStatusCodes.includes(error.statusCode) : true;
  }
  
  // Retry on network-related errors
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('enotfound')
    );
  }

  return false;
}

// ============================================================================
// CaptureRequest Operations
// ============================================================================

/**
 * Create a new capture request in Table Storage
 * 
 * @param captureRequest - CaptureRequest entity to create
 * @returns Created entity
 * @throws Error if creation fails after retries
 * 
 * Validates: Requirements 8.2
 */
export async function createCaptureRequest(
  captureRequest: CaptureRequest
): Promise<CaptureRequest> {
  const table = getTableClient(CaptureTableNames.CAPTURE_REQUESTS);
  
  return withRetry(async () => {
    await table.createEntity(captureRequest);
    return captureRequest;
  }, `createCaptureRequest(${captureRequest.rowKey})`);
}

/**
 * Get a capture request by ID
 * 
 * @param captureRequestId - UUID of the capture request
 * @returns CaptureRequest entity or null if not found
 * @throws Error if retrieval fails after retries
 * 
 * Validates: Requirements 8.3, 8.4
 */
export async function getCaptureRequest(
  captureRequestId: string
): Promise<CaptureRequest | null> {
  const table = getTableClient(CaptureTableNames.CAPTURE_REQUESTS);
  
  return withRetry(async () => {
    try {
      const entity = await table.getEntity<CaptureRequest>(
        'CAPTURE_REQUEST',
        captureRequestId
      );
      return entity as CaptureRequest;
    } catch (error) {
      if (error instanceof RestError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }, `getCaptureRequest(${captureRequestId})`);
}

/**
 * Update an existing capture request
 * 
 * @param captureRequestId - UUID of the capture request
 * @param updates - Partial updates to apply
 * @returns Updated entity
 * @throws Error if update fails after retries
 * 
 * Validates: Requirements 8.3
 */
export async function updateCaptureRequest(
  captureRequestId: string,
  updates: Partial<Omit<CaptureRequest, 'partitionKey' | 'rowKey'>>
): Promise<CaptureRequest> {
  const table = getTableClient(CaptureTableNames.CAPTURE_REQUESTS);
  
  return withRetry(async () => {
    // Get existing entity first
    const existing = await getCaptureRequest(captureRequestId);
    if (!existing) {
      throw new Error(`CaptureRequest ${captureRequestId} not found`);
    }

    // Merge updates
    const updated: CaptureRequest = {
      ...existing,
      ...updates
    };

    // Update entity (merge mode)
    await table.updateEntity(updated, 'Merge');
    return updated;
  }, `updateCaptureRequest(${captureRequestId})`);
}

// ============================================================================
// CaptureUpload Operations
// ============================================================================

/**
 * Create a new capture upload record
 * 
 * @param captureUpload - CaptureUpload entity to create
 * @returns Created entity
 * @throws Error if creation fails after retries
 * 
 * Validates: Requirements 8.2
 */
export async function createCaptureUpload(
  captureUpload: CaptureUpload
): Promise<CaptureUpload> {
  const table = getTableClient(CaptureTableNames.CAPTURE_UPLOADS);
  
  return withRetry(async () => {
    await table.createEntity(captureUpload);
    return captureUpload;
  }, `createCaptureUpload(${captureUpload.partitionKey}/${captureUpload.rowKey})`);
}

/**
 * Get all upload records for a capture request
 * 
 * @param captureRequestId - UUID of the capture request
 * @returns Array of CaptureUpload entities
 * @throws Error if retrieval fails after retries
 * 
 * Validates: Requirements 8.3, 8.4
 */
export async function getCaptureUploads(
  captureRequestId: string
): Promise<CaptureUpload[]> {
  const table = getTableClient(CaptureTableNames.CAPTURE_UPLOADS);
  
  return withRetry(async () => {
    const uploads: CaptureUpload[] = [];
    
    // Query all entities with matching partition key
    const entities = table.listEntities<CaptureUpload>({
      queryOptions: {
        filter: `PartitionKey eq '${captureRequestId}'`
      }
    });

    for await (const entity of entities) {
      uploads.push(entity as CaptureUpload);
    }

    return uploads;
  }, `getCaptureUploads(${captureRequestId})`);
}

// ============================================================================
// CaptureResult Operations
// ============================================================================

/**
 * Create a new capture result record
 * 
 * @param captureResult - CaptureResult entity to create
 * @returns Created entity
 * @throws Error if creation fails after retries
 * 
 * Validates: Requirements 8.2
 */
export async function createCaptureResult(
  captureResult: CaptureResult
): Promise<CaptureResult> {
  const table = getTableClient(CaptureTableNames.CAPTURE_RESULTS);
  
  return withRetry(async () => {
    await table.createEntity(captureResult);
    return captureResult;
  }, `createCaptureResult(${captureResult.partitionKey})`);
}

/**
 * Get capture result for a capture request
 * 
 * @param captureRequestId - UUID of the capture request
 * @returns CaptureResult entity or null if not found
 * @throws Error if retrieval fails after retries
 * 
 * Validates: Requirements 8.3, 8.4
 */
export async function getCaptureResult(
  captureRequestId: string
): Promise<CaptureResult | null> {
  const table = getTableClient(CaptureTableNames.CAPTURE_RESULTS);
  
  return withRetry(async () => {
    try {
      const entity = await table.getEntity<CaptureResult>(
        captureRequestId,
        'RESULT'
      );
      return entity as CaptureResult;
    } catch (error) {
      if (error instanceof RestError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }, `getCaptureResult(${captureRequestId})`);
}
