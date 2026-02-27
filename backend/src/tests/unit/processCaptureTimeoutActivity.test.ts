/**
 * Unit Tests for Process Capture Timeout Activity Function
 * 
 * Tests the activity function logic including:
 * - Upload query logic
 * - Status transitions
 * - Position estimation invocation
 * - Result broadcasting
 * - Error handling
 * 
 * Requirements: 10.2
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { InvocationContext } from '@azure/functions';

// Mock all dependencies
jest.mock('../../utils/captureStorage');
jest.mock('../../utils/signalrBroadcast');
jest.mock('../../utils/gptPositionEstimation');
jest.mock('../../utils/errorLogging');
jest.mock('../../utils/customMetrics');

// Import after mocking
import { processCaptureTimeoutActivity } from '../../functions/processCaptureTimeoutActivity';
import {
  getCaptureRequest,
  updateCaptureRequest,
  getCaptureUploads,
  createCaptureResult
} from '../../utils/captureStorage';
import { broadcastToHub } from '../../utils/signalrBroadcast';
import { estimateSeatingPositions } from '../../utils/gptPositionEstimation';
import { logError, logInfo, logWarning } from '../../utils/errorLogging';
import {
  trackActivitySuccess,
  trackUploadCount
} from '../../utils/customMetrics';

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
    functionName: 'processCaptureTimeoutActivity',
    extraInputs: { get: () => undefined },
    extraOutputs: { set: () => {} },
    retryContext: null,
    traceContext: null,
    triggerMetadata: {}
  } as any;
}

describe('processCaptureTimeoutActivity', () => {
  const captureRequestId = 'test-capture-123';
  const sessionId = 'test-session-456';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Upload Query Logic', () => {
    it('should query capture request by ID', async () => {
      const mockCaptureRequest = {
        partitionKey: captureRequestId,
        rowKey: 'REQUEST',
        sessionId,
        status: 'ACTIVE',
        onlineStudentCount: 3,
        uploadedCount: 0,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString()
      };

      (getCaptureRequest as jest.Mock).mockResolvedValue(mockCaptureRequest);
      (getCaptureUploads as jest.Mock).mockResolvedValue([]);
      (updateCaptureRequest as jest.Mock).mockResolvedValue(undefined);
      (broadcastToHub as jest.Mock).mockResolvedValue(undefined);

      const context = createMockContext();
      await processCaptureTimeoutActivity(captureRequestId, context);

      expect(getCaptureRequest).toHaveBeenCalledWith(captureRequestId);
    });

    it('should throw error if capture request not found', async () => {
      (getCaptureRequest as jest.Mock).mockResolvedValue(null);

      const context = createMockContext();
      
      await expect(
        processCaptureTimeoutActivity(captureRequestId, context)
      ).rejects.toThrow(`Capture request not found: ${captureRequestId}`);
    });

    it('should query all uploads for the capture request', async () => {
      const mockCaptureRequest = {
        partitionKey: captureRequestId,
        rowKey: 'REQUEST',
        sessionId,
        status: 'ACTIVE',
        onlineStudentCount: 3,
        uploadedCount: 2
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

      (getCaptureRequest as jest.Mock).mockResolvedValue(mockCaptureRequest);
      (getCaptureUploads as jest.Mock).mockResolvedValue(mockUploads);
      (updateCaptureRequest as jest.Mock).mockResolvedValue(undefined);
      (broadcastToHub as jest.Mock).mockResolvedValue(undefined);
      (estimateSeatingPositions as jest.Mock).mockResolvedValue({
        positions: [],
        analysisNotes: 'Test'
      });
      (createCaptureResult as jest.Mock).mockResolvedValue(undefined);

      const context = createMockContext();
      await processCaptureTimeoutActivity(captureRequestId, context);

      expect(getCaptureUploads).toHaveBeenCalledWith(captureRequestId);
    });

    it('should calculate uploaded count correctly', async () => {
      const mockCaptureRequest = {
        partitionKey: captureRequestId,
        rowKey: 'REQUEST',
        sessionId,
        status: 'ACTIVE',
        onlineStudentCount: 5,
        uploadedCount: 3
      };

      const mockUploads = [
        { rowKey: 'student1@test.com', blobUrl: 'url1' },
        { rowKey: 'student2@test.com', blobUrl: 'url2' },
        { rowKey: 'student3@test.com', blobUrl: 'url3' }
      ];

      (getCaptureRequest as jest.Mock).mockResolvedValue(mockCaptureRequest);
      (getCaptureUploads as jest.Mock).mockResolvedValue(mockUploads);
      (updateCaptureRequest as jest.Mock).mockResolvedValue(undefined);
      (broadcastToHub as jest.Mock).mockResolvedValue(undefined);
      (estimateSeatingPositions as jest.Mock).mockResolvedValue({
        positions: [],
        analysisNotes: 'Test'
      });
      (createCaptureResult as jest.Mock).mockResolvedValue(undefined);

      const context = createMockContext();
      const result = await processCaptureTimeoutActivity(captureRequestId, context);

      expect(result.uploadedCount).toBe(3);
      expect(trackUploadCount).toHaveBeenCalledWith(
        context,
        captureRequestId,
        3,
        5
      );
    });
  });

  describe('Status Transitions', () => {
    it('should update status to ANALYZING at start', async () => {
      const mockCaptureRequest = {
        partitionKey: captureRequestId,
        rowKey: 'REQUEST',
        sessionId,
        status: 'ACTIVE',
        onlineStudentCount: 3,
        uploadedCount: 0
      };

      (getCaptureRequest as jest.Mock).mockResolvedValue(mockCaptureRequest);
      (getCaptureUploads as jest.Mock).mockResolvedValue([]);
      (updateCaptureRequest as jest.Mock).mockResolvedValue(undefined);
      (broadcastToHub as jest.Mock).mockResolvedValue(undefined);

      const context = createMockContext();
      await processCaptureTimeoutActivity(captureRequestId, context);

      expect(updateCaptureRequest).toHaveBeenCalledWith(
        captureRequestId,
        expect.objectContaining({
          status: 'ANALYZING',
          analysisStartedAt: expect.any(String)
        })
      );
    });

    it('should update status to COMPLETED when uploads > 0 and estimation succeeds', async () => {
      const mockCaptureRequest = {
        partitionKey: captureRequestId,
        rowKey: 'REQUEST',
        sessionId,
        status: 'ACTIVE',
        onlineStudentCount: 2,
        uploadedCount: 2
      };

      const mockUploads = [
        { rowKey: 'student1@test.com', blobUrl: 'url1' },
        { rowKey: 'student2@test.com', blobUrl: 'url2' }
      ];

      (getCaptureRequest as jest.Mock).mockResolvedValue(mockCaptureRequest);
      (getCaptureUploads as jest.Mock).mockResolvedValue(mockUploads);
      (updateCaptureRequest as jest.Mock).mockResolvedValue(undefined);
      (broadcastToHub as jest.Mock).mockResolvedValue(undefined);
      (estimateSeatingPositions as jest.Mock).mockResolvedValue({
        positions: [{ studentId: 'student1@test.com', estimatedRow: 1, estimatedColumn: 1 }],
        analysisNotes: 'Success'
      });
      (createCaptureResult as jest.Mock).mockResolvedValue(undefined);

      const context = createMockContext();
      const result = await processCaptureTimeoutActivity(captureRequestId, context);

      expect(result.status).toBe('COMPLETED');
      expect(updateCaptureRequest).toHaveBeenCalledWith(
        captureRequestId,
        expect.objectContaining({
          status: 'COMPLETED',
          analysisCompletedAt: expect.any(String)
        })
      );
    });

    it('should update status to COMPLETED when uploads = 0', async () => {
      const mockCaptureRequest = {
        partitionKey: captureRequestId,
        rowKey: 'REQUEST',
        sessionId,
        status: 'ACTIVE',
        onlineStudentCount: 3,
        uploadedCount: 0
      };

      (getCaptureRequest as jest.Mock).mockResolvedValue(mockCaptureRequest);
      (getCaptureUploads as jest.Mock).mockResolvedValue([]);
      (updateCaptureRequest as jest.Mock).mockResolvedValue(undefined);
      (broadcastToHub as jest.Mock).mockResolvedValue(undefined);

      const context = createMockContext();
      const result = await processCaptureTimeoutActivity(captureRequestId, context);

      expect(result.status).toBe('COMPLETED');
      expect(result.uploadedCount).toBe(0);
      expect(updateCaptureRequest).toHaveBeenCalledWith(
        captureRequestId,
        expect.objectContaining({
          status: 'COMPLETED',
          analysisCompletedAt: expect.any(String)
        })
      );
    });

    it('should update status to FAILED when estimation fails', async () => {
      const mockCaptureRequest = {
        partitionKey: captureRequestId,
        rowKey: 'REQUEST',
        sessionId,
        status: 'ACTIVE',
        onlineStudentCount: 2,
        uploadedCount: 2
      };

      const mockUploads = [
        { rowKey: 'student1@test.com', blobUrl: 'url1' },
        { rowKey: 'student2@test.com', blobUrl: 'url2' }
      ];

      const estimationError = new Error('GPT API failed');

      (getCaptureRequest as jest.Mock).mockResolvedValue(mockCaptureRequest);
      (getCaptureUploads as jest.Mock).mockResolvedValue(mockUploads);
      (updateCaptureRequest as jest.Mock).mockResolvedValue(undefined);
      (broadcastToHub as jest.Mock).mockResolvedValue(undefined);
      (estimateSeatingPositions as jest.Mock).mockRejectedValue(estimationError);

      const context = createMockContext();
      
      await expect(
        processCaptureTimeoutActivity(captureRequestId, context)
      ).rejects.toThrow('GPT API failed');

      expect(updateCaptureRequest).toHaveBeenCalledWith(
        captureRequestId,
        expect.objectContaining({
          status: 'FAILED',
          analysisCompletedAt: expect.any(String),
          errorMessage: expect.stringContaining('GPT API failed')
        })
      );
    });
  });

  describe('Position Estimation Invocation', () => {
    it('should not call estimation when uploads = 0', async () => {
      const mockCaptureRequest = {
        partitionKey: captureRequestId,
        rowKey: 'REQUEST',
        sessionId,
        status: 'ACTIVE',
        onlineStudentCount: 3,
        uploadedCount: 0
      };

      (getCaptureRequest as jest.Mock).mockResolvedValue(mockCaptureRequest);
      (getCaptureUploads as jest.Mock).mockResolvedValue([]);
      (updateCaptureRequest as jest.Mock).mockResolvedValue(undefined);
      (broadcastToHub as jest.Mock).mockResolvedValue(undefined);

      const context = createMockContext();
      await processCaptureTimeoutActivity(captureRequestId, context);

      expect(estimateSeatingPositions).not.toHaveBeenCalled();
    });

    it('should call estimation with correct input when uploads > 0', async () => {
      const mockCaptureRequest = {
        partitionKey: captureRequestId,
        rowKey: 'REQUEST',
        sessionId,
        status: 'ACTIVE',
        onlineStudentCount: 2,
        uploadedCount: 2
      };

      const mockUploads = [
        { rowKey: 'student1@test.com', blobUrl: 'https://test.blob/image1.jpg' },
        { rowKey: 'student2@test.com', blobUrl: 'https://test.blob/image2.jpg' }
      ];

      (getCaptureRequest as jest.Mock).mockResolvedValue(mockCaptureRequest);
      (getCaptureUploads as jest.Mock).mockResolvedValue(mockUploads);
      (updateCaptureRequest as jest.Mock).mockResolvedValue(undefined);
      (broadcastToHub as jest.Mock).mockResolvedValue(undefined);
      (estimateSeatingPositions as jest.Mock).mockResolvedValue({
        positions: [],
        analysisNotes: 'Test'
      });
      (createCaptureResult as jest.Mock).mockResolvedValue(undefined);

      const context = createMockContext();
      await processCaptureTimeoutActivity(captureRequestId, context);

      expect(estimateSeatingPositions).toHaveBeenCalledWith(
        {
          captureRequestId,
          imageUrls: [
            { studentId: 'student1@test.com', blobUrl: 'https://test.blob/image1.jpg' },
            { studentId: 'student2@test.com', blobUrl: 'https://test.blob/image2.jpg' }
          ]
        },
        context
      );
    });

    it('should store estimation results in CaptureResults table', async () => {
      const mockCaptureRequest = {
        partitionKey: captureRequestId,
        rowKey: 'REQUEST',
        sessionId,
        status: 'ACTIVE',
        onlineStudentCount: 2,
        uploadedCount: 2
      };

      const mockUploads = [
        { rowKey: 'student1@test.com', blobUrl: 'url1' }
      ];

      const mockEstimationOutput = {
        positions: [
          {
            studentId: 'student1@test.com',
            estimatedRow: 1,
            estimatedColumn: 1,
            confidence: 'HIGH',
            reasoning: 'Clear view'
          }
        ],
        analysisNotes: 'Analysis completed successfully'
      };

      (getCaptureRequest as jest.Mock).mockResolvedValue(mockCaptureRequest);
      (getCaptureUploads as jest.Mock).mockResolvedValue(mockUploads);
      (updateCaptureRequest as jest.Mock).mockResolvedValue(undefined);
      (broadcastToHub as jest.Mock).mockResolvedValue(undefined);
      (estimateSeatingPositions as jest.Mock).mockResolvedValue(mockEstimationOutput);
      (createCaptureResult as jest.Mock).mockResolvedValue(undefined);

      const context = createMockContext();
      await processCaptureTimeoutActivity(captureRequestId, context);

      expect(createCaptureResult).toHaveBeenCalledWith(
        expect.objectContaining({
          partitionKey: captureRequestId,
          rowKey: 'RESULT',
          sessionId,
          positions: JSON.stringify(mockEstimationOutput.positions),
          analysisNotes: mockEstimationOutput.analysisNotes,
          analyzedAt: expect.any(String)
        })
      );
    });
  });

  describe('Result Broadcasting', () => {
    it('should broadcast captureExpired event with upload counts', async () => {
      const mockCaptureRequest = {
        partitionKey: captureRequestId,
        rowKey: 'REQUEST',
        sessionId,
        status: 'ACTIVE',
        onlineStudentCount: 3,
        uploadedCount: 2
      };

      const mockUploads = [
        { rowKey: 'student1@test.com', blobUrl: 'url1' },
        { rowKey: 'student2@test.com', blobUrl: 'url2' }
      ];

      (getCaptureRequest as jest.Mock).mockResolvedValue(mockCaptureRequest);
      (getCaptureUploads as jest.Mock).mockResolvedValue(mockUploads);
      (updateCaptureRequest as jest.Mock).mockResolvedValue(undefined);
      (broadcastToHub as jest.Mock).mockResolvedValue(undefined);
      (estimateSeatingPositions as jest.Mock).mockResolvedValue({
        positions: [],
        analysisNotes: 'Test'
      });
      (createCaptureResult as jest.Mock).mockResolvedValue(undefined);

      const context = createMockContext();
      await processCaptureTimeoutActivity(captureRequestId, context);

      expect(broadcastToHub).toHaveBeenCalledWith(
        sessionId,
        'captureExpired',
        {
          captureRequestId,
          uploadedCount: 2,
          totalCount: 3
        },
        context
      );
    });

    it('should broadcast captureResults with positions on success', async () => {
      const mockCaptureRequest = {
        partitionKey: captureRequestId,
        rowKey: 'REQUEST',
        sessionId,
        status: 'ACTIVE',
        onlineStudentCount: 1,
        uploadedCount: 1
      };

      const mockUploads = [
        { rowKey: 'student1@test.com', blobUrl: 'url1' }
      ];

      const mockPositions = [
        {
          studentId: 'student1@test.com',
          estimatedRow: 1,
          estimatedColumn: 1,
          confidence: 'HIGH',
          reasoning: 'Clear view'
        }
      ];

      (getCaptureRequest as jest.Mock).mockResolvedValue(mockCaptureRequest);
      (getCaptureUploads as jest.Mock).mockResolvedValue(mockUploads);
      (updateCaptureRequest as jest.Mock).mockResolvedValue(undefined);
      (broadcastToHub as jest.Mock).mockResolvedValue(undefined);
      (estimateSeatingPositions as jest.Mock).mockResolvedValue({
        positions: mockPositions,
        analysisNotes: 'Success'
      });
      (createCaptureResult as jest.Mock).mockResolvedValue(undefined);

      const context = createMockContext();
      await processCaptureTimeoutActivity(captureRequestId, context);

      expect(broadcastToHub).toHaveBeenCalledWith(
        sessionId,
        'captureResults',
        {
          captureRequestId,
          status: 'COMPLETED',
          positions: mockPositions,
          analysisNotes: 'Success'
        },
        context
      );
    });

    it('should broadcast captureResults with empty positions when uploads = 0', async () => {
      const mockCaptureRequest = {
        partitionKey: captureRequestId,
        rowKey: 'REQUEST',
        sessionId,
        status: 'ACTIVE',
        onlineStudentCount: 3,
        uploadedCount: 0
      };

      (getCaptureRequest as jest.Mock).mockResolvedValue(mockCaptureRequest);
      (getCaptureUploads as jest.Mock).mockResolvedValue([]);
      (updateCaptureRequest as jest.Mock).mockResolvedValue(undefined);
      (broadcastToHub as jest.Mock).mockResolvedValue(undefined);

      const context = createMockContext();
      await processCaptureTimeoutActivity(captureRequestId, context);

      expect(broadcastToHub).toHaveBeenCalledWith(
        sessionId,
        'captureResults',
        {
          captureRequestId,
          status: 'COMPLETED',
          positions: [],
          analysisNotes: 'No student photos were uploaded during the capture window'
        },
        context
      );
    });

    it('should broadcast error message on estimation failure', async () => {
      const mockCaptureRequest = {
        partitionKey: captureRequestId,
        rowKey: 'REQUEST',
        sessionId,
        status: 'ACTIVE',
        onlineStudentCount: 1,
        uploadedCount: 1
      };

      const mockUploads = [
        { rowKey: 'student1@test.com', blobUrl: 'url1' }
      ];

      const estimationError = new Error('GPT timeout');

      (getCaptureRequest as jest.Mock).mockResolvedValue(mockCaptureRequest);
      (getCaptureUploads as jest.Mock).mockResolvedValue(mockUploads);
      (updateCaptureRequest as jest.Mock).mockResolvedValue(undefined);
      (broadcastToHub as jest.Mock).mockResolvedValue(undefined);
      (estimateSeatingPositions as jest.Mock).mockRejectedValue(estimationError);

      const context = createMockContext();
      
      await expect(
        processCaptureTimeoutActivity(captureRequestId, context)
      ).rejects.toThrow();

      expect(broadcastToHub).toHaveBeenCalledWith(
        sessionId,
        'captureResults',
        expect.objectContaining({
          captureRequestId,
          status: 'FAILED',
          errorMessage: expect.stringContaining('GPT timeout')
        }),
        context
      );
    });
  });

  describe('Error Handling', () => {
    it('should log errors with context', async () => {
      const mockCaptureRequest = {
        partitionKey: captureRequestId,
        rowKey: 'REQUEST',
        sessionId,
        status: 'ACTIVE',
        onlineStudentCount: 1,
        uploadedCount: 1
      };

      const mockUploads = [
        { rowKey: 'student1@test.com', blobUrl: 'url1' }
      ];

      const estimationError = new Error('Test error');

      (getCaptureRequest as jest.Mock).mockResolvedValue(mockCaptureRequest);
      (getCaptureUploads as jest.Mock).mockResolvedValue(mockUploads);
      (updateCaptureRequest as jest.Mock).mockResolvedValue(undefined);
      (broadcastToHub as jest.Mock).mockResolvedValue(undefined);
      (estimateSeatingPositions as jest.Mock).mockRejectedValue(estimationError);

      const context = createMockContext();
      
      await expect(
        processCaptureTimeoutActivity(captureRequestId, context)
      ).rejects.toThrow();

      expect(logError).toHaveBeenCalledWith(
        context,
        'GPT position estimation failed',
        estimationError,
        expect.objectContaining({
          sessionId,
          captureRequestId
        })
      );
    });

    it('should track failure metrics on error', async () => {
      const mockCaptureRequest = {
        partitionKey: captureRequestId,
        rowKey: 'REQUEST',
        sessionId,
        status: 'ACTIVE',
        onlineStudentCount: 1,
        uploadedCount: 1
      };

      const mockUploads = [
        { rowKey: 'student1@test.com', blobUrl: 'url1' }
      ];

      (getCaptureRequest as jest.Mock).mockResolvedValue(mockCaptureRequest);
      (getCaptureUploads as jest.Mock).mockResolvedValue(mockUploads);
      (updateCaptureRequest as jest.Mock).mockResolvedValue(undefined);
      (broadcastToHub as jest.Mock).mockResolvedValue(undefined);
      (estimateSeatingPositions as jest.Mock).mockRejectedValue(new Error('Test'));

      const context = createMockContext();
      
      await expect(
        processCaptureTimeoutActivity(captureRequestId, context)
      ).rejects.toThrow();

      expect(trackActivitySuccess).toHaveBeenCalledWith(
        context,
        captureRequestId,
        1,
        false
      );
    });

    it('should track success metrics on completion', async () => {
      const mockCaptureRequest = {
        partitionKey: captureRequestId,
        rowKey: 'REQUEST',
        sessionId,
        status: 'ACTIVE',
        onlineStudentCount: 1,
        uploadedCount: 1
      };

      const mockUploads = [
        { rowKey: 'student1@test.com', blobUrl: 'url1' }
      ];

      (getCaptureRequest as jest.Mock).mockResolvedValue(mockCaptureRequest);
      (getCaptureUploads as jest.Mock).mockResolvedValue(mockUploads);
      (updateCaptureRequest as jest.Mock).mockResolvedValue(undefined);
      (broadcastToHub as jest.Mock).mockResolvedValue(undefined);
      (estimateSeatingPositions as jest.Mock).mockResolvedValue({
        positions: [],
        analysisNotes: 'Test'
      });
      (createCaptureResult as jest.Mock).mockResolvedValue(undefined);

      const context = createMockContext();
      await processCaptureTimeoutActivity(captureRequestId, context);

      expect(trackActivitySuccess).toHaveBeenCalledWith(
        context,
        captureRequestId,
        1,
        true
      );
    });

    it('should re-throw errors to trigger orchestrator retry', async () => {
      const mockCaptureRequest = {
        partitionKey: captureRequestId,
        rowKey: 'REQUEST',
        sessionId,
        status: 'ACTIVE',
        onlineStudentCount: 1,
        uploadedCount: 1
      };

      const mockUploads = [
        { rowKey: 'student1@test.com', blobUrl: 'url1' }
      ];

      const estimationError = new Error('Retry me');

      (getCaptureRequest as jest.Mock).mockResolvedValue(mockCaptureRequest);
      (getCaptureUploads as jest.Mock).mockResolvedValue(mockUploads);
      (updateCaptureRequest as jest.Mock).mockResolvedValue(undefined);
      (broadcastToHub as jest.Mock).mockResolvedValue(undefined);
      (estimateSeatingPositions as jest.Mock).mockRejectedValue(estimationError);

      const context = createMockContext();
      
      await expect(
        processCaptureTimeoutActivity(captureRequestId, context)
      ).rejects.toThrow('Retry me');
    });
  });
});
