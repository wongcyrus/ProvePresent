# Error Handling and Retry Patterns in Azure Durable Functions - Research Document

## Overview

This document provides comprehensive research on error handling and retry patterns in Azure Durable Functions, specifically focused on implementing robust error recovery for the student image capture timeout feature. The research covers activity function retry policies, error handling in orchestrators, failure scenarios and recovery mechanisms, and best practices for building resilient durable orchestrations.

**Research Date**: 2024  
**Spec**: durable-capture-timeout  
**Task**: 1.4 Review error handling and retry patterns  
**Requirements Addressed**: 7.1, 7.2, 7.3, 7.4, 7.5

---

## 1. Activity Function Retry Policies

### 1.1 Automatic Retry on Failure

Azure Durable Functions provides built-in automatic retry capabilities for activity functions and sub-orchestrations. When an activity function throws an unhandled exception, the orchestrator can automatically retry the operation based on a configured retry policy.

**Key Concept**: Retry policies are configured at the orchestrator level when calling activity functions, not in the activity function itself.

### 1.2 RetryOptions Configuration (JavaScript/TypeScript)

**Basic Retry Configuration**:

```typescript
import * as df from 'durable-functions';

const captureTimeoutOrchestrator = df.orchestrator(function* (context) {
  const input = context.df.getInput();
  
  // Configure retry policy
  const retryOptions = new df.RetryOptions(
    5000,  // firstRetryIntervalInMilliseconds: 5 seconds
    3      // maxNumberOfAttempts: 3 total attempts
  );
  
  // Call activity with retry
  yield context.df.callActivityWithRetry(
    'processCaptureTimeoutActivity',
    retryOptions,
    input.captureRequestId
  );
});
```

**RetryOptions Parameters**:

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `firstRetryIntervalInMilliseconds` | number | Time to wait before first retry (in ms) | Required |
| `maxNumberOfAttempts` | number | Maximum retry attempts (includes initial attempt) | Required |

**Important Notes**:
- `maxNumberOfAttempts` includes the initial attempt, so `3` means 1 initial + 2 retries
- If set to `1`, there will be no retry (only the initial attempt)
- Setting to `-1` means retry indefinitely (not recommended for most scenarios)


### 1.3 Exponential Backoff Configuration

**Advanced Retry with Exponential Backoff**:

```typescript
const retryOptions = new df.RetryOptions(
  2000,  // firstRetryIntervalInMilliseconds: 2 seconds
  3      // maxNumberOfAttempts: 3 attempts
);

// Configure exponential backoff
retryOptions.backoffCoefficient = 2;        // Doubles delay each retry
retryOptions.maxRetryIntervalInMilliseconds = 10000;  // Cap at 10 seconds
retryOptions.retryTimeoutInMilliseconds = 30000;      // Total timeout: 30 seconds
```

**Exponential Backoff Parameters**:

| Property | Type | Description | Default |
|----------|------|-------------|---------|
| `backoffCoefficient` | number | Multiplier for delay increase | 1 (no backoff) |
| `maxRetryIntervalInMilliseconds` | number | Maximum delay between retries | Infinity |
| `retryTimeoutInMilliseconds` | number | Total time budget for all retries | Infinity |

**Exponential Backoff Calculation**:

```
Retry 1: firstRetryInterval = 2000ms (2 seconds)
Retry 2: 2000ms × 2 = 4000ms (4 seconds)
Retry 3: 4000ms × 2 = 8000ms (8 seconds)
```

**Benefits of Exponential Backoff**:
- Reduces load on failing services (gives them time to recover)
- Prevents thundering herd problem in distributed systems
- Adds small randomization to stagger retries in high-throughput scenarios
- Industry best practice for transient failure handling

### 1.4 Retry Policy Examples

**Example 1: Simple Fixed Delay (3 attempts, 5 seconds apart)**:

```typescript
const retryOptions = new df.RetryOptions(5000, 3);

yield context.df.callActivityWithRetry(
  'processCaptureTimeoutActivity',
  retryOptions,
  captureRequestId
);
```

**Retry Timeline**:
- Attempt 1: Immediate (0s)
- Attempt 2: After 5s delay
- Attempt 3: After 5s delay
- **Total time**: Up to 10 seconds of delays + execution time

**Example 2: Exponential Backoff (3 attempts, 2s → 4s → 8s)**:

```typescript
const retryOptions = new df.RetryOptions(2000, 3);
retryOptions.backoffCoefficient = 2;

yield context.df.callActivityWithRetry(
  'processCaptureTimeoutActivity',
  retryOptions,
  captureRequestId
);
```

**Retry Timeline**:
- Attempt 1: Immediate (0s)
- Attempt 2: After 2s delay
- Attempt 3: After 4s delay
- **Total time**: Up to 6 seconds of delays + execution time

**Example 3: Capped Exponential Backoff with Timeout**:

```typescript
const retryOptions = new df.RetryOptions(1000, 5);
retryOptions.backoffCoefficient = 2;
retryOptions.maxRetryIntervalInMilliseconds = 10000;  // Cap at 10s
retryOptions.retryTimeoutInMilliseconds = 30000;      // Total budget: 30s

yield context.df.callActivityWithRetry(
  'processCaptureTimeoutActivity',
  retryOptions,
  captureRequestId
);
```

