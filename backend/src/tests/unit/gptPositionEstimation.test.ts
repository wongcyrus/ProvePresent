/**
 * Unit tests for GPT Position Estimation with Overlapping Batches
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { InvocationContext } from '@azure/functions';

// Mock the dependencies
jest.mock('../../utils/blobStorage', () => ({
  generateReadSasUrl: jest.fn((url: string) => `${url}?sas=mock-token`)
}));

// Import after mocking
import { estimateSeatingPositions } from '../../utils/gptPositionEstimation';
import type { PositionEstimationInput } from '../../types/studentImageCapture';

describe('GPT Position Estimation - Overlapping Batches', () => {
  let mockContext: InvocationContext;
  let mockFetch: any;

  beforeEach(() => {
    // Mock context
    mockContext = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      invocationId: 'test-invocation-id',
      functionName: 'test-function',
      extraInputs: { get: jest.fn() },
      extraOutputs: { set: jest.fn() }
    } as any;

    // Mock fetch for GPT API calls
    mockFetch = jest.fn();
    global.fetch = mockFetch;

    // Mock environment variables
    process.env.AZURE_OPENAI_ENDPOINT = 'https://test.openai.azure.com';
    process.env.AZURE_OPENAI_KEY = 'test-key';
    process.env.AZURE_OPENAI_VISION_DEPLOYMENT = 'gpt-5.4';
  });

  describe('Single Batch (≤10 students)', () => {
    it('should process 10 students in a single batch', async () => {
      const input: PositionEstimationInput = {
        captureRequestId: 'test-capture-1',
        imageUrls: Array.from({ length: 10 }, (_, i) => ({
          studentId: `student${i + 1}@test.com`,
          blobUrl: `https://storage.blob.core.windows.net/images/student${i + 1}.jpg`
        }))
      };

      // Mock GPT response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                positions: Array.from({ length: 10 }, (_, i) => ({
                  studentId: `student${i + 1}@test.com`,
                  estimatedRow: Math.floor(i / 3) + 1,
                  estimatedColumn: (i % 3) + 1,
                  confidence: 'HIGH',
                  reasoning: `Student ${i + 1} analysis`
                })),
                analysisNotes: 'Single batch analysis'
              })
            }
          }],
          usage: { total_tokens: 2500 }
        })
      });

      const result = await estimateSeatingPositions(input, mockContext);

      expect(result.positions).toHaveLength(10);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockContext.log).toHaveBeenCalledWith('Processing single batch (10 or fewer images)');
    });
  });

  describe('Overlapping Batches (>10 students)', () => {
    it('should split 25 students into overlapping batches', async () => {
      const input: PositionEstimationInput = {
        captureRequestId: 'test-capture-2',
        imageUrls: Array.from({ length: 25 }, (_, i) => ({
          studentId: `student${i + 1}@test.com`,
          blobUrl: `https://storage.blob.core.windows.net/images/student${i + 1}.jpg`
        }))
      };

      // Mock GPT responses for each batch
      // Batch 1: Students 1-10
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                positions: [
                  { studentId: 'student1@test.com', estimatedRow: 1, estimatedColumn: 1, confidence: 'HIGH', reasoning: 'Front left' },
                  { studentId: 'student2@test.com', estimatedRow: 1, estimatedColumn: 2, confidence: 'HIGH', reasoning: 'Front center' },
                  { studentId: 'student3@test.com', estimatedRow: 1, estimatedColumn: 3, confidence: 'HIGH', reasoning: 'Front right' },
                  { studentId: 'student4@test.com', estimatedRow: 2, estimatedColumn: 1, confidence: 'HIGH', reasoning: 'Second row left' },
                  { studentId: 'student5@test.com', estimatedRow: 2, estimatedColumn: 2, confidence: 'HIGH', reasoning: 'Second row center' },
                  { studentId: 'student6@test.com', estimatedRow: 2, estimatedColumn: 3, confidence: 'HIGH', reasoning: 'Second row right' },
                  { studentId: 'student7@test.com', estimatedRow: 3, estimatedColumn: 1, confidence: 'HIGH', reasoning: 'Third row left' },
                  { studentId: 'student8@test.com', estimatedRow: 3, estimatedColumn: 2, confidence: 'HIGH', reasoning: 'Third row center' },
                  { studentId: 'student9@test.com', estimatedRow: 3, estimatedColumn: 3, confidence: 'HIGH', reasoning: 'Third row right' },
                  { studentId: 'student10@test.com', estimatedRow: 4, estimatedColumn: 1, confidence: 'HIGH', reasoning: 'Fourth row left' }
                ],
                analysisNotes: 'Batch 1 analysis'
              })
            }
          }],
          usage: { total_tokens: 2500 }
        })
      });

      // Batch 2: Students 8-17 (overlap: 8, 9, 10)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                positions: [
                  { studentId: 'student8@test.com', estimatedRow: 1, estimatedColumn: 2, confidence: 'HIGH', reasoning: 'Front center (overlap)' },
                  { studentId: 'student9@test.com', estimatedRow: 1, estimatedColumn: 3, confidence: 'HIGH', reasoning: 'Front right (overlap)' },
                  { studentId: 'student10@test.com', estimatedRow: 2, estimatedColumn: 1, confidence: 'HIGH', reasoning: 'Second row left (overlap)' },
                  { studentId: 'student11@test.com', estimatedRow: 2, estimatedColumn: 2, confidence: 'HIGH', reasoning: 'Second row center' },
                  { studentId: 'student12@test.com', estimatedRow: 2, estimatedColumn: 3, confidence: 'HIGH', reasoning: 'Second row right' },
                  { studentId: 'student13@test.com', estimatedRow: 3, estimatedColumn: 1, confidence: 'HIGH', reasoning: 'Third row left' },
                  { studentId: 'student14@test.com', estimatedRow: 3, estimatedColumn: 2, confidence: 'HIGH', reasoning: 'Third row center' },
                  { studentId: 'student15@test.com', estimatedRow: 3, estimatedColumn: 3, confidence: 'HIGH', reasoning: 'Third row right' },
                  { studentId: 'student16@test.com', estimatedRow: 4, estimatedColumn: 1, confidence: 'HIGH', reasoning: 'Fourth row left' },
                  { studentId: 'student17@test.com', estimatedRow: 4, estimatedColumn: 2, confidence: 'HIGH', reasoning: 'Fourth row center' }
                ],
                analysisNotes: 'Batch 2 analysis'
              })
            }
          }],
          usage: { total_tokens: 2500 }
        })
      });

      // Batch 3: Students 15-24 (overlap: 15, 16, 17)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                positions: [
                  { studentId: 'student15@test.com', estimatedRow: 1, estimatedColumn: 3, confidence: 'HIGH', reasoning: 'Front right (overlap)' },
                  { studentId: 'student16@test.com', estimatedRow: 2, estimatedColumn: 1, confidence: 'HIGH', reasoning: 'Second row left (overlap)' },
                  { studentId: 'student17@test.com', estimatedRow: 2, estimatedColumn: 2, confidence: 'HIGH', reasoning: 'Second row center (overlap)' },
                  { studentId: 'student18@test.com', estimatedRow: 2, estimatedColumn: 3, confidence: 'HIGH', reasoning: 'Second row right' },
                  { studentId: 'student19@test.com', estimatedRow: 3, estimatedColumn: 1, confidence: 'HIGH', reasoning: 'Third row left' },
                  { studentId: 'student20@test.com', estimatedRow: 3, estimatedColumn: 2, confidence: 'HIGH', reasoning: 'Third row center' },
                  { studentId: 'student21@test.com', estimatedRow: 3, estimatedColumn: 3, confidence: 'HIGH', reasoning: 'Third row right' },
                  { studentId: 'student22@test.com', estimatedRow: 4, estimatedColumn: 1, confidence: 'HIGH', reasoning: 'Fourth row left' },
                  { studentId: 'student23@test.com', estimatedRow: 4, estimatedColumn: 2, confidence: 'HIGH', reasoning: 'Fourth row center' },
                  { studentId: 'student24@test.com', estimatedRow: 4, estimatedColumn: 3, confidence: 'HIGH', reasoning: 'Fourth row right' }
                ],
                analysisNotes: 'Batch 3 analysis'
              })
            }
          }],
          usage: { total_tokens: 2500 }
        })
      });

      // Batch 4: Students 22-25 (overlap: 22, 23, 24)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                positions: [
                  { studentId: 'student22@test.com', estimatedRow: 1, estimatedColumn: 1, confidence: 'HIGH', reasoning: 'Front left (overlap)' },
                  { studentId: 'student23@test.com', estimatedRow: 1, estimatedColumn: 2, confidence: 'HIGH', reasoning: 'Front center (overlap)' },
                  { studentId: 'student24@test.com', estimatedRow: 1, estimatedColumn: 3, confidence: 'HIGH', reasoning: 'Front right (overlap)' },
                  { studentId: 'student25@test.com', estimatedRow: 2, estimatedColumn: 1, confidence: 'HIGH', reasoning: 'Second row left' }
                ],
                analysisNotes: 'Batch 4 analysis'
              })
            }
          }],
          usage: { total_tokens: 1200 }
        })
      });

      const result = await estimateSeatingPositions(input, mockContext);

      // Verify results
      expect(result.positions).toHaveLength(25); // All 25 unique students
      expect(mockFetch).toHaveBeenCalledTimes(4); // 4 batches

      // Verify overlapping batches were created
      expect(mockContext.log).toHaveBeenCalledWith(expect.stringContaining('Split 25 images into 4 overlapping batches'));

      // Verify alignment was performed
      expect(mockContext.log).toHaveBeenCalledWith('Aligning batches using overlapping students...');

      // Verify overlapping students were found
      expect(mockContext.log).toHaveBeenCalledWith(expect.stringContaining('Found 3 overlapping students'));

      // Check that all students have unique positions (no duplicates)
      const studentIds = result.positions.map(p => p.studentId);
      const uniqueStudentIds = new Set(studentIds);
      expect(uniqueStudentIds.size).toBe(25);

      // Verify no position conflicts
      const positionKeys = result.positions.map(p => `${p.estimatedRow},${p.estimatedColumn}`);
      const uniquePositions = new Set(positionKeys);
      expect(uniquePositions.size).toBe(25); // All positions should be unique
    }, 10000); // 10 second timeout for batching delays

    it('should calculate correct offsets from overlapping students', async () => {
      const input: PositionEstimationInput = {
        captureRequestId: 'test-capture-3',
        imageUrls: Array.from({ length: 15 }, (_, i) => ({
          studentId: `student${i + 1}@test.com`,
          blobUrl: `https://storage.blob.core.windows.net/images/student${i + 1}.jpg`
        }))
      };

      // Batch 1: Students 1-10
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                positions: [
                  { studentId: 'student8@test.com', estimatedRow: 3, estimatedColumn: 2, confidence: 'HIGH', reasoning: 'Batch 1' },
                  { studentId: 'student9@test.com', estimatedRow: 3, estimatedColumn: 3, confidence: 'HIGH', reasoning: 'Batch 1' },
                  { studentId: 'student10@test.com', estimatedRow: 4, estimatedColumn: 1, confidence: 'HIGH', reasoning: 'Batch 1' },
                  ...Array.from({ length: 7 }, (_, i) => ({
                    studentId: `student${i + 1}@test.com`,
                    estimatedRow: Math.floor(i / 3) + 1,
                    estimatedColumn: (i % 3) + 1,
                    confidence: 'HIGH',
                    reasoning: 'Batch 1'
                  }))
                ],
                analysisNotes: 'Batch 1'
              })
            }
          }],
          usage: { total_tokens: 2500 }
        })
      });

      // Batch 2: Students 8-15 (overlap: 8, 9, 10)
      // GPT assigns them to rows 1-2 in this batch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                positions: [
                  { studentId: 'student8@test.com', estimatedRow: 1, estimatedColumn: 2, confidence: 'HIGH', reasoning: 'Batch 2' },
                  { studentId: 'student9@test.com', estimatedRow: 1, estimatedColumn: 3, confidence: 'HIGH', reasoning: 'Batch 2' },
                  { studentId: 'student10@test.com', estimatedRow: 2, estimatedColumn: 1, confidence: 'HIGH', reasoning: 'Batch 2' },
                  { studentId: 'student11@test.com', estimatedRow: 2, estimatedColumn: 2, confidence: 'HIGH', reasoning: 'Batch 2' },
                  { studentId: 'student12@test.com', estimatedRow: 2, estimatedColumn: 3, confidence: 'HIGH', reasoning: 'Batch 2' },
                  { studentId: 'student13@test.com', estimatedRow: 3, estimatedColumn: 1, confidence: 'HIGH', reasoning: 'Batch 2' },
                  { studentId: 'student14@test.com', estimatedRow: 3, estimatedColumn: 2, confidence: 'HIGH', reasoning: 'Batch 2' },
                  { studentId: 'student15@test.com', estimatedRow: 3, estimatedColumn: 3, confidence: 'HIGH', reasoning: 'Batch 2' }
                ],
                analysisNotes: 'Batch 2'
              })
            }
          }],
          usage: { total_tokens: 2000 }
        })
      });

      const result = await estimateSeatingPositions(input, mockContext);

      // Find the offset that was calculated
      // Student 8: Reference (3,2) vs Current (1,2) → Offset (+2, 0)
      // Student 9: Reference (3,3) vs Current (1,3) → Offset (+2, 0)
      // Student 10: Reference (4,1) vs Current (2,1) → Offset (+2, 0)
      // Average offset should be (+2, 0)

      // Verify student 11 was adjusted correctly
      const student11 = result.positions.find(p => p.studentId === 'student11@test.com');
      expect(student11).toBeDefined();
      // Original: (2, 2), After offset (+2, 0): (4, 2)
      expect(student11!.estimatedRow).toBe(4);
      expect(student11!.estimatedColumn).toBe(2);

      // Verify overlapping students kept their original positions
      const student8 = result.positions.find(p => p.studentId === 'student8@test.com');
      expect(student8!.estimatedRow).toBe(3); // From Batch 1
      expect(student8!.estimatedColumn).toBe(2);
    }, 10000); // 10 second timeout for batching delays
  });

  describe('Edge Cases', () => {
    it('should handle exactly 10 students (boundary case)', async () => {
      const input: PositionEstimationInput = {
        captureRequestId: 'test-capture-4',
        imageUrls: Array.from({ length: 10 }, (_, i) => ({
          studentId: `student${i + 1}@test.com`,
          blobUrl: `https://storage.blob.core.windows.net/images/student${i + 1}.jpg`
        }))
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                positions: Array.from({ length: 10 }, (_, i) => ({
                  studentId: `student${i + 1}@test.com`,
                  estimatedRow: Math.floor(i / 3) + 1,
                  estimatedColumn: (i % 3) + 1,
                  confidence: 'HIGH',
                  reasoning: 'Analysis'
                })),
                analysisNotes: 'Exactly 10 students'
              })
            }
          }],
          usage: { total_tokens: 2500 }
        })
      });

      const result = await estimateSeatingPositions(input, mockContext);

      expect(result.positions).toHaveLength(10);
      expect(mockFetch).toHaveBeenCalledTimes(1); // Single batch
    });

    it('should handle 11 students (first overlap case)', async () => {
      const input: PositionEstimationInput = {
        captureRequestId: 'test-capture-5',
        imageUrls: Array.from({ length: 11 }, (_, i) => ({
          studentId: `student${i + 1}@test.com`,
          blobUrl: `https://storage.blob.core.windows.net/images/student${i + 1}.jpg`
        }))
      };

      // Batch 1: Students 1-10
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                positions: Array.from({ length: 10 }, (_, i) => ({
                  studentId: `student${i + 1}@test.com`,
                  estimatedRow: Math.floor(i / 3) + 1,
                  estimatedColumn: (i % 3) + 1,
                  confidence: 'HIGH',
                  reasoning: 'Batch 1'
                })),
                analysisNotes: 'Batch 1'
              })
            }
          }],
          usage: { total_tokens: 2500 }
        })
      });

      // Batch 2: Students 8-11 (overlap: 8, 9, 10)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                positions: [
                  { studentId: 'student8@test.com', estimatedRow: 1, estimatedColumn: 2, confidence: 'HIGH', reasoning: 'Overlap' },
                  { studentId: 'student9@test.com', estimatedRow: 1, estimatedColumn: 3, confidence: 'HIGH', reasoning: 'Overlap' },
                  { studentId: 'student10@test.com', estimatedRow: 2, estimatedColumn: 1, confidence: 'HIGH', reasoning: 'Overlap' },
                  { studentId: 'student11@test.com', estimatedRow: 2, estimatedColumn: 2, confidence: 'HIGH', reasoning: 'New student' }
                ],
                analysisNotes: 'Batch 2'
              })
            }
          }],
          usage: { total_tokens: 1500 }
        })
      });

      const result = await estimateSeatingPositions(input, mockContext);

      expect(result.positions).toHaveLength(11);
      expect(mockFetch).toHaveBeenCalledTimes(2); // 2 batches
    }, 10000); // 10 second timeout for batching delays
  });
});
