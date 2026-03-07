/**
 * Azure AI Foundry Agent Service Utility
 * Provides agent-based AI interactions using Microsoft Foundry Agent Service
 * Uses persistent agents created as infrastructure
 */

import { AgentsClient, isOutputOfType } from '@azure/ai-agents';
import { AIProjectClient } from '@azure/ai-projects';
import { DefaultAzureCredential } from '@azure/identity';

// OpenTelemetry imports for tracing
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { AzureMonitorTraceExporter } from '@azure/monitor-opentelemetry-exporter';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

// Initialize tracing once
let tracingInitialized = false;

async function initializeTracing(projectClient: AIProjectClient) {
  if (tracingInitialized) return;
  
  try {
    // Get Application Insights connection string from project (async)
    const connectionString = await projectClient.telemetry.getApplicationInsightsConnectionString();
    
    if (!connectionString) {
      console.warn('[AgentService] No Application Insights connection string found - tracing disabled');
      console.warn('[AgentService] Connect Application Insights in Foundry portal: Agents → Traces → Connect');
      return;
    }

    // Create tracer provider with service name
    const resource = new Resource({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'qr-attendance-agent-service'
    });

    const provider = new NodeTracerProvider({ resource });
    
    // Add Azure Monitor exporter (type assertion needed due to version mismatch)
    const exporter = new AzureMonitorTraceExporter({ connectionString });
    provider.addSpanProcessor(new BatchSpanProcessor(exporter as any));
    
    // Register the provider
    provider.register();
    
    // Register instrumentations (empty for now, can add more later)
    registerInstrumentations({
      instrumentations: [],
    });
    
    tracingInitialized = true;
    console.log('[AgentService] Tracing initialized successfully');
    console.log('[AgentService] Service name:', resource.attributes[ATTR_SERVICE_NAME]);
  } catch (error) {
    console.error('[AgentService] Failed to initialize tracing:', error);
    console.error('[AgentService] Tracing will be disabled');
  }
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
  private client: AgentsClient;
  private projectClient: AIProjectClient;

  constructor() {
    this.projectEndpoint = process.env.AZURE_AI_PROJECT_ENDPOINT || '';
    
    if (!this.projectEndpoint) {
      throw new Error('AZURE_AI_PROJECT_ENDPOINT environment variable is required');
    }

    const credential = new DefaultAzureCredential();
    this.client = new AgentsClient(this.projectEndpoint, credential);
    this.projectClient = new AIProjectClient(this.projectEndpoint, credential);
    
    // Initialize tracing asynchronously (don't await to avoid blocking constructor)
    initializeTracing(this.projectClient).catch(err => {
      console.error('[AgentService] Tracing initialization failed:', err);
    });
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
    const model = config.model || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5.4';

    const agent = await this.client.createAgent(model, {
      name: config.name,
      instructions: config.instructions
    });

    return agent.id;
  }

  /**
   * Create a thread for conversation
   */
  async createThread(): Promise<string> {
    const thread = await this.client.threads.create();
    return thread.id;
  }

  /**
   * Add a message to a thread
   */
  async addMessage(threadId: string, content: string, role: 'user' | 'assistant' = 'user'): Promise<void> {
    await this.client.messages.create(threadId, role, content);
  }

  /**
   * Run the agent on a thread
   */
  async runAgent(threadId: string, agentId: string): Promise<string> {
    const run = await this.client.runs.create(threadId, agentId);
    return run.id;
  }

  /**
   * Wait for run to complete and get the result
   */
  async waitForRunCompletion(threadId: string, runId: string, maxWaitSeconds: number = 60): Promise<string> {
    const startTime = Date.now();

    while (true) {
      const run = await this.client.runs.get(threadId, runId);

      if (run.status === 'completed') {
        // Run can become completed before assistant message is visible in thread list.
        // Retry briefly until assistant response appears or overall timeout is reached.
        while (true) {
          const assistantContent = await this.tryGetLatestAssistantMessage(threadId);
          if (assistantContent) {
            return assistantContent;
          }

          if ((Date.now() - startTime) / 1000 > maxWaitSeconds) {
            throw new Error(`Agent run completed but no assistant message appeared within ${maxWaitSeconds}s`);
          }

          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } else if (run.status === 'failed' || run.status === 'cancelled' || run.status === 'expired') {
        throw new Error(`Agent run ${run.status}: ${run.lastError?.message || 'Unknown error'}`);
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
    const content = await this.tryGetLatestAssistantMessage(threadId);
    if (content) {
      return content;
    }

    const messages: any[] = [];
    const iterator = this.client.messages.list(threadId);

    for await (const message of iterator) {
      messages.push(message);
      if (messages.length >= 20) {
        break;
      }
    }

    if (messages.length === 0) {
      throw new Error('No messages found in thread');
    }

    const messageRoles = messages.map((m: any) => `${m.role} (${m.createdAt})`).join(', ');
    throw new Error(`No assistant message found in thread. Messages: ${messageRoles}`);
  }

  private async tryGetLatestAssistantMessage(threadId: string): Promise<string | null> {
    const messages: any[] = [];
    const iterator = this.client.messages.list(threadId);

    for await (const message of iterator) {
      messages.push(message);
      if (messages.length >= 20) {
        break;
      }
    }
    
    if (messages.length === 0) {
      return null;
    }

    // Find the first assistant message (most recent)
    const assistantMessage = messages.find((m: any) => m.role === 'assistant');
    
    if (!assistantMessage) {
      return null;
    }

    const textContent = assistantMessage.content.find((c: any) => isOutputOfType(c, 'text'));
    
    if (!textContent) {
      return null;
    }

    const value = textContent?.text?.value;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }

    return null;
  }

  /**
   * Delete an agent
   */
  async deleteAgent(agentId: string): Promise<void> {
    try {
      await this.client.deleteAgent(agentId);
    } catch (error: any) {
      const status = error?.statusCode || error?.status;
      if (status !== 404) {
        throw error;
      }
    }
  }

  /**
   * Delete a thread
   */
  async deleteThread(threadId: string): Promise<void> {
    try {
      await this.client.threads.delete(threadId);
    } catch (error: any) {
      const status = error?.statusCode || error?.status;
      if (status !== 404) {
        throw error;
      }
    }
  }

  /**
   * High-level method: Run a single agent interaction using persistent agent
   */
  async runSingleInteraction(config: {
    agentName?: string;
    instructions?: string;
    userMessage: string;
    model?: string;
  }): Promise<AgentResponse> {
    console.log('[AgentService] Starting runSingleInteraction');
    console.log('[AgentService] Project endpoint:', this.projectEndpoint);

    const agentName = config.agentName || process.env.AZURE_AI_AGENT_NAME || 'QuizQuestionGenerator';
    
    console.log('[AgentService] Agent name:', agentName);
    console.log('[AgentService] User message length:', config.userMessage?.length || 0);

    try {
      // Get OpenAI client (NOT getAzureOpenAIClient)
      console.log('[AgentService] Getting OpenAI client...');
      const openAIClient = await this.projectClient.getOpenAIClient();
      console.log('[AgentService] OpenAI client created');

      // Create conversation with initial user message
      console.log('[AgentService] Creating conversation...');
      const conversation = await openAIClient.conversations.create({
        items: [{ type: "message", role: "user", content: config.userMessage }]
      });
      console.log('[AgentService] Conversation created:', conversation.id);

      // Generate response using the agent
      console.log('[AgentService] Generating response with agent...');
      const startTime = Date.now();
      
      const response = await openAIClient.responses.create(
        {
          conversation: conversation.id,
        },
        {
          body: { 
            agent: { 
              name: agentName, 
              type: "agent_reference" 
            } 
          },
        }
      );
      
      const duration = Date.now() - startTime;
      console.log(`[AgentService] Agent response received in ${duration}ms`);
      console.log('[AgentService] Response output_text length:', response.output_text?.length || 0);

      if (!response.output_text) {
        throw new Error('No output_text in response');
      }

      return {
        content: response.output_text
      };

    } catch (error: any) {
      console.error('[AgentService] Agent interaction failed:', error.message);
      console.error('[AgentService] Error code:', error.code);
      console.error('[AgentService] Error status:', error.status);
      throw error;
    }
  }

  async runSingleVisionInteraction(config: {
    userMessage: string;
    imageUrls: string[];
    agentName: string;
    agentVersion: string;
    model?: string;
  }): Promise<AgentResponse> {
    const openAIClient = this.projectClient.getOpenAIClient();

    // Create a conversation first
    const conversation = await openAIClient.conversations.create();

    const inputContent: any[] = [
      {
        type: 'input_text',
        text: config.userMessage
      }
    ];

    for (const imageUrl of config.imageUrls) {
      inputContent.push({
        type: 'input_image',
        image_url: imageUrl
      });
    }

    let response: any;
    try {
      response = await openAIClient.responses.create(
        {
          conversation: conversation.id,
          input: [
            {
              role: 'user',
              content: inputContent
            }
          ]
        },
        {
          body: {
            agent: {
              name: config.agentName,
              type: 'agent_reference'
            }
          }
        }
      );
    } catch (error: any) {
      const errorMessage = String(error?.message || '');
      if (!errorMessage.includes('Missed model deployment')) {
        throw error;
      }

      const fallbackModel = config.model || process.env.AZURE_OPENAI_VISION_DEPLOYMENT || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5.4';

      response = await openAIClient.responses.create({
        conversation: conversation.id,
        model: fallbackModel,
        input: [
          {
            role: 'user',
            content: inputContent
          }
        ]
      });
    }

    const outputText = (response as any).output_text;
    if (typeof outputText === 'string' && outputText.trim().length > 0) {
      return {
        content: outputText
      };
    }

    const outputItems = (response as any).output;
    if (Array.isArray(outputItems)) {
      const textChunks: string[] = [];
      for (const item of outputItems) {
        if (item?.type === 'message' && Array.isArray(item.content)) {
          for (const content of item.content) {
            if ((content?.type === 'output_text' || content?.type === 'text') && typeof content?.text === 'string') {
              textChunks.push(content.text);
            } else if (
              (content?.type === 'output_text' || content?.type === 'text') &&
              typeof content?.text?.value === 'string'
            ) {
              textChunks.push(content.text.value);
            }
          }
        }
      }

      if (textChunks.length > 0) {
        return {
          content: textChunks.join('\n').trim()
        };
      }
    }

    throw new Error('Agent response contained no text output');
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
