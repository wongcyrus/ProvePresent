/**
 * Database Utilities
 * Common functions for Azure Table Storage operations
 */

import { TableClient } from '@azure/data-tables';

/**
 * Get a Table Storage client for the specified table
 * Automatically handles local development (Azurite) and production
 * @param tableName - Name of the table
 * @returns TableClient instance
 * @throws Error if AzureWebJobsStorage is not configured
 */
export function getTableClient(tableName: string): TableClient {
  const connectionString = process.env.AzureWebJobsStorage;
  if (!connectionString) {
    throw new Error('AzureWebJobsStorage not configured');
  }
  
  // Check if running locally (Azurite)
  const isLocal = connectionString.includes("127.0.0.1") || 
                  connectionString.includes("localhost") ||
                  connectionString.includes("UseDevelopmentStorage=true");
  
  return TableClient.fromConnectionString(
    connectionString, 
    tableName, 
    { allowInsecureConnection: isLocal }
  );
}

/**
 * Table names used in the application
 * Centralized list for consistency
 */
export const TableNames = {
  SESSIONS: 'Sessions',
  ATTENDANCE: 'Attendance',
  CHAINS: 'Chains',
  TOKENS: 'Tokens',
  USER_SESSIONS: 'UserSessions',
  ATTENDANCE_SNAPSHOTS: 'AttendanceSnapshots',
  CHAIN_HISTORY: 'ChainHistory',
  SCAN_LOGS: 'ScanLogs',
  DELETION_LOG: 'DeletionLog',
  QUIZ_QUESTIONS: 'QuizQuestions',
  QUIZ_RESPONSES: 'QuizResponses',
  QUIZ_METRICS: 'QuizMetrics',
  CAPTURE_REQUESTS: 'CaptureRequests',
  CAPTURE_UPLOADS: 'CaptureUploads',
  CAPTURE_RESULTS: 'CaptureResults',
  EXTERNAL_TEACHERS: 'ExternalTeachers',
  OTP_CODES: 'OtpCodes'
} as const;