**Retry Timeline**:
- Attempt 1: Immediate (0s)
- Attempt 2: After 1s delay
- Attempt 3: After 2s delay
- Attempt 4: After 4s delay
- Attempt 5: After 8s delay
- **Total time**: Up to 15 seconds of delays (or 30s timeout, whichever comes first)


### 1.5 When Retries Are Triggered

**Retry Trigger Conditions**:
- Activity function throws an **unhandled exception**
- Activity function execution fails due to infrastructure issues
- Activity function times out (if timeout is configured)

**Retry Does NOT Trigger For**:
- Activity function returns normally (even with error status in return value)
- Activity function catches and handles all exceptions internally
- Orchestrator explicitly catches the exception

**Example - Retry Triggered**:

```typescript
// Activity function
export async function processCaptureTimeoutActivity(
  captureRequestId: string,
  context: InvocationContext
): Promise<void> {
  
  const uploads = await getCaptureUploads(captureRequestId);
  
  // This throws an exception → Retry will be triggered
  const result = await estimateSeatingPositions({
    captureRequestId,
    imageUrls: uploads.map(u => ({ studentId: u.rowKey, blobUrl: u.blobUrl }))
  }, context);
  
  // If estimateSeatingPositions throws, orchestrator will retry
}
```

**Example - Retry NOT Triggered**:

```typescript
// Activity function
export async function processCaptureTimeoutActivity(
  captureRequestId: string,
  context: InvocationContext
): Promise<ActivityResult> {
  
  try {
    const uploads = await getCaptureUploads(captureRequestId);
    const result = await estimateSeatingPositions(...);
    
    return { status: 'COMPLETED', uploadedCount: uploads.length };
    
  } catch (error: any) {
    // Exception caught and handled → No retry triggered
    return { status: 'FAILED', uploadedCount: 0, errorMessage: error.message };
  }
}
```

**Best Practice**: Let activity functions throw exceptions for transient failures (network errors, timeouts, service unavailable) so the orchestrator can retry. Only catch and handle exceptions for permanent failures (validation errors, business logic errors).

---

## 2. Error Handling in Orchestrators

### 2.1 Exception Propagation from Activity Functions

When an activity function throws an unhandled exception, it is marshaled back to the orchestrator as a standardized exception type.

**JavaScript/TypeScript Exception Handling**:

```typescript
const captureTimeoutOrchestrator = df.orchestrator(function* (context) {
  const input = context.df.getInput();
  
  const retryOptions = new df.RetryOptions(2000, 3);
  retryOptions.backoffCoefficient = 2;
  
  try {
    yield context.df.callActivityWithRetry(
      'processCaptureTimeoutActivity',
      retryOptions,
      input.captureRequestId
    );
    
    context.log(`Orchestrator completed for capture: ${input.captureRequestId}`);
    return { status: 'completed' };
    
  } catch (error: any) {
    // All retries exhausted, activity still failed
    context.log(`Orchestrator failed for capture: ${input.captureRequestId}`, error);
    
    // Update capture request to FAILED status
    yield context.df.callActivity('updateCaptureRequestStatus', {
      captureRequestId: input.captureRequestId,
      status: 'FAILED',
      errorMessage: error.message || 'Unknown error'
    });
    
    return { 
      status: 'failed', 
      error: error.message,
      captureRequestId: input.captureRequestId
    };
  }
});
```

**Key Points**:
- Use standard `try/catch` blocks in orchestrator code
- Exception is thrown only after all retry attempts are exhausted
- Exception contains error message and stack trace
- Orchestrator can perform compensating actions in the `catch` block


### 2.2 Compensating Actions Pattern

The **compensating actions pattern** (also called the **saga pattern**) is used to undo or mitigate the effects of failed operations.

**Example: Fund Transfer with Compensation**:

```typescript
df.app.orchestration("transferFunds", function* (context) {
  const transferDetails = context.df.getInput();
  
  // Step 1: Debit source account
  yield context.df.callActivity("debitAccount", {
    account: transferDetails.sourceAccount,
    amount: transferDetails.amount,
  });
  
  try {
    // Step 2: Credit destination account
    yield context.df.callActivity("creditAccount", {
      account: transferDetails.destinationAccount,
      amount: transferDetails.amount,
    });
    
  } catch (error) {
    // Compensation: Refund the source account
    yield context.df.callActivity("creditAccount", {
      account: transferDetails.sourceAccount,
      amount: transferDetails.amount,
    });
    
    throw error; // Re-throw to mark orchestration as failed
  }
});
```

**For Capture Timeout Feature**:

```typescript
const captureTimeoutOrchestrator = df.orchestrator(function* (context) {
  const input = context.df.getInput();
  
  const retryOptions = new df.RetryOptions(2000, 3);
  retryOptions.backoffCoefficient = 2;
  
  try {
    // Attempt to process timeout with retries
    yield context.df.callActivityWithRetry(
      'processCaptureTimeoutActivity',
      retryOptions,
      input.captureRequestId
    );
    
    return { status: 'completed' };
    
  } catch (error: any) {
    // Compensation: Update capture request to FAILED and notify users
    yield context.df.callActivity('handleCaptureFailure', {
      captureRequestId: input.captureRequestId,
      sessionId: input.sessionId,
      errorMessage: error.message
    });
    
    return { status: 'failed', error: error.message };
  }
});
```

**Compensating Activity Function**:

