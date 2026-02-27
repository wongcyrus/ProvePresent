/**
 * Test Durable Orchestrator
 * 
 * This is a simple test orchestrator to verify that:
 * 1. Durable Functions extension loads correctly
 * 2. Storage connection works for state management
 * 3. Task hub is created in storage
 * 
 * This file can be removed after verification is complete.
 */

import * as df from 'durable-functions';
import { app, InvocationContext } from '@azure/functions';
import { OrchestrationContext, OrchestrationHandler, ActivityHandler } from 'durable-functions';

interface TestInput {
  testId: string;
  message: string;
}

interface TestOutput {
  status: 'completed';
  testId: string;
  activityResult: string;
  timestamp: string;
}

/**
 * Test orchestrator function
 * Verifies basic orchestrator functionality including:
 * - Orchestrator registration
 * - Activity function invocation
 * - State persistence
 */
const testDurableOrchestrator: OrchestrationHandler = function* (context: OrchestrationContext) {
  const input: TestInput = context.df.getInput();
  
  context.log(`Test orchestrator started for testId: ${input.testId}`);
  
  // Call test activity function
  const activityResult: string = yield context.df.callActivity(
    'testDurableActivity',
    input.message
  );
  
  context.log(`Test orchestrator completed for testId: ${input.testId}`);
  
  const output: TestOutput = {
    status: 'completed',
    testId: input.testId,
    activityResult,
    timestamp: context.df.currentUtcDateTime.toISOString()
  };
  
  return output;
};

// Register the orchestrator
df.app.orchestration('testDurableOrchestrator', testDurableOrchestrator);

/**
 * Test activity function
 * Verifies activity function registration and execution
 */
const testDurableActivity: ActivityHandler = async (
  message: string,
  context: InvocationContext
): Promise<string> => {
  context.log(`Test activity executing with message: ${message}`);
  return `Activity processed: ${message}`;
};

// Register the activity
df.app.activity('testDurableActivity', { handler: testDurableActivity });

/**
 * HTTP trigger to start the test orchestrator
 * This allows manual testing of the Durable Functions runtime
 */
export async function startTestOrchestrator(
  request: any,
  context: InvocationContext
): Promise<any> {
  const client = df.getClient(context);
  
  const testId = `test-${Date.now()}`;
  const input: TestInput = {
    testId,
    message: 'Testing Durable Functions runtime'
  };
  
  try {
    const instanceId = await client.startNew('testDurableOrchestrator', {
      instanceId: testId,
      input
    });
    
    context.log(`Started test orchestrator with instance ID: ${instanceId}`);
    
    // Wait for completion (with timeout)
    const timeoutMs = 30000; // 30 seconds
    const status = await client.waitForCompletionOrCreateCheckStatusResponse(
      request,
      instanceId,
      { timeoutInMilliseconds: timeoutMs }
    );
    
    return {
      status: 200,
      jsonBody: {
        message: 'Durable Functions runtime verification successful',
        instanceId,
        orchestratorStatus: status
      }
    };
    
  } catch (error: any) {
    context.error(`Failed to start test orchestrator: ${error.message}`);
    return {
      status: 500,
      jsonBody: {
        error: 'Durable Functions runtime verification failed',
        details: error.message
      }
    };
  }
}

// Register HTTP trigger
app.http('startTestOrchestrator', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'test/durable',
  extraInputs: [df.input.durableClient()],
  handler: startTestOrchestrator
});
