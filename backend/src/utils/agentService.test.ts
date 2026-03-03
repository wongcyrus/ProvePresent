/**
 * Agent Service Tests
 * Run with: npm test -- agentService.test.ts
 */

import { AgentServiceClient } from './agentService';

describe('AgentServiceClient', () => {
  let client: AgentServiceClient;

  beforeAll(() => {
    // Set up test environment variables
    process.env.AZURE_AI_PROJECT_ENDPOINT = process.env.AZURE_AI_PROJECT_ENDPOINT || 'https://test.services.ai.azure.com/api/projects/test-project';
    process.env.AZURE_OPENAI_KEY = process.env.AZURE_OPENAI_KEY || 'test-key';
  });

  beforeEach(() => {
    client = new AgentServiceClient();
  });

  describe('Constructor', () => {
    it('should throw error if AZURE_AI_PROJECT_ENDPOINT is not set', () => {
      const originalEndpoint = process.env.AZURE_AI_PROJECT_ENDPOINT;
      delete process.env.AZURE_AI_PROJECT_ENDPOINT;

      expect(() => new AgentServiceClient()).toThrow('AZURE_AI_PROJECT_ENDPOINT environment variable is required');

      process.env.AZURE_AI_PROJECT_ENDPOINT = originalEndpoint;
    });

    it('should create client with API key', () => {
      expect(client).toBeDefined();
    });
  });

  describe('runSingleInteraction', () => {
    it('should handle quiz question generation', async () => {
      // Mock fetch for testing
      const mockFetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'agent-123' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'thread-123' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({})
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'run-123' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'completed' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{
              content: [{
                type: 'text',
                text: { value: '{"questions": [{"text": "What is a Promise?", "type": "MULTIPLE_CHOICE"}]}' }
              }]
            }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({})
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({})
        });

      global.fetch = mockFetch as any;

      const response = await client.runSingleInteraction({
        agentName: 'TestAgent',
        instructions: 'Generate quiz questions',
        userMessage: 'Create a question about JavaScript Promises'
      });

      expect(response.content).toContain('questions');
      expect(mockFetch).toHaveBeenCalled();
    }, 30000);
  });

  describe('Error Handling', () => {
    it('should handle agent creation failure', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request'
      });

      global.fetch = mockFetch as any;

      await expect(
        client.createAgent({
          name: 'TestAgent',
          instructions: 'Test'
        })
      ).rejects.toThrow('Failed to create agent');
    });

    it('should handle thread creation failure', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error'
      });

      global.fetch = mockFetch as any;

      await expect(client.createThread()).rejects.toThrow('Failed to create thread');
    });

    it('should handle run timeout', async () => {
      const mockFetch = jest.fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({ status: 'in_progress' })
        });

      global.fetch = mockFetch as any;

      await expect(
        client.waitForRunCompletion('thread-123', 'run-123', 1)
      ).rejects.toThrow('Agent run timeout');
    }, 10000);

    it('should handle failed run status', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'failed',
          last_error: { message: 'Model error' }
        })
      });

      global.fetch = mockFetch as any;

      await expect(
        client.waitForRunCompletion('thread-123', 'run-123')
      ).rejects.toThrow('Agent run failed: Model error');
    });
  });
});
