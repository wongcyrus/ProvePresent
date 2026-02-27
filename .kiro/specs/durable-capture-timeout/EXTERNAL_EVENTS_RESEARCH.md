# External Event Patterns in Azure Durable Functions - Research Document

## Overview

This document provides comprehensive research on external event patterns in Azure Durable Functions, specifically focused on implementing early termination for the student image capture timeout feature. The research covers how to raise events from client functions, event-based early termination patterns, event handling in orchestrator code, and best practices.

## 1. How to Raise External Events from Client Functions

### 1.1 Basic Concept

External events allow client functions to send signals to running orchestrator instances. The orchestrator can wait for these events and respond accordingly.

**Key Components:**
- **Instance ID**: Unique identifier for the orchestrator instance (we'll use `captureRequestId`)
- **Event Name**: String identifier for the event type (e.g., "allUploadsComplete")
- **Event Data**: JSON-serializable payload (optional)

### 1.2 Raising Events from TypeScript/JavaScript Functions

**Using the Durable Client:**

```typescript
import * as df from 'durable-functions';
import { InvocationContext } from '@azure/functions';

export async function notifyImageUpload(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  
  // ... existing upload logic ...
  
  // Check if all students have uploaded
  const uploadedCount = updatedRequest.uploadedCount;
  const totalCount = updatedRequest.onlineStudentCount;
  
  if (uploadedCount === totalCount) {
    context.log(`All students uploaded for capture: ${captureRequestId}`);
    
    // Get the durable client
    const client = df.getClient(context);
    
    try {
      // Raise external event to orchestrator
      await client.raiseEvent(
        captureRequestId,           // instance ID
        'allUploadsComplete',       // event name
        { uploadedCount, totalCount } // event data (optional)
      );
      
      context.log(`Raised allUploadsComplete event for capture: ${captureRequestId}`);
      
    } catch (error: any) {
      // Log error but don't fail the upload notification
      // Orchestrator will still complete via timer if event fails
      context.warn(`Failed to raise external event: ${error.message}`);
    }
  }
  
  // ... rest of function ...
}
```

**Key Points:**
- Use `df.getClient(context)` to get the durable client
- Call `client.raiseEvent(instanceId, eventName, eventData)`
- Event data must be JSON-serializable
- If the orchestrator isn't waiting yet, the event is queued in memory
- If no orchestrator exists with that instance ID, the event is discarded

### 1.3 Event Queuing Behavior

**Important Behavior from Microsoft Documentation:**

> "If the instance is not waiting on the specified event name, the event message is added to an in-memory queue. If the orchestration instance later begins listening for that event name, it will check the queue for event messages."

This means:
- Events can be raised BEFORE the orchestrator starts waiting
- Events are buffered and delivered when the orchestrator calls `waitForExternalEvent`
- No race condition if event arrives before orchestrator is ready

### 1.4 Error Handling for Event Raising

**Best Practice:**
```typescript
try {
  await client.raiseEvent(instanceId, eventName, data);
} catch (error: any) {
  // Log warning but don't fail the calling function
  // Orchestrator will complete via timer if event fails
  context.warn(`Failed to raise external event: ${error.message}`);
}
```

**Rationale:**
- Event raising failure shouldn't break the upload notification
- Orchestrator has a fallback (timer) if event never arrives
- Graceful degradation: system still works, just takes longer

## 2. Event-Based Early Termination Patterns

### 2.1 The Human Interaction Pattern

Azure Durable Functions documentation describes the "Human Interaction Pattern" which is exactly what we need for early termination.

**Pattern Description:**
- Orchestrator creates a durable timer for timeout
- Orchestrator waits for an external event (early completion signal)
- Uses `Task.any()` to race between timer and event
- Whichever completes first wins
- Cancel the timer if event wins to prevent duplicate processing

### 2.2 Complete Early Termination Pattern (TypeScript)

```typescript
import * as df from 'durable-functions';

const captureTimeoutOrchestrator = df.orchestrator(function* (context) {
  const input: CaptureTimeoutInput = context.df.getInput();
  
  context.log(`Orchestrator started for capture: ${input.captureRequestId}`);
  
  // Create durable timer for expiration
  const expirationDate = new Date(input.expiresAt);
  const timerTask = context.df.createTimer(expirationDate);
  
  // Wait for external event (early termination)
  const eventTask = context.df.waitForExternalEvent('allUploadsComplete');
  
  // Race between timer and external event
  const winner = yield context.df.Task.any([timerTask, eventTask]);
  
  // Determine which task won
  if (winner === eventTask) {
    context.log(`Early termination for capture: ${input.captureRequestId}`);
    
    // CRITICAL: Cancel timer to prevent orchestrator from hanging
    timerTask.cancel();
  } else {
    context.log(`Timer expired for capture: ${input.captureRequestId}`);
  }
  
  // Call activity function to process timeout
  const retryOptions = new df.RetryOptions(2000, 3);
  retryOptions.backoffCoefficient = 2;
  
  try {
    yield context.df.callActivityWithRetry(
      'processCaptureTimeoutActivity',
      retryOptions,
      input.captureRequestId
    );
    
    return { status: 'completed' };
    
  } catch (error) {
    context.log(`Orchestrator failed: ${error.message}`);
    return { status: 'failed', error: error.message };
  }
});

df.app.orchestration('captureTimeoutOrchestrator', captureTimeoutOrchestrator);
```

### 2.3 Why Timer Cancellation is Critical

**From Microsoft Documentation:**

> "All pending timers must be completed or canceled for an orchestration to complete."

> "The Durable Task Framework will not change an orchestration's status to 'Completed' until all outstanding tasks, including durable timer tasks, are either completed or canceled."

**Implications:**
- If you don't cancel the timer, the orchestrator will wait for it to expire
- This defeats the purpose of early termination
- Always check `if (!timerTask.isCompleted)` before canceling
- Cancellation is safe even if timer already expired

### 2.4 Task.any() vs Task.all()

**Task.any()** - Use for early termination:
```typescript
const winner = yield context.df.Task.any([timerTask, eventTask]);
// Returns whichever task completes FIRST
```

**Task.all()** - Use when you need all events:
```typescript
yield context.df.Task.all([event1, event2, event3]);
// Waits for ALL tasks to complete
```

For our use case, we need `Task.any()` because we want to proceed as soon as EITHER the timer expires OR all students upload.

## 3. Event Handling in Orchestrator Code

### 3.1 Waiting for External Events

**Basic Pattern:**
```typescript
const eventTask = context.df.waitForExternalEvent('eventName');
const result = yield eventTask;
```

**With Type Safety:**
```typescript
interface AllUploadsCompleteEvent {
  uploadedCount: number;
  totalCount: number;
}

const eventTask = context.df.waitForExternalEvent<AllUploadsCompleteEvent>('allUploadsComplete');
const eventData = yield eventTask;
// eventData.uploadedCount is now typed
```

### 3.2 Event Data Access

**Accessing Event Payload:**
```typescript
const eventTask = context.df.waitForExternalEvent('allUploadsComplete');
const winner = yield context.df.Task.any([timerTask, eventTask]);

if (winner === eventTask) {
  // Access the event data
  const eventData = eventTask.result;
  context.log(`Received event with data:`, eventData);
}
```

**Note:** Event data is available on the task's `result` property after it completes.

### 3.3 Multiple Event Listeners

**Waiting for ANY of Multiple Events:**
```typescript
const event1 = context.df.waitForExternalEvent('Event1');
const event2 = context.df.waitForExternalEvent('Event2');
const event3 = context.df.waitForExternalEvent('Event3');

const winner = yield context.df.Task.any([event1, event2, event3]);

if (winner === event1) {
  // Handle Event1
} else if (winner === event2) {
  // Handle Event2
} else if (winner === event3) {
  // Handle Event3
}
```

**Waiting for ALL Events:**
```typescript
const gate1 = context.df.waitForExternalEvent('CityPlanningApproval');
const gate2 = context.df.waitForExternalEvent('FireDeptApproval');
const gate3 = context.df.waitForExternalEvent('BuildingDeptApproval');

// Wait for all three approvals
yield context.df.Task.all([gate1, gate2, gate3]);

// All events received, proceed
yield context.df.callActivity('IssueBuildingPermit', applicationId);
```

### 3.4 Event Waiting Behavior

**Key Characteristics:**

1. **Indefinite Wait**: `waitForExternalEvent` waits forever until the event arrives
2. **No Billing**: No charges while waiting (in Consumption plan)
3. **Automatic Wake-up**: Orchestrator is awakened when event arrives
4. **Deterministic Replay**: Event waiting is replay-safe

**From Microsoft Documentation:**

> "The 'wait-for-external-event' API waits indefinitely for some input. The function app can be safely unloaded while waiting. If and when an event arrives for this orchestration instance, it is awakened automatically and immediately processes the event."

> "If your function app uses the Consumption Plan, no billing charges are incurred while an orchestrator function is awaiting an external event task, no matter how long it waits."

### 3.5 At-Least-Once Delivery Guarantee

**Important Consideration:**

> "As with Activity Functions, external events have an at-least-once delivery guarantee. This means that, under certain conditions (like restarts, scaling, crashes, etc.), your application may receive duplicates of the same external event."

**Recommendation:**
- Include an ID in event data for de-duplication if needed
- For our use case, duplicate "allUploadsComplete" events are harmless
- The activity function is idempotent (can be called multiple times safely)

## 4. Best Practices for Event Naming and Payload Structure

### 4.1 Event Naming Conventions

**Best Practices:**

1. **Use PascalCase or camelCase**: Consistent with JavaScript conventions
   - ✅ `allUploadsComplete`
   - ✅ `AllUploadsComplete`
   - ❌ `all-uploads-complete`

2. **Be Descriptive**: Event name should clearly indicate what happened
   - ✅ `allUploadsComplete`
   - ❌ `complete`
   - ❌ `done`

3. **Use Action-Based Names**: Describe what occurred
   - ✅ `approvalReceived`
   - ✅ `paymentProcessed`
   - ❌ `approval` (noun, not clear)

4. **Case-Insensitive**: Event names are case-insensitive in Durable Functions
   - `Approval` matches `approval` matches `APPROVAL`

5. **Reusable Names**: Event names can be reused across orchestrations
   - Not required to be globally unique
   - Scoped to orchestrator instance

### 4.2 Event Payload Structure

**Best Practices:**

1. **Keep Payloads Small**: Only include necessary data
   ```typescript
   // ✅ Good: Minimal data
   { uploadedCount: 10, totalCount: 10 }
   
   // ❌ Bad: Unnecessary data
   { 
     uploadedCount: 10, 
     totalCount: 10,
     allStudentIds: [...], // Not needed
     timestamps: [...],    // Not needed
     metadata: {...}       // Not needed
   }
   ```

2. **Use Typed Interfaces**: Define payload structure
   ```typescript
   interface AllUploadsCompleteEvent {
     uploadedCount: number;
     totalCount: number;
   }
   ```

3. **JSON-Serializable Only**: No functions, dates as ISO strings
   ```typescript
   // ✅ Good
   { timestamp: new Date().toISOString() }
   
   // ❌ Bad
   { timestamp: new Date() } // Date objects don't serialize well
   ```

4. **Include Correlation IDs**: For debugging and tracing
   ```typescript
   {
     captureRequestId: 'abc-123',
     uploadedCount: 10,
     totalCount: 10
   }
   ```

5. **Optional Payloads**: Event data is optional
   ```typescript
   // Valid: No payload
   await client.raiseEvent(instanceId, 'allUploadsComplete');
   
   // Valid: With payload
   await client.raiseEvent(instanceId, 'allUploadsComplete', { count: 10 });
   ```

### 4.3 Event Naming for Our Use Case

**Recommended Event Name:**
```typescript
'allUploadsComplete'
```

**Rationale:**
- Clear and descriptive
- Indicates the condition that triggered it
- Follows camelCase convention
- Action-based (uploads completed)

**Recommended Payload:**
```typescript
interface AllUploadsCompleteEvent {
  uploadedCount: number;
  totalCount: number;
}
```

**Rationale:**
- Minimal data (only counts)
- Useful for logging and debugging
- JSON-serializable
- Typed for safety

### 4.4 Alternative Event Names (Not Recommended)

- `captureComplete` - Less specific
- `earlyTermination` - Describes the action, not the condition
- `timeout` - Confusing (sounds like timer expired)
- `allStudentsUploaded` - Verbose

## 5. Complete Implementation Example

### 5.1 Orchestrator Function

```typescript
import * as df from 'durable-functions';

interface CaptureTimeoutInput {
  captureRequestId: string;
  expiresAt: string;
  sessionId: string;
}

interface AllUploadsCompleteEvent {
  uploadedCount: number;
  totalCount: number;
}

const captureTimeoutOrchestrator = df.orchestrator(function* (context) {
  const input: CaptureTimeoutInput = context.df.getInput();
  
  // Log orchestrator start
  context.log(`Orchestrator started for capture: ${input.captureRequestId}`);
  
  // Create durable timer for expiration
  const expirationDate = new Date(input.expiresAt);
  const timerTask = context.df.createTimer(expirationDate);
  
  // Wait for external event (early termination)
  const eventTask = context.df.waitForExternalEvent<AllUploadsCompleteEvent>('allUploadsComplete');
  
  // Race between timer and external event
  const winner = yield context.df.Task.any([timerTask, eventTask]);
  
  // Determine which task won and log accordingly
  let terminationType: 'timer' | 'event';
  if (winner === eventTask) {
    terminationType = 'event';
    const eventData = eventTask.result;
    context.log(`Early termination for capture: ${input.captureRequestId}`, {
      uploadedCount: eventData.uploadedCount,
      totalCount: eventData.totalCount
    });
    
    // Cancel timer to allow orchestrator to complete
    if (!timerTask.isCompleted) {
      timerTask.cancel();
    }
  } else {
    terminationType = 'timer';
    context.log(`Timer expired for capture: ${input.captureRequestId}`);
  }
  
  // Call activity function to process timeout
  // Use retry policy for resilience
  const retryOptions = new df.RetryOptions(2000, 3); // 2s, 4s, 8s
  retryOptions.backoffCoefficient = 2;
  
  try {
    yield context.df.callActivityWithRetry(
      'processCaptureTimeoutActivity',
      retryOptions,
      input.captureRequestId
    );
    
    context.log(`Orchestrator completed for capture: ${input.captureRequestId}`);
    return { 
      status: 'completed',
      terminationType 
    };
    
  } catch (error: any) {
    context.log(`Orchestrator failed for capture: ${input.captureRequestId}`, error);
    return { 
      status: 'failed', 
      error: error.message,
      terminationType 
    };
  }
});

df.app.orchestration('captureTimeoutOrchestrator', captureTimeoutOrchestrator);
```

### 5.2 Client Function (Raising Event)

```typescript
import * as df from 'durable-functions';
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

export async function notifyImageUpload(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  
  // ... existing validation and upload recording logic ...
  
  // Check for early termination condition
  const uploadedCount = updatedRequest.uploadedCount;
  const totalCount = updatedRequest.onlineStudentCount;
  
  if (uploadedCount === totalCount) {
    context.log(`All students uploaded for capture: ${captureRequestId}`);
    
    // Get durable client
    const client = df.getClient(context);
    
    try {
      // Raise external event to orchestrator
      await client.raiseEvent(
        captureRequestId, // instance ID (matches orchestrator instance ID)
        'allUploadsComplete', // event name (matches waitForExternalEvent)
        { 
          uploadedCount, 
          totalCount 
        } // event data
      );
      
      context.log(`Raised allUploadsComplete event for capture: ${captureRequestId}`);
      
    } catch (error: any) {
      // Log error but don't fail the upload notification
      // Orchestrator will still complete via timer if event fails
      context.warn(`Failed to raise external event: ${error.message}`);
    }
  }
  
  // ... existing SignalR broadcast and response ...
}
```

### 5.3 Starting the Orchestrator

```typescript
import * as df from 'durable-functions';
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

export async function initiateImageCapture(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  
  // ... existing validation and capture request creation ...
  
  // Start durable orchestrator
  const client = df.getClient(context);
  
  const orchestratorInput: CaptureTimeoutInput = {
    captureRequestId,
    expiresAt: expiresAt.toISOString(),
    sessionId
  };
  
  try {
    // Use captureRequestId as instance ID for easy correlation
    const instanceId = await client.startNew(
      'captureTimeoutOrchestrator',
      {
        instanceId: captureRequestId,
        input: orchestratorInput
      }
    );
    
    context.log(`Started orchestrator instance: ${instanceId}`);
    
  } catch (error: any) {
    context.error(`Failed to start orchestrator: ${error.message}`);
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to start timeout orchestrator',
          timestamp: Date.now()
        }
      }
    };
  }
  
  // ... existing SignalR broadcast and response ...
}
```

## 6. Testing Considerations

### 6.1 Testing Early Termination

**Test Scenario 1: Normal Timeout**
1. Start orchestrator with 60-second timeout
2. Don't raise any events
3. Verify timer expires after 60 seconds
4. Verify activity function is called
5. Verify orchestrator completes

**Test Scenario 2: Early Termination**
1. Start orchestrator with 60-second timeout
2. Raise `allUploadsComplete` event after 10 seconds
3. Verify orchestrator completes immediately (not after 60 seconds)
4. Verify timer is cancelled
5. Verify activity function is called

**Test Scenario 3: Event Before Orchestrator Waits**
1. Raise `allUploadsComplete` event
2. Start orchestrator (event already in queue)
3. Verify orchestrator receives queued event
4. Verify early termination occurs

**Test Scenario 4: Multiple Events (De-duplication)**
1. Start orchestrator
2. Raise `allUploadsComplete` event twice
3. Verify orchestrator handles duplicate gracefully
4. Verify activity function called only once

### 6.2 Testing Event Raising Failures

**Test Scenario: Event Raise Fails**
1. Start orchestrator
2. Simulate event raise failure (invalid instance ID)
3. Verify upload notification still succeeds
4. Verify orchestrator completes via timer (fallback)

## 7. Monitoring and Debugging

### 7.1 Logging Best Practices

**Orchestrator Logs:**
```typescript
context.log(`Orchestrator started for capture: ${captureRequestId}`);
context.log(`Timer created with expiration: ${expiresAt}`);
context.log(`Early termination for capture: ${captureRequestId}`);
context.log(`Timer expired for capture: ${captureRequestId}`);
context.log(`Orchestrator completed for capture: ${captureRequestId}`);
```

**Client Function Logs:**
```typescript
context.log(`All students uploaded for capture: ${captureRequestId}`);
context.log(`Raised allUploadsComplete event for capture: ${captureRequestId}`);
context.warn(`Failed to raise external event: ${error.message}`);
```

### 7.2 Application Insights Queries

**Find Early Terminations:**
```kusto
traces
| where message contains "Early termination"
| project timestamp, message, customDimensions
```

**Find Timer Expirations:**
```kusto
traces
| where message contains "Timer expired"
| project timestamp, message, customDimensions
```

**Find Event Raise Failures:**
```kusto
traces
| where message contains "Failed to raise external event"
| project timestamp, message, customDimensions
```

## 8. Key Takeaways

### 8.1 Critical Points

1. **Always Cancel Timers**: If external event wins, cancel the timer or orchestrator won't complete
2. **Event Queuing**: Events can be raised before orchestrator waits (they're queued)
3. **Graceful Degradation**: Event raise failures shouldn't break the system (timer is fallback)
4. **At-Least-Once Delivery**: Handle duplicate events gracefully
5. **No Billing While Waiting**: Waiting for events is free in Consumption plan

### 8.2 Pattern Summary

```
1. Orchestrator creates timer
2. Orchestrator waits for external event
3. Use Task.any() to race timer vs event
4. If event wins: cancel timer, proceed
5. If timer wins: proceed normally
6. Call activity function to process
```

### 8.3 Requirements Mapping

This research addresses the following requirements from the spec:

- **Requirement 3.1**: Upload notification function checks if all uploaded
- **Requirement 3.2**: Raise external event when all uploaded
- **Requirement 3.3**: Orchestrator responds to early termination event
- **Requirement 3.4**: Orchestrator invokes activity function immediately on early termination

## 9. References

### 9.1 Official Microsoft Documentation

1. [Handling external events in Durable Functions](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-external-events)
2. [Human Interaction Pattern](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-overview#application-patterns)
3. [Durable Timers](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-timers)
4. [Task.any() and Task.all()](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-error-handling#function-timeouts)
5. [Manage instances in Durable Functions](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-instance-management#send-events-to-instances)

### 9.2 Code Examples from Microsoft

- Human Interaction Pattern (JavaScript): [Link](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-overview?pivots=javascript#application-patterns)
- SMS Phone Verification Example: [Link](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-phone-verification)
- Timer Timeout Pattern: [Link](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-timers#usage-for-timeout)

---

**Document Version**: 1.0  
**Last Updated**: 2026-02-26  
**Status**: Research Complete
