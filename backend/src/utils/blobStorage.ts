/**
 * Azure Blob Storage Helper Functions for Student Image Capture
 * 
 * This module provides SAS URL generation and blob verification for:
 * - Student photo uploads (write-only, 90-second expiry)
 * - GPT image analysis (read-only, 5-minute expiry)
 * - Blob existence verification
 * 
 * Validates: Requirements 1.4, 3.1, 3.3, 6.1, 9.1, 9.2, 9.3, 9.4
 */

import {
  BlobServiceClient,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  StorageSharedKeyCredential
} from '@azure/storage-blob';

/**
 * Container name for student capture images
 */
export const STUDENT_CAPTURES_CONTAINER = 'student-captures';

/**
 * Parse Azure Storage connection string to extract account name and key
 * 
 * @param connectionString - Azure Storage connection string
 * @returns Object with accountName and accountKey
 * @throws Error if connection string is invalid
 */
function parseConnectionString(connectionString: string): {
  accountName: string;
  accountKey: string;
} {
  const accountNameMatch = connectionString.match(/AccountName=([^;]+)/);
  const accountKeyMatch = connectionString.match(/AccountKey=([^;]+)/);

  if (!accountNameMatch || !accountKeyMatch) {
    throw new Error('Invalid storage connection string: missing AccountName or AccountKey');
  }

  return {
    accountName: accountNameMatch[1],
    accountKey: accountKeyMatch[1]
  };
}

/**
 * Generate a write-only SAS URL for student photo upload
 * 
 * This function creates a time-limited, write-only SAS URL that allows a student
 * to upload their photo directly to Azure Blob Storage. The URL:
 * - Has write-only ('w') permissions
 * - Expires after 90 seconds (30s capture window + 60s grace period)
 * - Uses blob naming pattern: {sessionId}/{captureRequestId}/{studentId}.jpg
 * 
 * @param sessionId - UUID of the session
 * @param captureRequestId - UUID of the capture request
 * @param studentId - Student email address
 * @returns SAS URL with write-only permissions
 * @throws Error if connection string is invalid or missing
 * 
 * Validates: Requirements 1.4, 3.1, 9.1, 9.2, 9.3, 9.4
 */
export function generateStudentSasUrl(
  sessionId: string,
  captureRequestId: string,
  studentId: string
): string {
  const connectionString = process.env.AzureWebJobsStorage;
  
  if (!connectionString) {
    throw new Error('AzureWebJobsStorage connection string is not configured');
  }

  // Parse connection string to extract credentials
  const { accountName, accountKey } = parseConnectionString(connectionString);

  // Create blob service client
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerName = STUDENT_CAPTURES_CONTAINER;
  
  // Construct blob name: {sessionId}/{captureRequestId}/{studentId}.jpg
  const blobName = `${sessionId}/${captureRequestId}/${studentId}.jpg`;
  
  const containerClient = blobServiceClient.getContainerClient(containerName);
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  // Create shared key credential for SAS generation
  const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);

  // Generate SAS token with write-only permissions and 90-second expiry
  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse('w'), // Write only
      startsOn: new Date(),
      expiresOn: new Date(Date.now() + 90000), // 90 seconds (30s window + 60s grace)
    },
    sharedKeyCredential
  ).toString();

  // Return full URL with SAS token
  return `${blockBlobClient.url}?${sasToken}`;
}

/**
 * Generate a read-only SAS URL for GPT image analysis
 * 
 * This function creates a time-limited, read-only SAS URL that allows GPT
 * to access uploaded student photos for position estimation. The URL:
 * - Has read-only ('r') permissions
 * - Expires after 5 minutes (300 seconds)
 * 
 * @param blobUrl - Full blob URL (without SAS token)
 * @returns SAS URL with read-only permissions
 * @throws Error if connection string is invalid or missing
 * 
 * Validates: Requirements 6.1
 */
export function generateReadSasUrl(blobUrl: string): string {
  const connectionString = process.env.AzureWebJobsStorage;
  
  if (!connectionString) {
    throw new Error('AzureWebJobsStorage connection string is not configured');
  }

  // Parse connection string to extract credentials
  const { accountName, accountKey } = parseConnectionString(connectionString);

  // Extract container and blob name from URL
  // URL format: https://{account}.blob.core.windows.net/{container}/{blobName}
  const urlObj = new URL(blobUrl);
  const pathParts = urlObj.pathname.split('/').filter(p => p);
  
  if (pathParts.length < 2) {
    throw new Error(`Invalid blob URL format: ${blobUrl}`);
  }

  const containerName = pathParts[0];
  const blobName = pathParts.slice(1).join('/');

  // Create blob service client
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  // Create shared key credential for SAS generation
  const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);

  // Generate SAS token with read-only permissions and 5-minute expiry
  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse('r'), // Read only
      startsOn: new Date(),
      expiresOn: new Date(Date.now() + 300000), // 300 seconds (5 minutes)
    },
    sharedKeyCredential
  ).toString();

  // Return full URL with SAS token
  return `${blockBlobClient.url}?${sasToken}`;
}

/**
 * Verify that a blob exists in storage
 * 
 * This function checks if a student's uploaded photo exists in blob storage.
 * Used to validate upload completion before recording in the database.
 * 
 * Handles both URL-encoded and unencoded blob names for compatibility.
 * 
 * @param blobName - Full blob name (e.g., "{sessionId}/{captureRequestId}/{studentId}.jpg")
 * @returns True if blob exists, false otherwise
 * @throws Error if connection string is invalid or storage is unreachable
 * 
 * Validates: Requirements 3.3
 */
export async function verifyBlobExists(blobName: string): Promise<boolean> {
  const connectionString = process.env.AzureWebJobsStorage;
  
  if (!connectionString) {
    throw new Error('AzureWebJobsStorage connection string is not configured');
  }

  try {
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(STUDENT_CAPTURES_CONTAINER);
    
    // First, try with the blob name as provided (should be unencoded)
    const blobClient = containerClient.getBlobClient(blobName);
    let exists = await blobClient.exists();
    
    if (exists) {
      console.log(`Blob found with unencoded name: ${blobName}`);
      return true;
    }
    
    // If not found and blob name contains special characters, try with those encoded
    // This handles cases where @ or other special chars might be encoded in the blob name
    if (blobName.includes('@')) {
      const encodedBlobName = blobName.replace(/@/g, '%40');
      console.log(`Blob not found with unencoded name, trying with encoded @: ${encodedBlobName}`);
      const encodedBlobClient = containerClient.getBlobClient(encodedBlobName);
      exists = await encodedBlobClient.exists();
      
      if (exists) {
        console.log(`Blob found with encoded @ character: ${encodedBlobName}`);
        return true;
      }
    }
    
    console.log(`Blob not found with either encoding: ${blobName}`);
    return false;
  } catch (error) {
    // Log error but don't throw - return false for non-existent blobs
    console.error(`Error verifying blob existence for ${blobName}:`, error);
    throw error;
  }
}
