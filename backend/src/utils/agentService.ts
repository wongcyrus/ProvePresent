/**
 * Azure AI Foundry Agent Service Utility
 * Provides agent-based AI interactions using Microsoft Foundry Agent Service
 * Uses persistent agents created as infrastructure
 */

import { DefaultAzureCredential } from '@azure/identity';

interface AgentMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface AgentResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Agent Service Client for interacting with Azure AI Foundry Agents
 */
export class AgentServiceClient {
  private projectEndpoint: string;
  private credential: DefaultAzureCredential;
  private agentId?: string;

  constructor() {
    this.projectEndpoint = process.env.AZURE_AI_PROJECT_ENDPOINT || '';
    this.agentId = process.env.AZURE_AI_AGENT_ID; // Persistent agent ID from infrastructure
    
    if (!this.projectEndpoint) {
      throw new Error('AZURE_AI_PROJECT_ENDPOINT environment variable is required');
    }

    // Foundry Agent Service requires Azure AD authentication (not API key)
    this.credential = new DefaultAzureCredential();
  }

  /**
   * Create an agent with specific instructions and configuration
   */
  async createAgent(config: {
    name: string;
    instructions: string;
    model?: string;
    temperature?: number;
  }): Promise<string> {
    const model = config.model || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5.2-chat';
    
    const agentData = {
      name: config.name,
      instructions: config.instructions,
      model: model,
      tools: [],
      metadata: {
        createdAt: new Date().toISOString()
      }
    };

    const url = `${this.projectEndpoint}/assistants?api-version=2025-05-01`;
    const headers = await this.getHeaders();

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(agentData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create agent: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return result.id;
  }

  /**
   * Create a thread for conversation
   */
  async createThread(): Promise<string> {
    const url = `${this.projectEndpoint}/threads?api-version=2025-05-01`;
    const headers = await this.getHeaders();

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({})
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create thread: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return result.id;
  }

  /**
   * Add a message to a thread
   */
  async addMessage(threadId: string, content: string, role: 'user' | 'assistant' = 'user'): Promise<void> {
    const url = `${this.projectEndpoint}/threads/${threadId}/messages?api-version=2025-05-01`;
    const headers = await this.getHeaders();

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        role,
        content
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to add message: ${response.status} - ${errorText}`);
    }
  }

  /**
   * Run the agent on a thread
   */
  async runAgent(threadId: string, agentId: string): Promise<string> {
    const url = `${this.projectEndpoint}/threads/${threadId}/runs?api-version=2025-05-01`;
    const headers = await this.getHeaders();

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        assistant_id: agentId
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to run agent: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return result.id;
  }

  /**
   * Wait for run to complete and get the result
   */
  async waitForRunCompletion(threadId: string, runId: string, maxWaitSeconds: number = 60): Promise<string> {
    const url = `${this.projectEndpoint}/threads/${threadId}/runs/${runId}?api-version=2025-05-01`;
    const headers = await this.getHeaders();
    const startTime = Date.now();

    while (true) {
      const response = await fetch(url, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to check run status: ${response.status} - ${errorText}`);
      }

      const run = await response.json();

      if (run.status === 'completed') {
        // Get messages from the thread
        return await this.getLatestMessage(threadId);
      } else if (run.status === 'failed' || run.status === 'cancelled' || run.status === 'expired') {
        throw new Error(`Agent run ${run.status}: ${run.last_error?.message || 'Unknown error'}`);
      } else if (run.status === 'requires_action') {
        // Agent needs tool execution - not supported in this implementation
        throw new Error('Agent requires action (tool execution) which is not supported');
      }

