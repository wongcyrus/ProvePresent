# Design Document: Durable Functions Migration for Capture Timeout

## Overview

This design document describes the migration from a polling-based timer function to an event-driven Azure Durable Functions architecture for handling student image capture timeouts. The new design eliminates the inefficient 10-second polling mechanism and replaces it with durable orchestrators that create per-request timers, reducing compute costs and improving scalability.

## Architecture

### High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Teacher Initiates Capture                    │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              initiateImageCapture (HTTP Function)                    │
│  - Validates teacher auth                                            │
│  - Creates CaptureRequest in Table Storage                           │
│  - Starts Durable Orchestrator instance                              │
│  - Broadcasts to students via SignalR                                │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│         captureTimeoutOrchestrator (Orchestrator Function)           │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  1. Create durable timer (expiresAt timestamp)             │     │
│  │  2. Wait for external event ("allUploadsComplete")         │     │
│  │  3. Race: Task.any([timer, externalEvent])                 │     │
│  │  4. Cancel timer if event wins                             │     │
│  │  5. Call activity function to process timeout              │     │
│  └────────────────────────────────────────────────────────────┘     │
└──────────────────┬──────────────────────────────┬───────────────────┘
                   │                              │
         Timer Expires                   External Event Raised
                   │                              │
                   │                              │
                   │         ┌────────────────────┘
                   │         │
                   │         │  notifyImageUpload (HTTP Function)
                   │         │  - Records student upload
                   │         │  - Checks if all uploaded
                   │         │  - Raises "allUploadsComplete" event
                   │         │
                   ▼         ▼
┌─────────────────────────────────────────────────────────────────────┐
│      processCaptureTimeoutActivity (Activity Function)               │
│  - Queries CaptureUploads table                                      │
│  - Updates status to ANALYZING                                       │
│  - Broadcasts captureExpired event                                   │
│  - Calls GPT position estimation (if uploads > 0)                    │
│  - Stores results in CaptureResults table                            │
│  - Updates status to COMPLETED/FAILED                                │
│  - Broadcasts captureResults event                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### State Persistence

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Azure Storage Account                             │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  Durable Functions Task Hub Tables                         │     │
│  │  - History: Orchestrator execution history                 │     │
│  │  - Instances: Active orchestration instances               │     │
│  │  - WorkItems: Pending work items                           │     │
│  └────────────────────────────────────────────────────────────┘     │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  Application Tables                                        │     │
│  │  - CaptureRequests: Capture request metadata              │     │
│  │  - CaptureUploads: Student upload records                 │     │
│  │  - CaptureResults: Position estimation results            │     │
│  └────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Design

### 1. Orchestrator Function: captureTimeoutOrchestrator

**Purpose**: Manages the lifecycle of a capture request timeout using durable timers and external events.

**Input**:
```typescript
interface CaptureTimeoutInput {
  captureRequestId: string;
  expiresAt: string; // ISO 8601 timestamp
  sessionId: string;
}
```

