/**
 * TypeScript interfaces for Student Image Capture and Seating Position Estimation
 * 
 * This file contains all data models for the image capture feature including:
 * - Table Storage entities (CaptureRequest, CaptureUpload, CaptureResult)
 * - API request/response payloads
 * - SignalR event payloads
 * - Supporting types and enums
 */

// ============================================================================
// Enums and Constants
// ============================================================================

/**
 * Status of a capture request throughout its lifecycle
 */
export type CaptureRequestStatus = 'ACTIVE' | 'EXPIRED' | 'ANALYZING' | 'COMPLETED' | 'FAILED';

/**
 * Confidence level for seating position estimation
 */
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

// ============================================================================
// Table Storage Entities
// ============================================================================

/**
 * CaptureRequest entity stored in Table Storage
 * Tracks the overall capture request initiated by a teacher
 * 
 * Partition Key: 'CAPTURE_REQUEST'
 * Row Key: captureRequestId (UUID)
 * 
 * Validates: Requirements 1.1, 1.2, 1.3, 8.2
 */
export interface CaptureRequest {
  partitionKey: 'CAPTURE_REQUEST';
  rowKey: string; // captureRequestId (UUID)
  sessionId: string;
  teacherId: string;
  status: CaptureRequestStatus;
  createdAt: string; // ISO timestamp
  expiresAt: string; // ISO timestamp (createdAt + 30s)
  onlineStudentIds: string; // JSON array of student IDs
  onlineStudentCount: number;
  uploadedCount: number;
  analysisStartedAt?: string; // ISO timestamp
  analysisCompletedAt?: string; // ISO timestamp
  errorMessage?: string;
}

/**
 * CaptureUpload entity stored in Table Storage
 * Tracks individual student photo uploads
 * 
 * Partition Key: captureRequestId
 * Row Key: studentId
 * 
 * Validates: Requirements 3.1, 3.3, 8.2
 */
export interface CaptureUpload {
  partitionKey: string; // captureRequestId
  rowKey: string; // studentId
  sessionId: string;
  blobName: string; // captures/{sessionId}/{captureRequestId}/{studentId}.jpg
  blobUrl: string;
  uploadedAt: string; // ISO timestamp
  fileSizeBytes: number;
}

/**
 * CaptureResult entity stored in Table Storage
 * Stores GPT analysis results with seating positions
 * 
 * Partition Key: captureRequestId
 * Row Key: 'RESULT'
 * 
 * Validates: Requirements 6.1, 6.3, 8.2
 */
export interface CaptureResult {
  partitionKey: string; // captureRequestId
  rowKey: 'RESULT';
  sessionId: string;
  positions: string; // JSON array of SeatingPosition objects
  analysisNotes: string;
  analyzedAt: string; // ISO timestamp
  gptModel: string; // e.g., "gpt-5.2-chat"
  gptTokensUsed: number;
}

/**
 * Individual student seating position estimate
 * Stored as JSON within CaptureResult.positions
 * 
 * Validates: Requirements 6.1, 6.2
 */
export interface SeatingPosition {
  studentId: string;
  estimatedRow: number; // 1-based row number (1 = closest to projector)
  estimatedColumn: number; // 1-based column number (1 = leftmost from teacher's perspective)
  confidence: ConfidenceLevel;
  reasoning: string; // Brief explanation of position estimate
}

// ============================================================================
// API Request/Response Payloads
// ============================================================================

/**
 * Request payload for initiating a capture request
 * POST /api/sessions/{sessionId}/capture/initiate
 * 
 * Validates: Requirements 1.1, 1.4
 */
export interface InitiateCaptureRequest {
  // No body required - uses sessionId from route
}

/**
 * Response payload for initiating a capture request
 * 
 * Validates: Requirements 1.1, 1.2, 1.4
 */
export interface InitiateCaptureResponse {
  captureRequestId: string;
  expiresAt: number; // Unix timestamp (milliseconds)
  onlineStudentCount: number;
}

/**
 * Request payload for notifying upload completion
 * POST /api/sessions/{sessionId}/capture/{captureRequestId}/upload
 * 
 * Validates: Requirements 3.3
 */
export interface NotifyUploadRequest {
  blobName: string; // Verification that upload completed
}

/**
 * Response payload for upload notification
 * 
 * Validates: Requirements 3.3
 */
export interface NotifyUploadResponse {
  success: boolean;
  uploadedAt: number; // Unix timestamp (milliseconds)
}

/**
 * Response payload for getting capture results
 * GET /api/sessions/{sessionId}/capture/{captureRequestId}/results
 * 
 * Validates: Requirements 6.3, 8.4
 */
export interface GetCaptureResultsResponse {
  captureRequestId: string;
  status: CaptureRequestStatus;
  uploadedCount: number;
  totalCount: number;
  positions?: SeatingPosition[];
  imageUrls?: Record<string, string>; // Map of studentId to image URL
  analysisNotes?: string;
  analyzedAt?: string; // ISO timestamp
  errorMessage?: string;
}

// ============================================================================
// SignalR Event Payloads
// ============================================================================