      // Check timeout
      if ((Date.now() - startTime) / 1000 > maxWaitSeconds) {
        throw new Error(`Agent run timeout after ${maxWaitSeconds}s. Last status: ${run.status}`);
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  /**
   * Get the latest message from a thread
   */
  async getLatestMessage(threadId: string): Promise<string> {
    const url = `${this.projectEndpoint}/threads/${threadId}/messages?api-version=2025-05-01&limit=20&order=desc`;
    const headers = await this.getHeaders();

    const response = await fetch(url, {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get messages: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const messages = result.data || [];
    
    if (messages.length === 0) {
      throw new Error('No messages found in thread');
    }

    // Find the first assistant message (most recent)
    const assistantMessage = messages.find((m: any) => m.role === 'assistant');
    
    if (!assistantMessage) {
      // Log all messages for debugging
      const messageRoles = messages.map((m: any) => `${m.role} (${m.created_at})`).join(', ');
      throw new Error(`No assistant message found in thread. Messages: ${messageRoles}`);
    }

    const textContent = assistantMessage.content.find((c: any) => c.type === 'text');
    
    if (!textContent || !textContent.text?.value) {
      throw new Error('Assistant message has no text content');
    }
    
    return textContent.text.value;
  }

  /**
   * Delete an agent
   */
  async deleteAgent(agentId: string): Promise<void> {
    const url = `${this.projectEndpoint}/assistants/${agentId}?api-version=2025-05-01`;
    const headers = await this.getHeaders();

    const response = await fetch(url, {
      method: 'DELETE',
      headers
    });

    if (!response.ok && response.status !== 404) {
      const errorText = await response.text();
      throw new Error(`Failed to delete agent: ${response.status} - ${errorText}`);
    }
  }

  /**
   * Delete a thread
   */
  async deleteThread(threadId: string): Promise<void> {
    const url = `${this.projectEndpoint}/threads/${threadId}?api-version=2025-05-01`;
    const headers = await this.getHeaders();

    const response = await fetch(url, {
      method: 'DELETE',
      headers
    });

    if (!response.ok && response.status !== 404) {
      const errorText = await response.text();
      throw new Error(`Failed to delete thread: ${response.status} - ${errorText}`);
    }
  }

  /**
   * High-level method: Run a single agent interaction using persistent agent
   */
  async runSingleInteraction(config: {
    agentName?: string; // Optional, for backward compatibility
    instructions?: string; // Optional, for backward compatibility
    userMessage: string;
    model?: string;
  }): Promise<AgentResponse> {
    let threadId: string | null = null;
    let agentId: string | null = null;
    let createdAgent = false;

    try {
      // Use persistent agent if available, otherwise create temporary one
      if (this.agentId) {
        agentId = this.agentId;
      } else if (config.agentName && config.instructions) {
        // Fallback: create temporary agent (not recommended for production)
        agentId = await this.createAgent({
          name: config.agentName,
          instructions: config.instructions,
          model: config.model
        });
        createdAgent = true;
      } else {
        throw new Error('No agent ID configured. Set AZURE_AI_AGENT_ID environment variable or provide agentName and instructions.');
      }

      // Create thread
      threadId = await this.createThread();

      // Add user message
      await this.addMessage(threadId, config.userMessage);

      // Run agent
      const runId = await this.runAgent(threadId, agentId);

      // Wait for completion and get result
      const content = await this.waitForRunCompletion(threadId, runId);

      return {
        content
      };

    } finally {
      // Cleanup thread (always)
      if (threadId) {
        try {
          await this.deleteThread(threadId);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      
      // Only delete agent if we created it temporarily
      if (createdAgent && agentId) {
        try {
          await this.deleteAgent(agentId);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    }
  }

  /**
   * Get headers for API requests
   */
  private async getHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    // Foundry Agent Service requires Azure AD Bearer token
    // Token scope must be https://ai.azure.com
    try {
      const token = await this.credential.getToken('https://ai.azure.com/.default');
      headers['Authorization'] = `Bearer ${token.token}`;
    } catch (error) {
      throw new Error(`Failed to get Azure AD token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return headers;
  }
}

/**
 * Singleton instance for reuse
 */
let agentClientInstance: AgentServiceClient | null = null;

/**
 * Get or create the agent service client
 */
export function getAgentClient(): AgentServiceClient {
  if (!agentClientInstance) {
    agentClientInstance = new AgentServiceClient();
  }
  return agentClientInstance;
}