**Orchestrator Logic** (based on [Microsoft Learn Human Interaction Pattern](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-overview#application-patterns)):

```typescript
import * as df from 'durable-functions';

const captureTimeoutOrchestrator = df.orchestrator(function* (context) {
  const input: CaptureTimeoutInput = context.df.getInput();
  
  // Log orchestrator start
  context.log(`Orchestrator started for capture: ${input.captureRequestId}`);
  
  // Create durable timer for expiration
  const expirationDate = new Date(input.expiresAt);
  const timerTask = context.df.createTimer(expirationDate);
  
  // Wait for external event (early termination)
  const eventTask = context.df.waitForExternalEvent('allUploadsComplete');
  
  // Race between timer and external event
  const winner = yield context.df.Task.any([timerTask, eventTask]);
  
  // Cancel timer if external event won
  if (winner === eventTask) {
    context.log(`Early termination for capture: ${input.captureRequestId}`);
    timerTask.cancel();
  } else {
    context.log(`Timer expired for capture: ${input.captureRequestId}`);
  }
  
  // Call activity function to process timeout
  // Retry policy: 3 attempts with exponential backoff
  const retryOptions = new df.RetryOptions(2000, 3); // 2s, 4s, 8s
  retryOptions.backoffCoefficient = 2;
  
  try {
    yield context.df.callActivityWithRetry(
      'processCaptureTimeoutActivity',
      retryOptions,
      input.captureRequestId
    );
    
    context.log(`Orchestrator completed for capture: ${input.captureRequestId}`);
    return { status: 'completed' };
    
  } catch (error) {
    context.log(`Orchestrator failed for capture: ${input.captureRequestId}`, error);
    return { status: 'failed', error: error.message };
  }
});

df.app.orchestration('captureTimeoutOrchestrator', captureTimeoutOrchestrator);
```

**Key Design Decisions**:
- Uses `context.df.Task.any()` to race between timer and external event (official pattern)
- Cancels timer when external event wins to prevent duplicate processing
- Uses `callActivityWithRetry()` with exponential backoff for resilience
- Orchestrator is deterministic (no Date.now(), no HTTP calls, no random)
- Uses `context.df.currentUtcDateTime` for any time calculations (deterministic)

**State Checkpoints**:
1. After orchestrator starts
2. After timer/event tasks are created
3. After winner is determined
4. After activity function completes

### 2. Activity Function: processCaptureTimeoutActivity

**Purpose**: Processes an expired or completed capture request by querying uploads, triggering position estimation, and broadcasting results.

**Input**: `captureRequestId: string`

**Output**: 
```typescript
interface ActivityResult {
  status: 'COMPLETED' | 'FAILED';
  uploadedCount: number;
  errorMessage?: string;
}
```

**Activity Logic**:

```typescript
import { app, InvocationContext } from '@azure/functions';
import { getCaptureRequest, updateCaptureRequest, getCaptureUploads } from '../utils/captureStorage';
import { broadcastToHub } from '../utils/signalrBroadcast';
import { estimateSeatingPositions } from '../utils/gptPositionEstimation';

export async function processCaptureTimeoutActivity(
  captureRequestId: string,
  context: InvocationContext
): Promise<ActivityResult> {
  
  context.log(`Processing timeout for capture: ${captureRequestId}`);
  
  // 1. Get capture request
  const captureRequest = await getCaptureRequest(captureRequestId);
  if (!captureRequest) {
    throw new Error(`Capture request not found: ${captureRequestId}`);
  }
  
  const sessionId = captureRequest.sessionId;
  
  // 2. Update status to ANALYZING
  await updateCaptureRequest(captureRequestId, {
    status: 'ANALYZING',
    analysisStartedAt: new Date().toISOString()
  });
  
  // 3. Query uploads
  const uploads = await getCaptureUploads(captureRequestId);
  const uploadedCount = uploads.length;
  const totalCount = captureRequest.onlineStudentCount;
  
  context.log(`Found ${uploadedCount}/${totalCount} uploads`);
  
  // 4. Broadcast captureExpired event
  await broadcastToHub(sessionId, 'captureExpired', {
    captureRequestId,
    uploadedCount,
    totalCount
  }, context);
  
  // 5. Handle zero uploads case
  if (uploadedCount === 0) {
    await updateCaptureRequest(captureRequestId, {
      status: 'COMPLETED',
      analysisCompletedAt: new Date().toISOString()
    });
    
    await broadcastToHub(sessionId, 'captureResults', {
      captureRequestId,
      status: 'COMPLETED',
      positions: [],
      analysisNotes: 'No student photos were uploaded'
    }, context);
    
    return { status: 'COMPLETED', uploadedCount: 0 };
  }
  
  // 6. Call GPT position estimation
  try {
    const estimationOutput = await estimateSeatingPositions({
      captureRequestId,
      imageUrls: uploads.map(u => ({
        studentId: u.rowKey,
        blobUrl: u.blobUrl
      }))
    }, context);
    
    // 7. Store results
    await createCaptureResult({
      partitionKey: captureRequestId,
      rowKey: 'RESULT',
      sessionId,
      positions: JSON.stringify(estimationOutput.positions),
      analysisNotes: estimationOutput.analysisNotes,
      analyzedAt: new Date().toISOString(),
      gptModel: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5.2-chat',
      gptTokensUsed: 0
    });
    
    // 8. Update status to COMPLETED
    await updateCaptureRequest(captureRequestId, {
      status: 'COMPLETED',
      analysisCompletedAt: new Date().toISOString()
    });
    
    // 9. Broadcast results
    await broadcastToHub(sessionId, 'captureResults', {
      captureRequestId,
      status: 'COMPLETED',
      positions: estimationOutput.positions,
      analysisNotes: estimationOutput.analysisNotes
    }, context);
    
    return { status: 'COMPLETED', uploadedCount };
    
  } catch (error: any) {
    // Handle GPT failure
    await updateCaptureRequest(captureRequestId, {
      status: 'FAILED',
      analysisCompletedAt: new Date().toISOString(),
      errorMessage: error.message
    });
    
    await broadcastToHub(sessionId, 'captureResults', {
      captureRequestId,
      status: 'FAILED',
      errorMessage: `Position analysis failed: ${error.message}`
    }, context);
    
    throw error; // Re-throw to trigger orchestrator retry
  }
}

app.activity('processCaptureTimeoutActivity', {
  handler: processCaptureTimeoutActivity
});
```

**Key Design Decisions**:
- Extracts all processing logic from old timer function
- Maintains exact same status transitions and SignalR events (backward compatible)
- Throws errors to trigger orchestrator retry mechanism
- Can perform any I/O operations (not constrained like orchestrator)

### 3. Updated: initiateImageCapture Function

**Changes Required**:

```typescript
import { DurableClient } from 'durable-functions';

export async function initiateImageCapture(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  
  // ... existing validation and capture request creation ...
  
  // NEW: Start durable orchestrator
  const client = df.getClient(context);
  
  const orchestratorInput: CaptureTimeoutInput = {
    captureRequestId,
    expiresAt: expiresAt.toISOString(),
    sessionId
  };
  
  try {
    const instanceId = await client.startNew(
      'captureTimeoutOrchestrator',
      {
        instanceId: captureRequestId, // Use captureRequestId as instance ID
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
          code: CaptureErrorCode.INTERNAL_ERROR,
          message: 'Failed to start timeout orchestrator',
          timestamp: Date.now()
        }
      }
    };
  }
  
  // ... existing SignalR broadcast and response ...
}
```

**Key Design Decisions**:
- Uses `captureRequestId` as orchestrator instance ID for easy correlation
- Starts orchestrator immediately after creating capture request
- Returns error to teacher if orchestrator fails to start
- Orchestrator runs independently after being started

### 4. Updated: notifyImageUpload Function

**Changes Required**:

```typescript
import { DurableClient } from 'durable-functions';

export async function notifyImageUpload(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  
  // ... existing validation and upload recording ...
  
  // NEW: Check for early termination
  const uploadedCount = updatedRequest.uploadedCount;
  const totalCount = updatedRequest.onlineStudentCount;
  
  if (uploadedCount === totalCount) {
    context.log(`All students uploaded for capture: ${captureRequestId}`);
    
    // Raise external event to orchestrator
    const client = df.getClient(context);
    
    try {
      await client.raiseEvent(
        captureRequestId, // instance ID
        'allUploadsComplete', // event name
        { uploadedCount, totalCount } // event data (optional)
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

**Key Design Decisions**:
- Raises external event only when all students have uploaded
- Uses `captureRequestId` as instance ID to target correct orchestrator
- Logs warning but doesn't fail if event raise fails (orchestrator will timeout naturally)
- Event is queued if orchestrator is not yet waiting for it

## Data Models

### Orchestrator Input

```typescript
interface CaptureTimeoutInput {
  captureRequestId: string;  // UUID
  expiresAt: string;          // ISO 8601 timestamp
  sessionId: string;          // For logging and correlation
}
```

### Activity Input/Output

```typescript
// Input: string (captureRequestId)

interface ActivityResult {
  status: 'COMPLETED' | 'FAILED';
  uploadedCount: number;
  errorMessage?: string;
}
```

### External Event Payload

```typescript
interface AllUploadsCompleteEvent {
  uploadedCount: number;
  totalCount: number;
}
```

## Configuration

### host.json

```json
{
  "version": "2.0",
  "extensions": {
    "durableTask": {
      "hubName": "CaptureTaskHub",
      "storageProvider": {
        "connectionStringName": "AzureWebJobsStorage",
        "controlQueueBatchSize": 32,
        "partitionCount": 4,
        "controlQueueVisibilityTimeout": "00:05:00",
        "workItemQueueVisibilityTimeout": "00:05:00",
        "maxQueuePollingInterval": "00:00:30"
      },
      "tracing": {
        "traceInputsAndOutputs": true,
        "traceReplayEvents": false
      },
      "notifications": {
        "eventGrid": {
          "topicEndpoint": "",
          "keySettingName": ""
        }
      },
      "maxConcurrentActivityFunctions": 10,
      "maxConcurrentOrchestratorFunctions": 10
    }
  }
}
```

### package.json

```json
{
  "dependencies": {
    "@azure/functions": "^4.0.0",
    "durable-functions": "^3.0.0"
  }
}
```

### Environment Variables

```bash
# Existing
AzureWebJobsStorage=<connection-string>
AZURE_OPENAI_ENDPOINT=<endpoint>
AZURE_OPENAI_KEY=<key>
AZURE_OPENAI_DEPLOYMENT=gpt-5.2-chat

# No new variables required - Durable Functions uses AzureWebJobsStorage
```

## Sequence Diagrams

### Normal Timeout Flow

```
Teacher    initiateCapture    Orchestrator    Timer    Activity    GPT    SignalR
  |              |                 |            |         |         |       |
  |--POST------->|                 |            |         |         |       |
  |              |--startNew------>|            |         |         |       |
  |              |                 |--create--->|         |         |       |
  |              |                 |            |         |         |       |
  |<--201--------|                 |            |         |         |       |
  |              |                 |            |         |         |       |
  |              |                 |<--expires--|         |         |       |
  |              |                 |                      |         |       |
  |              |                 |--callActivity------->|         |       |
  |              |                 |                      |--call-->|       |
  |              |                 |                      |<--resp--|       |
  |              |                 |                      |--broadcast----->|
  |              |                 |<--result-------------|         |       |
  |              |                 |                      |         |       |
  |              |                 X (completed)          |         |       |
```

### Early Termination Flow

```
Student    notifyUpload    Orchestrator    Timer    Activity    GPT    SignalR
  |              |              |            |         |         |       |
  |--POST------->|              |            |         |         |       |
  |              |--check------>|            |         |         |       |
  |              | (all uploaded)            |         |         |       |
  |              |--raiseEvent->|            |         |         |       |
  |<--200--------|              |            |         |         |       |
  |              |              |--cancel--->|         |         |       |
  |              |              |                      |         |       |
  |              |              |--callActivity------->|         |       |
  |              |              |                      |--call-->|       |
  |              |              |                      |<--resp--|       |
  |              |              |                      |--broadcast----->|
  |              |              |<--result-------------|         |       |
  |              |              |                      |         |       |
  |              |              X (completed)          |         |       |
```

## Error Handling

### Orchestrator Retry Policy

```typescript
const retryOptions = new df.RetryOptions(
  2000,  // firstRetryInterval: 2 seconds
  3      // maxNumberOfAttempts: 3 total attempts
);
retryOptions.backoffCoefficient = 2; // Exponential: 2s, 4s, 8s
```

**Retry Scenarios**:
1. Activity function throws error → Retry up to 3 times
2. All retries exhausted → Orchestrator returns failure status
3. Orchestrator cannot start → Return 500 error to teacher

### Activity Function Error Handling

```typescript
try {
  // Process timeout logic
  return { status: 'COMPLETED', uploadedCount };
  
} catch (error: any) {
  // Update capture request to FAILED
  await updateCaptureRequest(captureRequestId, {
    status: 'FAILED',
    errorMessage: error.message
  });
  
  // Broadcast error to teacher
  await broadcastToHub(sessionId, 'captureResults', {
    captureRequestId,
    status: 'FAILED',
    errorMessage: error.message
  }, context);
  
  // Re-throw to trigger orchestrator retry
  throw error;
}
```

### External Event Failure Handling

```typescript
try {
  await client.raiseEvent(captureRequestId, 'allUploadsComplete', data);
} catch (error: any) {
  // Log warning but don't fail upload notification
  // Orchestrator will complete via timer if event fails
  context.warn(`Failed to raise external event: ${error.message}`);
}
```

## Monitoring and Observability

### Application Insights Logging

**Orchestrator Logs**:
- `Orchestrator started for capture: {captureRequestId}`
- `Timer created with expiration: {expiresAt}`
- `Early termination for capture: {captureRequestId}`
- `Timer expired for capture: {captureRequestId}`
- `Orchestrator completed for capture: {captureRequestId}`
- `Orchestrator failed for capture: {captureRequestId}`

**Activity Logs**:
- `Processing timeout for capture: {captureRequestId}`
- `Found {uploadedCount}/{totalCount} uploads`
- `Position estimation completed successfully`
- `Position estimation failed: {error}`

**Custom Metrics**:
```typescript
// In orchestrator
context.log.metric('CaptureOrchestrator.Duration', duration);
context.log.metric('CaptureOrchestrator.EarlyTermination', isEarlyTermination ? 1 : 0);

// In activity
context.log.metric('CaptureTimeout.UploadCount', uploadedCount);
context.log.metric('CaptureTimeout.Success', success ? 1 : 0);
```

### Durable Functions Built-in Monitoring

- Orchestrator status: `GET /runtime/webhooks/durabletask/instances/{instanceId}`
- Orchestrator history: Available in Application Insights
- Task hub tables: Visible in Azure Storage Explorer

## Testing Strategy

### Unit Tests

**Orchestrator Tests** (using Durable Functions test framework):
```typescript
describe('captureTimeoutOrchestrator', () => {
  it('should call activity when timer expires', async () => {
    const context = new TestOrchestrationContext();
    // Mock timer expiration
    // Verify activity called
  });
  
  it('should cancel timer on external event', async () => {
    const context = new TestOrchestrationContext();
    // Mock external event
    // Verify timer cancelled
    // Verify activity called
  });
});
```

**Activity Tests**:
```typescript
describe('processCaptureTimeoutActivity', () => {
  it('should process uploads and call GPT', async () => {
    // Mock table storage
    // Mock GPT API
    // Verify status transitions
    // Verify SignalR broadcasts
  });
  
  it('should handle zero uploads', async () => {
    // Mock empty uploads
    // Verify no GPT call
    // Verify COMPLETED status
  });
});
```

### Integration Tests

```typescript
describe('Capture Timeout Integration', () => {
  it('should complete full timeout flow', async () => {
    // 1. Initiate capture
    // 2. Verify orchestrator started
    // 3. Wait for timer expiration
    // 4. Verify activity executed
    // 5. Verify results stored
  });
  
  it('should handle early termination', async () => {
    // 1. Initiate capture
    // 2. Simulate all uploads
    // 3. Raise external event
    // 4. Verify immediate processing
    // 5. Verify timer cancelled
  });
});
```

## Migration Plan

### Phase 1: Add Durable Functions (No Breaking Changes)
1. Install durable-functions package
2. Configure host.json
3. Create orchestrator function
4. Create activity function
5. Deploy alongside existing timer function

### Phase 2: Update Trigger Functions
1. Update initiateImageCapture to start orchestrator
2. Update notifyImageUpload to raise external events
3. Deploy changes
4. Monitor both old and new systems running in parallel

### Phase 3: Remove Old Timer Function
1. Verify orchestrator handling all new captures
2. Wait for all old timer-based captures to complete
3. Delete processCaptureTimeout.ts
4. Remove timer trigger registration
5. Update documentation

### Phase 4: Validation
1. Monitor Application Insights for errors
2. Verify orchestrator completion rates
3. Verify early termination working
4. Verify backward compatibility (same events, same status transitions)

## Backward Compatibility

### Maintained Behaviors

✅ **Status Transitions**: ACTIVE → ANALYZING → COMPLETED/FAILED  
✅ **SignalR Events**: captureExpired, captureResults  
✅ **Table Schema**: CaptureRequests, CaptureUploads, CaptureResults  
✅ **Timeout Duration**: Configurable (default 60 seconds)  
✅ **Processing Logic**: Identical GPT estimation flow  

### Breaking Changes

❌ None - This is a transparent infrastructure change

## Performance Improvements

### Before (Timer Polling)

- Timer runs every 10 seconds regardless of active captures
- Queries all ACTIVE captures on every execution
- Wasted compute when no captures are active
- Fixed 10-second granularity (captures processed 0-10s after expiration)

### After (Durable Functions)

- One orchestrator per capture request (isolated)
- Timer fires at exact expiration time (no polling)
- Zero compute when no captures are active
- Immediate processing on expiration or early termination
- Automatic state persistence and recovery

### Cost Comparison

**Assumptions**: 100 captures/day, 60-second timeout, 10% early termination rate

**Before**:
- Timer executions: 8,640/day (every 10 seconds)
- Wasted executions: ~8,540/day (when no captures active)

**After**:
- Orchestrator instances: 100/day (one per capture)
- Activity executions: 100/day (one per capture)
- Total executions: 200/day

**Savings**: ~97% reduction in function executions

## Security Considerations

### Orchestrator Instance ID

- Uses `captureRequestId` (UUID) as instance ID
- Prevents instance ID collisions
- Enables easy correlation in logs

### External Event Security

- Events can only be raised by authenticated functions
- No public HTTP endpoint for raising events
- Instance ID required to target specific orchestrator

### State Persistence

- Orchestrator state stored in Azure Storage (encrypted at rest)
- Uses existing AzureWebJobsStorage connection
- No additional secrets required

## References

- [Azure Durable Functions Overview](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-overview)
- [Durable Timers](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-timers)
- [External Events](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-external-events)
- [Human Interaction Pattern](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-overview#application-patterns)
- [Error Handling in Durable Functions](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-error-handling)
- [Orchestrator Code Constraints](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-code-constraints)

---

**Document Version**: 1.0  
**Last Updated**: 2026-02-26  
**Status**: Ready for Implementation