/**
 * SignalR event sent to students when teacher initiates capture
 * Event: 'captureRequest'
 * Hub: dashboard{sessionId}
 * 
 * Validates: Requirements 1.1, 1.4, 7.1, 9.1
 */
export interface CaptureRequestEvent {
  captureRequestId: string;
  sasUrl: string; // Student-specific SAS URL for blob upload
  expiresAt: number; // Unix timestamp (milliseconds)
  blobName: string; // Expected blob name for upload
}

/**
 * SignalR event sent to teacher when student completes upload
 * Event: 'uploadComplete'
 * Hub: dashboard{sessionId}
 * 
 * Validates: Requirements 7.2
 */
export interface UploadCompleteEvent {
  captureRequestId: string;
  studentId: string;
  uploadedAt: number; // Unix timestamp (milliseconds)
  uploadedCount: number;
  totalCount: number;
}

/**
 * SignalR event sent to all participants when capture window expires
 * Event: 'captureExpired'
 * Hub: dashboard{sessionId}
 * 
 * Validates: Requirements 5.3, 7.3
 */
export interface CaptureExpiredEvent {
  captureRequestId: string;
  uploadedCount: number;
  totalCount: number;
}

/**
 * SignalR event sent to teacher when GPT analysis completes
 * Event: 'captureResults'
 * Hub: dashboard{sessionId}
 * 
 * Validates: Requirements 6.3, 6.4, 7.2
 */
export interface CaptureResultsEvent {
  captureRequestId: string;
  status: 'COMPLETED' | 'FAILED';
  positions?: SeatingPosition[];
  analysisNotes?: string;
  errorMessage?: string;
}

// ============================================================================
// Internal Service Types
// ============================================================================

/**
 * Input for GPT position estimation service
 * Used internally by estimateSeatingPositions function
 * 
 * Validates: Requirements 6.1
 */
export interface PositionEstimationInput {
  captureRequestId: string;
  imageUrls: Array<{
    studentId: string;
    blobUrl: string;
  }>;
}

/**
 * Output from GPT position estimation service
 * 
 * Validates: Requirements 6.1, 6.2, 6.3
 */
export interface PositionEstimationOutput {
  positions: SeatingPosition[];
  analysisNotes: string;
}

/**
 * GPT API response structure
 * Used for parsing Azure OpenAI vision/chat API responses
 */
export interface GPTAnalysisResponse {
  positions: SeatingPosition[];
  analysisNotes: string;
}

/**
 * Blob metadata for uploaded student images
 * 
 * Validates: Requirements 3.1, 8.2
 */
export interface BlobMetadata {
  sessionId: string;
  captureRequestId: string;
  studentId: string;
  uploadedAt: string; // ISO timestamp
}

/**
 * SAS URL generation parameters
 * 
 * Validates: Requirements 1.4, 9.1, 9.2, 9.3, 9.4
 */
export interface SasUrlParams {
  sessionId: string;
  captureRequestId: string;
  studentId: string;
  permissions: 'w' | 'r'; // write-only for students, read for GPT
  expirySeconds: number; // 90 for students, 300 for GPT
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Standard error response structure
 */
export interface CaptureErrorResponse {
  error: {
    code: string;
    message: string;
    details?: string;
    timestamp: number;
  };
}

/**
 * Error codes specific to image capture feature
 */
export enum CaptureErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  INVALID_REQUEST = 'INVALID_REQUEST',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  CAPTURE_NOT_FOUND = 'CAPTURE_NOT_FOUND',
  CAPTURE_EXPIRED = 'CAPTURE_EXPIRED',
  NO_ONLINE_STUDENTS = 'NO_ONLINE_STUDENTS',
  UPLOAD_FAILED = 'UPLOAD_FAILED',
  IMAGE_TOO_LARGE = 'IMAGE_TOO_LARGE',
  BLOB_NOT_FOUND = 'BLOB_NOT_FOUND',
  ANALYSIS_FAILED = 'ANALYSIS_FAILED',
  INTERNAL_ERROR = 'INTERNAL_ERROR'
}

// ============================================================================
// Frontend State Types
// ============================================================================

/**
 * Teacher capture control state
 * Used in TeacherDashboard component
 * 
 * Validates: Requirements 1.1, 1.2, 5.3, 6.3
 */
export interface TeacherCaptureState {
  status: 'idle' | 'capturing' | 'analyzing' | 'completed' | 'failed';
  captureRequestId: string | null;
  expiresAt: number | null; // Unix timestamp (milliseconds)
  uploadedCount: number;
  totalCount: number;
  results: SeatingPosition[] | null;
  error: string | null;
}

/**
 * Student capture interface state
 * Used in SimpleStudentView component
 * 
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 3.1, 4.1
 */
export interface StudentCaptureState {
  isVisible: boolean;
  captureRequestId: string | null;
  sasUrl: string | null;
  expiresAt: number | null; // Unix timestamp (milliseconds)
  photo: Blob | null;
  uploadStatus: 'idle' | 'uploading' | 'success' | 'error';
  errorMessage: string | null;
}