```typescript
export async function handleCaptureFailure(
  input: { captureRequestId: string; sessionId: string; errorMessage: string },
  context: InvocationContext
): Promise<void> {
  
  // Update capture request status to FAILED
  await updateCaptureRequest(input.captureRequestId, {
    status: 'FAILED',
    analysisCompletedAt: new Date().toISOString(),
    errorMessage: input.errorMessage
  });
  
  // Broadcast failure to teacher and students
  await broadcastToHub(input.sessionId, 'captureResults', {
    captureRequestId: input.captureRequestId,
    status: 'FAILED',
    errorMessage: `Capture processing failed: ${input.errorMessage}`
  }, context);
  
  // Log detailed error for monitoring
  context.error(`Capture ${input.captureRequestId} failed after retries: ${input.errorMessage}`);
}
```

### 2.3 Unhandled Exceptions in Orchestrators

**Important Behavior**: If an orchestrator function fails with an unhandled exception, the orchestration instance completes with a `Failed` status.

**What Happens**:
1. Exception details are logged to Application Insights
2. Orchestration instance status is set to `Failed`
3. Orchestration cannot be retried (it's terminal)
4. History is preserved for debugging

**Example - Unhandled Exception**:

```typescript
const captureTimeoutOrchestrator = df.orchestrator(function* (context) {
  const input = context.df.getInput();
  
  // No try/catch - if activity fails after retries, orchestrator fails
  yield context.df.callActivityWithRetry(
    'processCaptureTimeoutActivity',
    new df.RetryOptions(2000, 3),
    input.captureRequestId
  );
  
  return { status: 'completed' };
});

// If activity fails after 3 retries:
// - Orchestrator throws unhandled exception
// - Orchestration status → Failed
// - No further processing
```

**Best Practice**: Always use try/catch in orchestrators to handle failures gracefully and perform cleanup/compensation.


---

## 3. Failure Scenarios and Recovery

### 3.1 Common Failure Scenarios

#### Scenario 1: Transient Network Failure

**Situation**: Activity function fails due to temporary network issue when calling Azure Storage or OpenAI API.

**Behavior**:
- Activity throws exception (e.g., `ECONNRESET`, `ETIMEDOUT`)
- Orchestrator retry policy kicks in
- Waits for configured delay (e.g., 2 seconds)
- Retries activity function
- Network recovers, activity succeeds on retry

**Outcome**: ✅ Success after retry

**Example**:
```
Attempt 1: Network timeout → Exception thrown
Wait 2 seconds
Attempt 2: Network recovered → Success
```

#### Scenario 2: Service Temporarily Unavailable

**Situation**: Azure OpenAI service returns 503 Service Unavailable (overloaded).

**Behavior**:
- Activity throws exception
- Exponential backoff provides increasing delays
- Service recovers during backoff period
- Activity succeeds on later retry

**Outcome**: ✅ Success after retry (exponential backoff helps)

**Example**:
```
Attempt 1: 503 Service Unavailable → Exception
Wait 2 seconds
Attempt 2: 503 Service Unavailable → Exception
Wait 4 seconds
Attempt 3: 200 OK → Success
```

#### Scenario 3: Permanent Failure (All Retries Exhausted)

**Situation**: Azure OpenAI API key is invalid or quota exceeded.

**Behavior**:
- Activity throws exception on every attempt
- All 3 retry attempts fail
- Exception propagates to orchestrator
- Orchestrator catch block handles failure
- Capture request marked as FAILED
- Error broadcast to users

**Outcome**: ❌ Failure after retries, graceful degradation

**Example**:
```
Attempt 1: 401 Unauthorized → Exception
Wait 2 seconds
Attempt 2: 401 Unauthorized → Exception
Wait 4 seconds
Attempt 3: 401 Unauthorized → Exception
Orchestrator catch block → Update status to FAILED
```

#### Scenario 4: Function Host Restart During Retry

**Situation**: Function host restarts between retry attempts.

**Behavior**:
- Activity fails on attempt 1
- Orchestrator schedules retry (2-second delay)
- Function host restarts during delay
- Orchestrator state is persisted in Azure Storage
- After restart, orchestrator resumes from history
- Retry continues as scheduled
- Activity succeeds on attempt 2

**Outcome**: ✅ Success after retry (transparent recovery)

**Key Point**: Retry state is persisted, so retries survive host restarts.


### 3.2 Activity Function Timeout Handling

**Scenario**: Activity function takes too long to complete.

**Problem**: By default, activity functions have no timeout. A stuck activity can block the orchestration indefinitely.

**Solution**: Implement timeout pattern using durable timers.

**Timeout Pattern Implementation**:

```typescript
const captureTimeoutOrchestrator = df.orchestrator(function* (context) {
  const input = context.df.getInput();
  
  // Create activity task
  const activityTask = context.df.callActivity(
    'processCaptureTimeoutActivity',
    input.captureRequestId
  );
  
  // Create timeout timer (30 seconds)
  const timeoutDeadline = new Date(
    context.df.currentUtcDateTime.getTime() + 30000
  );
  const timeoutTask = context.df.createTimer(timeoutDeadline);
  
  // Race between activity and timeout
  const winner = yield context.df.Task.any([activityTask, timeoutTask]);
  
  if (winner === activityTask) {
    // Activity completed successfully
    timeoutTask.cancel(); // IMPORTANT: Cancel timer
    context.log('Activity completed within timeout');
    return { status: 'completed' };
    
  } else {
    // Timeout occurred
    context.log('Activity timed out after 30 seconds');
    
    // Update capture request to FAILED
    yield context.df.callActivity('updateCaptureRequestStatus', {
      captureRequestId: input.captureRequestId,
      status: 'FAILED',
      errorMessage: 'Processing timed out after 30 seconds'
    });
    
    return { status: 'timeout' };
  }
});
```

**Important Notes**:
- **Always cancel the timer** if activity completes first (prevents orchestrator from hanging)
- Timeout doesn't actually terminate the activity function (it continues running)
- Orchestrator simply ignores the activity result and moves on
- Use timeouts for activities that might hang indefinitely

**For Capture Timeout Feature**:
- Position estimation (GPT API call) could potentially hang
- Recommended timeout: 60 seconds (generous for GPT processing)
- If timeout occurs, mark capture as FAILED and notify users

### 3.3 External Event Failure Handling

**Scenario**: Raising external event fails (e.g., orchestrator instance doesn't exist).

**Recommended Approach**: Log warning but don't fail the calling function.

**Implementation**:

```typescript
export async function notifyImageUpload(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  
  // ... existing upload recording logic ...
  
  // Check for early termination
  const uploadedCount = updatedRequest.uploadedCount;
  const totalCount = updatedRequest.onlineStudentCount;
  
  if (uploadedCount === totalCount) {
    context.log(`All students uploaded for capture: ${captureRequestId}`);
    
    const client = df.getClient(context);
    
    try {
      // Attempt to raise external event
      await client.raiseEvent(
        captureRequestId,
        'allUploadsComplete',
        { uploadedCount, totalCount }
      );
      
      context.log(`Raised allUploadsComplete event for capture: ${captureRequestId}`);
      
    } catch (error: any) {
      // Log warning but don't fail the upload notification
      // Orchestrator will still complete via timer if event fails
      context.warn(`Failed to raise external event: ${error.message}`);
      
      // Optionally emit metric for monitoring
      context.log.metric('ExternalEvent.RaiseFailed', 1);
    }
  }
  
  // ... existing response ...
}
```

**Rationale**:
- Upload notification should succeed even if event raise fails
- Orchestrator has a fallback mechanism (timer will expire naturally)
- System degrades gracefully (takes longer but still works)
- Failure is logged for monitoring and alerting

**Possible Failure Reasons**:
- Orchestrator instance doesn't exist (already completed or never started)
- Orchestrator instance ID is incorrect
- Durable Functions storage is temporarily unavailable
- Network connectivity issues


### 3.4 Orchestrator Start Failure Handling

**Scenario**: Starting a new orchestrator instance fails.

**Recommended Approach**: Return error to the caller (teacher) immediately.

**Implementation**:

```typescript
export async function initiateImageCapture(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  
  // ... existing validation and capture request creation ...
  
  // Start durable orchestrator
  const client = df.getClient(context);
  
  const orchestratorInput = {
    captureRequestId,
    expiresAt: expiresAt.toISOString(),
    sessionId
  };
  
  try {
    const instanceId = await client.startNew(
      'captureTimeoutOrchestrator',
      {
        instanceId: captureRequestId,
        input: orchestratorInput
      }
    );
    
    context.log(`Started orchestrator instance: ${instanceId}`);
    
  } catch (error: any) {
    // Orchestrator failed to start - critical error
    context.error(`Failed to start orchestrator: ${error.message}`);
    
    // Clean up: Delete the capture request we just created
    await deleteCaptureRequest(captureRequestId);
    
    // Return error to teacher
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'ORCHESTRATOR_START_FAILED',
          message: 'Failed to start timeout orchestrator. Please try again.',
          timestamp: Date.now()
        }
      }
    };
  }
  
  // ... existing SignalR broadcast and response ...
}
```

**Rationale**:
- If orchestrator doesn't start, timeout will never be processed
- Better to fail fast and notify teacher immediately
- Teacher can retry the capture request
- Clean up any partial state (delete capture request)

**Possible Failure Reasons**:
- Durable Functions storage is unavailable
- Task hub not configured correctly
- Instance ID collision (very rare)
- Insufficient permissions

---

## 4. Error Logging and Monitoring

### 4.1 Structured Error Logging

**Best Practices for Error Logging**:

```typescript
// In Orchestrator
const captureTimeoutOrchestrator = df.orchestrator(function* (context) {
  const input = context.df.getInput();
  
  try {
    yield context.df.callActivityWithRetry(
      'processCaptureTimeoutActivity',
      retryOptions,
      input.captureRequestId
    );
    
    // Success logging
    context.log(`Orchestrator completed successfully`, {
      captureRequestId: input.captureRequestId,
      sessionId: input.sessionId,
      duration: Date.now() - startTime
    });
    
  } catch (error: any) {
    // Detailed error logging
    context.error(`Orchestrator failed after retries`, {
      captureRequestId: input.captureRequestId,
      sessionId: input.sessionId,
      errorType: error.name,
      errorMessage: error.message,
      stackTrace: error.stack,
      retryAttempts: retryOptions.maxNumberOfAttempts
    });
    
    throw error;
  }
});
```

```typescript
// In Activity Function
export async function processCaptureTimeoutActivity(
  captureRequestId: string,
  context: InvocationContext
): Promise<void> {
  
  context.log(`Processing timeout for capture: ${captureRequestId}`);
  
  try {
    const uploads = await getCaptureUploads(captureRequestId);
    
    context.log(`Found ${uploads.length} uploads for capture: ${captureRequestId}`);
    
    const result = await estimateSeatingPositions(...);
    
    context.log(`Position estimation completed for capture: ${captureRequestId}`);
    
  } catch (error: any) {
    // Detailed error logging before re-throwing
    context.error(`Activity function failed`, {
      captureRequestId,
      errorType: error.name,
      errorMessage: error.message,
      errorCode: error.code,
      statusCode: error.statusCode,
      stackTrace: error.stack
    });
    
    throw error; // Re-throw to trigger retry
  }
}
```


### 4.2 Application Insights Custom Metrics

**Emit Custom Metrics for Monitoring**:

```typescript
// In Orchestrator
const captureTimeoutOrchestrator = df.orchestrator(function* (context) {
  const input = context.df.getInput();
  const startTime = context.df.currentUtcDateTime.getTime();
  
  try {
    yield context.df.callActivityWithRetry(
      'processCaptureTimeoutActivity',
      retryOptions,
      input.captureRequestId
    );
    
    const duration = Date.now() - startTime;
    
    // Emit success metrics
    context.log.metric('CaptureOrchestrator.Success', 1);
    context.log.metric('CaptureOrchestrator.Duration', duration);
    
    return { status: 'completed' };
    
  } catch (error: any) {
    // Emit failure metrics
    context.log.metric('CaptureOrchestrator.Failure', 1);
    context.log.metric('CaptureOrchestrator.FailureAfterRetries', 1);
    
    throw error;
  }
});
```

```typescript
// In Activity Function
export async function processCaptureTimeoutActivity(
  captureRequestId: string,
  context: InvocationContext
): Promise<void> {
  
  const startTime = Date.now();
  
  try {
    const uploads = await getCaptureUploads(captureRequestId);
    
    // Emit upload count metric
    context.log.metric('CaptureTimeout.UploadCount', uploads.length);
    
    if (uploads.length > 0) {
      const result = await estimateSeatingPositions(...);
      
      // Emit GPT success metric
      context.log.metric('CaptureTimeout.GPT.Success', 1);
    }
    
    const duration = Date.now() - startTime;
    context.log.metric('CaptureTimeout.Duration', duration);
    
  } catch (error: any) {
    // Emit failure metrics
    context.log.metric('CaptureTimeout.Failure', 1);
    
    if (error.statusCode === 429) {
      context.log.metric('CaptureTimeout.GPT.RateLimited', 1);
    } else if (error.statusCode === 503) {
      context.log.metric('CaptureTimeout.GPT.ServiceUnavailable', 1);
    }
    
    throw error;
  }
}
```

**Useful Metrics to Track**:
- `CaptureOrchestrator.Success` - Successful orchestrations
- `CaptureOrchestrator.Failure` - Failed orchestrations
- `CaptureOrchestrator.Duration` - Orchestration duration
- `CaptureTimeout.UploadCount` - Number of uploads processed
- `CaptureTimeout.GPT.Success` - Successful GPT calls
- `CaptureTimeout.GPT.RateLimited` - Rate limit errors
- `ExternalEvent.RaiseFailed` - Failed external event raises

### 4.3 Application Insights Queries

**Query 1: Find Failed Orchestrations**:

```kusto
traces
| where message contains "Orchestrator failed"
| extend captureRequestId = tostring(customDimensions.captureRequestId)
| extend errorMessage = tostring(customDimensions.errorMessage)
| project timestamp, captureRequestId, errorMessage
| order by timestamp desc
```

**Query 2: Retry Success Rate**:

```kusto
customMetrics
| where name in ("CaptureOrchestrator.Success", "CaptureOrchestrator.Failure")
| summarize 
    Successes = sumif(value, name == "CaptureOrchestrator.Success"),
    Failures = sumif(value, name == "CaptureOrchestrator.Failure")
| extend SuccessRate = Successes * 100.0 / (Successes + Failures)
| project SuccessRate, Successes, Failures
```

**Query 3: Average Orchestration Duration**:

```kusto
customMetrics
| where name == "CaptureOrchestrator.Duration"
| summarize 
    AvgDuration = avg(value),
    P50Duration = percentile(value, 50),
    P95Duration = percentile(value, 95),
    P99Duration = percentile(value, 99)
| project AvgDuration, P50Duration, P95Duration, P99Duration
```

**Query 4: GPT API Errors**:

```kusto
traces
| where message contains "Activity function failed"
| extend errorType = tostring(customDimensions.errorType)
| extend statusCode = tostring(customDimensions.statusCode)
| where statusCode in ("429", "503", "500")
| summarize Count = count() by statusCode, errorType
| order by Count desc
```


---

## 5. Recommended Configuration for Capture Timeout Feature

### 5.1 Retry Policy Configuration

**Recommended Retry Policy**:

```typescript
const retryOptions = new df.RetryOptions(
  2000,  // firstRetryIntervalInMilliseconds: 2 seconds
  3      // maxNumberOfAttempts: 3 attempts (1 initial + 2 retries)
);

// Exponential backoff: 2s → 4s → 8s
retryOptions.backoffCoefficient = 2;

// Cap maximum delay at 10 seconds
retryOptions.maxRetryIntervalInMilliseconds = 10000;

// Total retry budget: 30 seconds
retryOptions.retryTimeoutInMilliseconds = 30000;
```

**Rationale**:
- **2-second initial delay**: Reasonable for transient network issues
- **3 attempts**: Balances resilience with responsiveness
- **Exponential backoff**: Gives failing services time to recover
- **10-second cap**: Prevents excessive delays
- **30-second timeout**: Ensures orchestrator doesn't hang indefinitely

**Expected Behavior**:
- **Transient failures** (network glitches): Likely succeed on retry 2 or 3
- **Service overload** (503 errors): Exponential backoff helps
- **Permanent failures** (invalid API key): Fail fast after 3 attempts (~14 seconds total)

### 5.2 Complete Orchestrator Implementation

```typescript
import * as df from 'durable-functions';

interface CaptureTimeoutInput {
  captureRequestId: string;
  expiresAt: string;
  sessionId: string;
}

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
    if (!timerTask.isCompleted) {
      timerTask.cancel();
    }
  } else {
    context.log(`Timer expired for capture: ${input.captureRequestId}`);
  }
  
  // Configure retry policy
  const retryOptions = new df.RetryOptions(2000, 3);
  retryOptions.backoffCoefficient = 2;
  retryOptions.maxRetryIntervalInMilliseconds = 10000;
  retryOptions.retryTimeoutInMilliseconds = 30000;
  
  try {
    // Call activity function with retry
    yield context.df.callActivityWithRetry(
      'processCaptureTimeoutActivity',
      retryOptions,
      input.captureRequestId
    );
    
    context.log(`Orchestrator completed for capture: ${input.captureRequestId}`);
    
    // Emit success metric
    context.log.metric('CaptureOrchestrator.Success', 1);
    
    return { status: 'completed' };
    
  } catch (error: any) {
    // All retries exhausted, activity still failed
    context.error(`Orchestrator failed for capture: ${input.captureRequestId}`, {
      errorMessage: error.message,
      errorType: error.name
    });
    
    // Emit failure metric
    context.log.metric('CaptureOrchestrator.Failure', 1);
    
    // Compensating action: Update capture request to FAILED
    try {
      yield context.df.callActivity('handleCaptureFailure', {
        captureRequestId: input.captureRequestId,
        sessionId: input.sessionId,
        errorMessage: error.message
      });
    } catch (compensationError: any) {
      // Log compensation failure but don't throw
      context.error(`Compensation failed for capture: ${input.captureRequestId}`, {
        errorMessage: compensationError.message
      });
    }
    
    return { 
      status: 'failed', 
      error: error.message 
    };
  }
});

df.app.orchestration('captureTimeoutOrchestrator', captureTimeoutOrchestrator);
```


### 5.3 Activity Function Error Handling

```typescript
import { app, InvocationContext } from '@azure/functions';

export async function processCaptureTimeoutActivity(
  captureRequestId: string,
  context: InvocationContext
): Promise<void> {
  
  context.log(`Processing timeout for capture: ${captureRequestId}`);
  
  try {
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
    context.log.metric('CaptureTimeout.UploadCount', uploadedCount);
    
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
      
      return;
    }
    
    // 6. Call GPT position estimation (may throw exception)
    const estimationOutput = await estimateSeatingPositions({
      captureRequestId,
      imageUrls: uploads.map(u => ({
        studentId: u.rowKey,
        blobUrl: u.blobUrl
      }))
    }, context);
    
    context.log.metric('CaptureTimeout.GPT.Success', 1);
    
    // 7. Store results
    await createCaptureResult({
      partitionKey: captureRequestId,
      rowKey: 'RESULT',
      sessionId,
      positions: JSON.stringify(estimationOutput.positions),
      analysisNotes: estimationOutput.analysisNotes,
      analyzedAt: new Date().toISOString()
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
    
  } catch (error: any) {
    // Log detailed error information
    context.error(`Activity function failed for capture: ${captureRequestId}`, {
      errorType: error.name,
      errorMessage: error.message,
      errorCode: error.code,
      statusCode: error.statusCode,
      stackTrace: error.stack
    });
    
    // Emit failure metrics
    context.log.metric('CaptureTimeout.Failure', 1);
    
    if (error.statusCode === 429) {
      context.log.metric('CaptureTimeout.GPT.RateLimited', 1);
    } else if (error.statusCode === 503) {
      context.log.metric('CaptureTimeout.GPT.ServiceUnavailable', 1);
    }
    
    // Re-throw to trigger orchestrator retry
    throw error;
  }
}

app.activity('processCaptureTimeoutActivity', {
  handler: processCaptureTimeoutActivity
});
```

**Key Points**:
- Let exceptions propagate for transient failures (network, service unavailable)
- Log detailed error information before re-throwing
- Emit metrics for monitoring
- Don't catch exceptions unless you want to prevent retry


### 5.4 Compensating Activity Function

```typescript
export async function handleCaptureFailure(
  input: { captureRequestId: string; sessionId: string; errorMessage: string },
  context: InvocationContext
): Promise<void> {
  
  context.log(`Handling capture failure for: ${input.captureRequestId}`);
  
  try {
    // Update capture request status to FAILED
    await updateCaptureRequest(input.captureRequestId, {
      status: 'FAILED',
      analysisCompletedAt: new Date().toISOString(),
      errorMessage: input.errorMessage
    });
    
    // Broadcast failure to teacher and students
    await broadcastToHub(input.sessionId, 'captureResults', {
      captureRequestId: input.captureRequestId,
      status: 'FAILED',
      errorMessage: `Position analysis failed: ${input.errorMessage}`
    }, context);
    
    context.log(`Capture failure handled for: ${input.captureRequestId}`);
    
  } catch (error: any) {
    // Log error but don't throw (best effort)
    context.error(`Failed to handle capture failure for: ${input.captureRequestId}`, {
      errorMessage: error.message
    });
  }
}

app.activity('handleCaptureFailure', {
  handler: handleCaptureFailure
});
```

---

## 6. Testing Error Handling

### 6.1 Unit Tests for Retry Logic

**Test 1: Activity Succeeds on First Attempt**:

```typescript
describe('captureTimeoutOrchestrator', () => {
  it('should complete successfully when activity succeeds', async () => {
    const context = new TestOrchestrationContext();
    
    // Mock activity success
    context.df.callActivityWithRetry = jest.fn().mockResolvedValue(undefined);
    
    const result = await captureTimeoutOrchestrator(context);
    
    expect(result.status).toBe('completed');
    expect(context.df.callActivityWithRetry).toHaveBeenCalledTimes(1);
  });
});
```

**Test 2: Activity Succeeds After Retry**:

```typescript
it('should retry and succeed on second attempt', async () => {
  const context = new TestOrchestrationContext();
  
  // Mock activity failure then success
  context.df.callActivityWithRetry = jest.fn()
    .mockRejectedValueOnce(new Error('Network timeout'))
    .mockResolvedValueOnce(undefined);
  
  const result = await captureTimeoutOrchestrator(context);
  
  expect(result.status).toBe('completed');
  expect(context.df.callActivityWithRetry).toHaveBeenCalledTimes(2);
});
```

**Test 3: Activity Fails After All Retries**:

```typescript
it('should fail after exhausting all retries', async () => {
  const context = new TestOrchestrationContext();
  
  // Mock activity failure on all attempts
  context.df.callActivityWithRetry = jest.fn()
    .mockRejectedValue(new Error('Invalid API key'));
  
  const result = await captureTimeoutOrchestrator(context);
  
  expect(result.status).toBe('failed');
  expect(result.error).toContain('Invalid API key');
  expect(context.df.callActivity).toHaveBeenCalledWith('handleCaptureFailure', expect.any(Object));
});
```

### 6.2 Integration Tests

**Test 1: End-to-End Retry Flow**:

```typescript
describe('Capture Timeout Integration', () => {
  it('should retry activity function on transient failure', async () => {
    // 1. Start orchestrator
    const client = df.getClient(context);
    const instanceId = await client.startNew('captureTimeoutOrchestrator', {
      instanceId: 'test-capture-123',
      input: {
        captureRequestId: 'test-capture-123',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        sessionId: 'test-session'
      }
    });
    
    // 2. Mock transient failure in activity
    // (simulate by temporarily breaking Azure Storage connection)
    
    // 3. Wait for orchestrator to complete
    const status = await client.waitForCompletionOrCreateCheckStatusResponse(
      context.bindingData.req,
      instanceId,
      60000,
      1000
    );
    
    // 4. Verify orchestrator succeeded after retry
    expect(status.runtimeStatus).toBe('Completed');
    expect(status.output.status).toBe('completed');
  });
});
```

**Test 2: Permanent Failure Handling**:

```typescript
it('should handle permanent failure gracefully', async () => {
  // 1. Start orchestrator
  const instanceId = await client.startNew('captureTimeoutOrchestrator', {
    instanceId: 'test-capture-456',
    input: { ... }
  });
  
  // 2. Mock permanent failure (invalid API key)
  process.env.AZURE_OPENAI_KEY = 'invalid-key';
  
  // 3. Wait for orchestrator to complete
  const status = await client.waitForCompletionOrCreateCheckStatusResponse(
    context.bindingData.req,
    instanceId,
    60000,
    1000
  );
  
  // 4. Verify orchestrator failed gracefully
  expect(status.runtimeStatus).toBe('Completed');
  expect(status.output.status).toBe('failed');
  
  // 5. Verify capture request marked as FAILED
  const captureRequest = await getCaptureRequest('test-capture-456');
  expect(captureRequest.status).toBe('FAILED');
  expect(captureRequest.errorMessage).toContain('401');
});
```


---

## 7. Best Practices Summary

### 7.1 Retry Policy Best Practices

✅ **DO**:
- Use exponential backoff for transient failures
- Set reasonable retry limits (3-5 attempts)
- Configure retry timeout to prevent indefinite retries
- Cap maximum retry interval to avoid excessive delays
- Use `callActivityWithRetry` for operations that may fail transiently

❌ **DON'T**:
- Set `maxNumberOfAttempts` to `-1` (infinite retries)
- Use fixed delay for all scenarios (exponential backoff is better)
- Retry on permanent failures (validation errors, business logic errors)
- Forget to configure `backoffCoefficient` (defaults to 1, no backoff)

### 7.2 Error Handling Best Practices

✅ **DO**:
- Always use try/catch in orchestrators to handle failures gracefully
- Log detailed error information (error type, message, stack trace)
- Emit custom metrics for monitoring
- Implement compensating actions for failed operations
- Let activity functions throw exceptions for transient failures
- Return error to caller if orchestrator fails to start

❌ **DON'T**:
- Catch exceptions in activity functions unless you want to prevent retry
- Let orchestrators fail with unhandled exceptions
- Fail upload notifications if external event raise fails
- Ignore errors (always log and monitor)
- Use generic error messages (be specific)

### 7.3 Logging Best Practices

✅ **DO**:
- Log orchestrator start, completion, and failure
- Log activity function start and completion
- Include correlation IDs (captureRequestId, sessionId) in all logs
- Use structured logging (JSON objects with properties)
- Emit custom metrics for key operations
- Log retry attempts and outcomes

❌ **DON'T**:
- Log sensitive information (API keys, personal data)
- Log excessively (creates noise)
- Use unstructured log messages (hard to query)
- Forget to log error details (stack trace, error code)

### 7.4 Monitoring Best Practices

✅ **DO**:
- Set up Application Insights alerts for high failure rates
- Monitor retry success rates
- Track orchestrator duration (P50, P95, P99)
- Monitor GPT API errors (rate limits, service unavailable)
- Create dashboards for key metrics
- Review logs regularly for patterns

❌ **DON'T**:
- Rely solely on logs (use metrics too)
- Ignore warning logs (they indicate potential issues)
- Wait for users to report errors (proactive monitoring)

---

## 8. Requirements Mapping

This research addresses the following requirements from the spec:

### Requirement 7.1: Activity Function Retry with Exponential Backoff

**Implementation**:
```typescript
const retryOptions = new df.RetryOptions(2000, 3);
retryOptions.backoffCoefficient = 2;  // Exponential backoff

yield context.df.callActivityWithRetry(
  'processCaptureTimeoutActivity',
  retryOptions,
  captureRequestId
);
```

**Retry Timeline**: 2s → 4s → 8s (3 attempts total)

### Requirement 7.2: Update Capture Request to FAILED When Retries Exhausted

**Implementation**:
```typescript
try {
  yield context.df.callActivityWithRetry(...);
} catch (error: any) {
  // All retries exhausted
  yield context.df.callActivity('handleCaptureFailure', {
    captureRequestId,
    sessionId,
    errorMessage: error.message
  });
}
```

### Requirement 7.3: Log Detailed Error Information

**Implementation**:
```typescript
context.error(`Orchestrator failed for capture: ${captureRequestId}`, {
  errorType: error.name,
  errorMessage: error.message,
  stackTrace: error.stack,
  captureRequestId,
  sessionId
});
```

### Requirement 7.4: Handle External Event Failures Gracefully

**Implementation**:
```typescript
try {
  await client.raiseEvent(captureRequestId, 'allUploadsComplete', data);
} catch (error: any) {
  // Log warning but don't fail
  context.warn(`Failed to raise external event: ${error.message}`);
}
```

### Requirement 7.5: Return Error to Teacher When Orchestrator Cannot Start

**Implementation**:
```typescript
try {
  await client.startNew('captureTimeoutOrchestrator', { ... });
} catch (error: any) {
  return {
    status: 500,
    jsonBody: {
      error: {
        code: 'ORCHESTRATOR_START_FAILED',
        message: 'Failed to start timeout orchestrator',
        timestamp: Date.now()
      }
    }
  };
}
```

---

## 9. Key Takeaways

### 9.1 Critical Points

1. **Retry Policies Are Powerful**: Automatic retry with exponential backoff handles most transient failures
2. **Always Use Try/Catch**: Orchestrators should always catch exceptions and handle failures gracefully
3. **Let Activity Functions Throw**: Don't catch exceptions in activity functions unless you want to prevent retry
4. **Compensating Actions**: Implement cleanup logic for failed operations
5. **Graceful Degradation**: External event failures shouldn't break the system (timer is fallback)
6. **Detailed Logging**: Log everything with correlation IDs for debugging
7. **Monitor Everything**: Use metrics and alerts to detect issues proactively

### 9.2 Pattern Summary

```
1. Configure retry policy with exponential backoff
2. Call activity with callActivityWithRetry
3. Wrap in try/catch for graceful failure handling
4. Implement compensating actions in catch block
5. Log detailed error information
6. Emit custom metrics for monitoring
7. Return structured error response
```

### 9.3 For Capture Timeout Feature

✅ **Recommended Configuration**:
- 3 retry attempts with exponential backoff (2s → 4s → 8s)
- Total retry budget: 30 seconds
- Compensating action: Update capture to FAILED and notify users
- Detailed error logging with correlation IDs
- Custom metrics for success/failure rates
- Graceful handling of external event failures

---

## 10. References

### 10.1 Official Microsoft Documentation

1. [Handling errors in Durable Functions](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-error-handling)
2. [Automatic retry on failure](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-error-handling#automatic-retry-on-failure)
3. [Function timeouts](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-error-handling#function-timeouts)
4. [Unhandled exceptions](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-error-handling#unhandled-exceptions)
5. [Azure Functions error handling and retries](https://learn.microsoft.com/azure/azure-functions/functions-bindings-error-pages)
6. [Reliable event processing](https://learn.microsoft.com/azure/azure-functions/functions-reliable-event-processing)

### 10.2 Code Examples from Microsoft

- Retry with exponential backoff (JavaScript): [Link](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-error-handling#automatic-retry-on-failure)
- Compensating actions pattern: [Link](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-error-handling#errors-in-activity-functions-and-sub-orchestrations)
- Function timeout pattern: [Link](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-error-handling#function-timeouts)

---

**Document Version**: 1.0  
**Last Updated**: 2024  
**Status**: Research Complete  
**Next Steps**: Proceed to task 2.1 (Install Durable Functions npm package)
