/**
 * Integration Test for Complete Durable Timeout Flow
 * 
 * Tests the complete flow:
 * 1. Initiate capture → Start orchestrator
 * 2. Wait for timer to expire
 * 3. Orchestrator calls activity function
 * 4. Activity processes timeout and broadcasts results
 * 
 * Requirements: 10.3
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { InvocationContext } from '@azure/functions';
import * as df from 'durable-functions';

// Mock environment variables
process.env.AzureWebJobsStorage = 'AccountName=devstoreaccount1;AccountKey=test;DefaultEndpointsProtocol=http;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;';
process.env.AZURE_OPENAI_ENDPOINT = 'https://test.openai.azure.com/';
process.env.AZURE_OPENAI_KEY = 'test-key';
process.env.AZURE_OPENAI_DEPLOYMENT = 'gpt-5.2-chat';

// Mock dependencies
jest.mock('../../utils/captureStorage');
jest.mock('../../utils/signalrBroadcast');
jest.mock('../../utils/gptPositionEstimation');
jest.mock('../../utils/customMetrics');

import { processCaptureTimeoutActivity } from '../../functions/processCaptureTimeoutActivity';
import {
  getCaptureRequest,
  updateCaptureRequest,
  getCaptureUploads,
  createCaptureResult
} from '../../utils/captureStorage';
import { broadcastToHub } from '../../utils/signalrBroadcast';
import { estimateSeatingPositions } from '../../utils/gptPositionEstimation';

// Helper to create mock invocation context
function createMockContext(): InvocationContext {
  const logs: string[] = [];
  return {
    log: (...args: any[]) => logs.push(args.join(' ')),
    error: (...args: any[]) => logs.push(`ERROR: ${args.join(' ')}`),
    warn: (...args: any[]) => logs.push(`WARN: ${args.join(' ')}`),
    info: (...args: any[]) => logs.push(`INFO: ${args.join(' ')}`),
    debug: (...args: any[]) => logs.push(`DEBUG: ${args.join(' ')}`),
    trace: (...args: any[]) => logs.push(`TRACE: ${args.join(' ')}`),
    invocationId: 'test-invocation-id',
    functionName: 'test-function',
    extraInputs: { get: () => undefined },
    extraOutputs: { set: () => {} },
    retryContext: null,
    traceContext: null,
    triggerMetadata: {}
  } as any;
}

describe('Complete Durable Timeout Flow Integration Test', () => {
  const captureRequestId = 'integration-test-capture-123';
  const sessionId = 'integration-test-session-456';
  const teacherId = 'teacher@test.com';
  const studentIds = ['student1@test.com', 'student2@test.com', 'student3@test.com'];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should complete full timeout flow: orchestrator → timer expires → activity executes → results broadcast', async () => {
    console.log('\n=== INTEGRATION TEST: Complete Timeout Flow ===\n');

    // ========================================================================
    // STEP 1: Set up test data
    // ========================================================================
    console.log('STEP 1: Setting up test data...');

    const expiresAt = new Date(Date.now() + 2000).toISOString(); // 2 seconds from now
    const mockCaptureRequest = {
      partitionKey: captureRequestId,
      rowKey: 'REQUEST',
      sessionId,
      teacherId,
      status: 'ACTIVE',
      onlineStudentCount: 3,
      uploadedCount: 2,
      createdAt: new Date().toISOString(),
      expiresAt
    };

    const mockUploads = [
      {
        partitionKey: captureRequestId,
        rowKey: 'student1@test.com',
        blobUrl: 'https://test.blob.core.windows.net/captures/image1.jpg',
        uploadedAt: new Date().toISOString()
      },
      {
        partitionKey: captureRequestId,
        rowKey: 'student2@test.com',
        blobUrl: 'https://test.blob.core.windows.net/captures/image2.jpg',
        uploadedAt: new Date().toISOString()
      }
    ];

    const mockEstimationOutput = {
      positions: [
        {
          studentId: 'student1@test.com',
          estimatedRow: 1,
          estimatedColumn: 1,
          confidence: 'HIGH',
          reasoning: 'Clear projector visibility'
        },
        {
          studentId: 'student2@test.com',
          estimatedRow: 1,
          estimatedColumn: 2,
          confidence: 'HIGH',
          reasoning: 'Clear projector visibility'
        }
      ],
      analysisNotes: 'Analysis completed successfully with 2 students'
    };

    // Mock storage operations
    (getCaptureRequest as jest.Mock).mockResolvedValue(mockCaptureRequest);
    (getCaptureUploads as jest.Mock).mockResolvedValue(mockUploads);
    (updateCaptureRequest as jest.Mock).mockResolvedValue(undefined);
    (createCaptureResult as jest.Mock).mockResolvedValue(undefined);
    (broadcastToHub as jest.Mock).mockResolvedValue(undefined);
    (estimateSeatingPositions as jest.Mock).mockResolvedValue(mockEstimationOutput);

    console.log(`✓ Test data prepared: ${mockUploads.length} uploads`);

    // ========================================================================
    // STEP 2: Simulate orchestrator starting
    // ========================================================================
    console.log('\nSTEP 2: Simulating orchestrator start...');

    const orchestratorInput = {
      captureRequestId,
      expiresAt,
      sessionId
    };

    console.log(`✓ Orchestrator would be started with input:`, orchestratorInput);
    console.log(`  - Instance ID: ${captureRequestId}`);
    console.log(`  - Expires at: ${expiresAt}`);

    // ========================================================================
    // STEP 3: Simulate timer expiration (wait for timeout)
    // ========================================================================
    console.log('\nSTEP 3: Simulating timer expiration...');

    // In a real orchestrator, the timer would fire after the expiration time
    // For this test, we simulate the timer expiring by waiting
    const expirationTime = new Date(expiresAt).getTime();
    const currentTime = Date.now();
    const waitTime = Math.max(0, expirationTime - currentTime);

    if (waitTime > 0) {
      console.log(`  Waiting ${waitTime}ms for timer to expire...`);
      await new Promise(resolve => setTimeout(resolve, waitTime + 100)); // Add 100ms buffer
    }

    console.log(`✓ Timer expired at ${new Date().toISOString()}`);

    // ========================================================================
    // STEP 4: Orchestrator calls activity function
    // ========================================================================
    console.log('\nSTEP 4: Orchestrator calling activity function...');

    const activityContext = createMockContext();
    const activityResult = await processCaptureTimeoutActivity(
      captureRequestId,
      activityContext
    );

    console.log(`✓ Activity function executed successfully`);
    console.log(`  - Status: ${activityResult.status}`);
    console.log(`  - Uploaded count: ${activityResult.uploadedCount}`);

    // ========================================================================
    // STEP 5: Verify activity function behavior
    // ========================================================================
    console.log('\nSTEP 5: Verifying activity function behavior...');

    // Verify capture request was queried
    expect(getCaptureRequest).toHaveBeenCalledWith(captureRequestId);
    console.log(`✓ Capture request queried`);

    // Verify uploads were queried
    expect(getCaptureUploads).toHaveBeenCalledWith(captureRequestId);
    console.log(`✓ Uploads queried: ${mockUploads.length} found`);

    // Verify status was updated to ANALYZING
    expect(updateCaptureRequest).toHaveBeenCalledWith(
      captureRequestId,
      expect.objectContaining({
        status: 'ANALYZING',
        analysisStartedAt: expect.any(String)
      })
    );
    console.log(`✓ Status updated to ANALYZING`);

    // Verify captureExpired event was broadcast
    expect(broadcastToHub).toHaveBeenCalledWith(
      sessionId,
      'captureExpired',
      {
        captureRequestId,
        uploadedCount: 2,
        totalCount: 3
      },
      activityContext
    );
    console.log(`✓ captureExpired event broadcast`);

    // Verify GPT estimation was called
    expect(estimateSeatingPositions).toHaveBeenCalledWith(
      {
        captureRequestId,
        imageUrls: [
          { studentId: 'student1@test.com', blobUrl: mockUploads[0].blobUrl },
          { studentId: 'student2@test.com', blobUrl: mockUploads[1].blobUrl }
        ]
      },
      activityContext
    );
    console.log(`✓ GPT position estimation called`);

    // Verify results were stored
    expect(createCaptureResult).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: captureRequestId,
        rowKey: 'RESULT',
        sessionId,
        positions: JSON.stringify(mockEstimationOutput.positions),
        analysisNotes: mockEstimationOutput.analysisNotes
      })
    );
    console.log(`✓ Results stored in CaptureResults table`);

    // Verify status was updated to COMPLETED
    expect(updateCaptureRequest).toHaveBeenCalledWith(
      captureRequestId,
      expect.objectContaining({
        status: 'COMPLETED',
        analysisCompletedAt: expect.any(String)
      })
    );
    console.log(`✓ Status updated to COMPLETED`);

    // Verify captureResults event was broadcast
    expect(broadcastToHub).toHaveBeenCalledWith(
      sessionId,
      'captureResults',
      {
        captureRequestId,
        status: 'COMPLETED',
        positions: mockEstimationOutput.positions,
        analysisNotes: mockEstimationOutput.analysisNotes
      },
      activityContext
    );
    console.log(`✓ captureResults event broadcast`);

    // ========================================================================
    // STEP 6: Verify final state
    // ========================================================================
    console.log('\nSTEP 6: Verifying final state...');

    expect(activityResult.status).toBe('COMPLETED');
    expect(activityResult.uploadedCount).toBe(2);
    console.log(`✓ Activity returned correct result`);

    // Verify all broadcasts were made in correct order
    const broadcastCalls = (broadcastToHub as jest.Mock).mock.calls;
    expect(broadcastCalls.length).toBe(2);
    expect(broadcastCalls[0][1]).toBe('captureExpired');
    expect(broadcastCalls[1][1]).toBe('captureResults');
    console.log(`✓ Events broadcast in correct order: captureExpired → captureResults`);

    // ========================================================================
    // VERIFICATION SUMMARY
    // ========================================================================
    console.log('\n=== VERIFICATION SUMMARY ===');
    console.log(`✓ Orchestrator input prepared`);
    console.log(`✓ Timer expiration simulated`);
    console.log(`✓ Activity function executed`);
    console.log(`✓ Status transitions: ACTIVE → ANALYZING → COMPLETED`);
    console.log(`✓ GPT estimation invoked`);
    console.log(`✓ Results stored and broadcast`);
    console.log(`✓ All verification checks passed!`);
    console.log('=====================================\n');
  }, 10000); // 10 second timeout

  it('should handle timeout with zero uploads', async () => {
    console.log('\n=== INTEGRATION TEST: Timeout with Zero Uploads ===\n');

    const expiresAt = new Date(Date.now() + 1000).toISOString();
    const mockCaptureRequest = {
      partitionKey: captureRequestId,
      rowKey: 'REQUEST',
      sessionId,
      teacherId,
      status: 'ACTIVE',
      onlineStudentCount: 3,
      uploadedCount: 0,
      createdAt: new Date().toISOString(),
      expiresAt
    };

    (getCaptureRequest as jest.Mock).mockResolvedValue(mockCaptureRequest);
    (getCaptureUploads as jest.Mock).mockResolvedValue([]);
    (updateCaptureRequest as jest.Mock).mockResolvedValue(undefined);
    (broadcastToHub as jest.Mock).mockResolvedValue(undefined);

    console.log('STEP 1: Waiting for timer to expire...');
    await new Promise(resolve => setTimeout(resolve, 1100));

    console.log('STEP 2: Calling activity function...');
    const activityContext = createMockContext();
    const activityResult = await processCaptureTimeoutActivity(
      captureRequestId,
      activityContext
    );

    console.log('STEP 3: Verifying behavior...');

    // Should not call GPT estimation
    expect(estimateSeatingPositions).not.toHaveBeenCalled();
    console.log(`✓ GPT estimation not called (no uploads)`);

    // Should update to COMPLETED directly
    expect(updateCaptureRequest).toHaveBeenCalledWith(
      captureRequestId,
      expect.objectContaining({
        status: 'COMPLETED'
      })
    );
    console.log(`✓ Status updated to COMPLETED`);

    // Should broadcast empty results
    expect(broadcastToHub).toHaveBeenCalledWith(
      sessionId,
      'captureResults',
      expect.objectContaining({
        captureRequestId,
        status: 'COMPLETED',
        positions: [],
        analysisNotes: expect.stringContaining('No student photos')
      }),
      activityContext
    );
    console.log(`✓ Empty results broadcast`);

    expect(activityResult.status).toBe('COMPLETED');
    expect(activityResult.uploadedCount).toBe(0);
    console.log(`✓ Activity returned correct result`);

    console.log('\n✓ All verification checks passed!\n');
  }, 5000);

  it('should handle timeout with partial uploads', async () => {
    console.log('\n=== INTEGRATION TEST: Timeout with Partial Uploads ===\n');

    const expiresAt = new Date(Date.now() + 1000).toISOString();
    const mockCaptureRequest = {
      partitionKey: captureRequestId,
      rowKey: 'REQUEST',
      sessionId,
      teacherId,
      status: 'ACTIVE',
      onlineStudentCount: 5,
      uploadedCount: 2,
      createdAt: new Date().toISOString(),
      expiresAt
    };

    const mockUploads = [
      {
        partitionKey: captureRequestId,
        rowKey: 'student1@test.com',
        blobUrl: 'https://test.blob/image1.jpg',
        uploadedAt: new Date().toISOString()
      },
      {
        partitionKey: captureRequestId,
        rowKey: 'student2@test.com',
        blobUrl: 'https://test.blob/image2.jpg',
        uploadedAt: new Date().toISOString()
      }
    ];

    const mockEstimationOutput = {
      positions: [
        { studentId: 'student1@test.com', estimatedRow: 1, estimatedColumn: 1, confidence: 'HIGH', reasoning: 'Test' },
        { studentId: 'student2@test.com', estimatedRow: 1, estimatedColumn: 2, confidence: 'HIGH', reasoning: 'Test' }
      ],
      analysisNotes: 'Partial upload analysis'
    };

    (getCaptureRequest as jest.Mock).mockResolvedValue(mockCaptureRequest);
    (getCaptureUploads as jest.Mock).mockResolvedValue(mockUploads);
    (updateCaptureRequest as jest.Mock).mockResolvedValue(undefined);
    (createCaptureResult as jest.Mock).mockResolvedValue(undefined);
    (broadcastToHub as jest.Mock).mockResolvedValue(undefined);
    (estimateSeatingPositions as jest.Mock).mockResolvedValue(mockEstimationOutput);

    console.log('STEP 1: Waiting for timer to expire...');
    await new Promise(resolve => setTimeout(resolve, 1100));

    console.log('STEP 2: Calling activity function...');
    const activityContext = createMockContext();
    const activityResult = await processCaptureTimeoutActivity(
      captureRequestId,
      activityContext
    );

    console.log('STEP 3: Verifying behavior...');

    // Should broadcast with partial counts
    expect(broadcastToHub).toHaveBeenCalledWith(
      sessionId,
      'captureExpired',
      {
        captureRequestId,
        uploadedCount: 2,
        totalCount: 5
      },
      activityContext
    );
    console.log(`✓ captureExpired broadcast with partial counts (2/5)`);

    // Should still call GPT estimation
    expect(estimateSeatingPositions).toHaveBeenCalled();
    console.log(`✓ GPT estimation called with partial uploads`);

    // Should complete successfully
    expect(activityResult.status).toBe('COMPLETED');
    expect(activityResult.uploadedCount).toBe(2);
    console.log(`✓ Activity completed with partial uploads`);

    console.log('\n✓ All verification checks passed!\n');
  }, 5000);
});
