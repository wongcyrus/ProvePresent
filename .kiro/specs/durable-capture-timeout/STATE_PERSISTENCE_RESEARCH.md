# State Management and Persistence in Azure Durable Functions

## Overview

This document provides comprehensive research on how Azure Durable Functions persists orchestrator state, implements checkpoint and replay mechanisms, and manages storage requirements. This research addresses Requirements 6.1-6.5 from the durable-capture-timeout specification.

**Research Date**: 2024  
**Spec**: durable-capture-timeout  
**Task**: 1.3 Review state management and persistence

---

## 1. How Orchestrator State is Persisted

### 1.1 Event Sourcing Pattern

Azure Durable Functions uses the **Event Sourcing** design pattern to maintain orchestrator execution state reliably. Instead of storing the current state directly, the framework maintains an append-only log of all actions taken by the orchestration.

**Key Characteristics**:
- **Append-only store**: All orchestration actions are recorded as events in sequential order
- **No direct state storage**: Current state is reconstructed by replaying the event history
- **Transparent to developer**: The Durable Task Framework handles all persistence automatically

**Benefits**:
- Increased performance and scalability
- Eventual consistency for transactional data
- Full audit trails and history
- Support for reliable compensating actions

### 1.2 Storage Backend: Azure Storage Provider

By default, Durable Functions uses **Azure Storage** as the persistence backend with the following components:

#### Storage Components

1. **History Table** (`{TaskHubName}History`)
   - Azure Storage Table containing history events for all orchestration instances
   - **Partition Key**: Derived from orchestration instance ID
   - **Row Key**: Sequence number for ordering history events
   - **Content**: Full execution history including inputs, outputs, and event types
   - New rows are appended as the orchestration progresses

2. **Instances Table** (`{TaskHubName}Instances`)
   - Contains current status of all orchestration and entity instances
   - **Partition Key**: Orchestration instance ID or entity key
   - **Row Key**: Empty string
   - One row per orchestration instance
   - Used for instance queries and status checks
   - Kept eventually consistent with History table (CQRS pattern)

3. **Control Queues** (1-16 queues based on partition count)
   - Store orchestrator messages (timer messages, external events, control messages)
   - Each orchestration instance is assigned to a single control queue based on instance ID hash
   - Load balanced across function host workers
   - Support "at-least-once" message delivery guarantees

4. **Work-Item Queue** (single queue)
   - Stores activity function invocation messages
   - All workers compete for messages from this queue
   - Stateless activity functions can scale infinitely

5. **Blob Storage** (optional, for large messages)
   - Container: `{TaskHubName}-largemessages`
   - Used when data exceeds 45 KB (queue/table size limits)
   - Data is compressed and stored in blob, with reference in queue/table
   - Also used for partition lease management

### 1.3 Storage Configuration

**Default Configuration** (uses AzureWebJobsStorage):
```json
{
  "version": "2.0",
  "extensions": {
    "durableTask": {
      "hubName": "CaptureTaskHub",
      "storageProvider": {
        "type": "AzureStorage"
      }
    }
  }
}
```

**Custom Storage Account**:
```json
{
  "version": "2.0",
  "extensions": {
    "durableTask": {
      "hubName": "CaptureTaskHub",
      "storageProvider": {
        "type": "AzureStorage",
        "connectionStringName": "DurableFunctionsStorage"
      }
    }
  }
}
```

**Storage Account Requirements**:
- **Type**: Standard general-purpose Azure Storage account (v1 or v2)
- **Recommendation**: Use legacy v1 accounts (v2 can be more expensive for Durable Functions)
- **Not Supported**: Blob-only, premium, or other specialized storage account types
- **Authentication**: Supports connection strings or managed identity (recommended)

---

## 2. Checkpoint and Replay Mechanisms

### 2.1 Checkpoint Process

Orchestrator functions create **checkpoints** at specific points during execution. At each checkpoint, the Durable Task Framework:

1. **Saves execution history** to durable storage (History table)
2. **Enqueues messages** for functions the orchestrator wants to invoke
3. **Enqueues orchestrator messages** (e.g., durable timer messages)
4. **Unloads orchestrator from memory** after checkpoint completes

**Checkpoint Triggers**:
- When orchestrator calls `await` (C#) or `yield` (JavaScript/Python)
- After scheduling activity functions
- After creating durable timers
- After waiting for external events
- When orchestrator completes

**Example Checkpoint Sequence**:
```
1. Orchestrator starts → Checkpoint (ExecutionStarted event)
2. Schedule activity → Checkpoint (TaskScheduled event)
3. Activity completes → Checkpoint (TaskCompleted event)
4. Create timer → Checkpoint (TimerCreated event)
5. Timer fires → Checkpoint (TimerFired event)
6. Orchestrator completes → Checkpoint (ExecutionCompleted event)
```

### 2.2 Replay Mechanism

When an orchestration needs to resume (e.g., after activity completes, timer fires, or host restart), the framework uses **deterministic replay**:

**Replay Process**:
1. **Load history**: Query History table for all events with matching instance ID
2. **Re-execute orchestrator**: Run orchestrator function code from the beginning
3. **Consult history**: For each async operation, check if it already completed
4. **Replay results**: If operation completed, replay its result without re-executing
5. **Continue execution**: Process continues until new work is scheduled or orchestrator completes

**Example Replay Scenario**:

```typescript
// Orchestrator code
const result1 = await context.df.callActivity('Activity1', input1);
const result2 = await context.df.callActivity('Activity2', input2);
return [result1, result2];
```

**First Execution**:
- Call Activity1 → Checkpoint → Unload from memory
- Activity1 completes → Load history → Replay to Activity1 call → Get result from history
- Call Activity2 → Checkpoint → Unload from memory
- Activity2 completes → Load history → Replay to Activity2 call → Get result from history
- Return results → Checkpoint → Complete

**After Host Restart** (between Activity1 and Activity2):
- Load history from storage
- Replay orchestrator from start
- Activity1 call → Result found in history → Use cached result (no re-execution)
- Activity2 call → Not in history → Schedule new activity
- Continue as normal

### 2.3 Deterministic Execution Requirements

For replay to work correctly, orchestrator code **must be deterministic**:

**Prohibited Operations** (non-deterministic):
- ❌ `Date.now()`, `DateTime.Now`, `DateTime.UtcNow`
- ❌ `Math.random()`, `Random()`
- ❌ Direct HTTP calls
- ❌ Direct database queries
- ❌ Reading from file system
- ❌ Generating GUIDs directly

**Allowed Operations** (deterministic):
- ✅ `context.df.currentUtcDateTime` (deterministic time)
- ✅ `context.df.callActivity()` (activity functions can do I/O)
- ✅ `context.df.createTimer()` (durable timers)
- ✅ `context.df.waitForExternalEvent()` (external events)
- ✅ Local variable operations
- ✅ Conditional logic based on deterministic inputs

**Why Determinism Matters**:
- Orchestrator is replayed multiple times from scratch
- Non-deterministic operations would produce different results on each replay
- This would corrupt the orchestrator state and cause runtime errors

### 2.4 History Table Structure

**Example History Table Content**:

| PartitionKey | EventType | Timestamp | Input | Name | Result | Status |
|--------------|-----------|-----------|-------|------|--------|--------|
| capture-123 | ExecutionStarted | 2024-01-15T10:00:00Z | {"captureRequestId":"capture-123"} | captureTimeoutOrchestrator | | |
| capture-123 | OrchestratorStarted | 2024-01-15T10:00:00.100Z | | | | |
| capture-123 | TimerCreated | 2024-01-15T10:00:00.200Z | | | | |
| capture-123 | OrchestratorCompleted | 2024-01-15T10:00:00.300Z | | | | |
| capture-123 | TimerFired | 2024-01-15T10:01:00Z | | | | |
| capture-123 | OrchestratorStarted | 2024-01-15T10:01:00.100Z | | | | |
| capture-123 | TaskScheduled | 2024-01-15T10:01:00.200Z | | processCaptureTimeoutActivity | | |
| capture-123 | OrchestratorCompleted | 2024-01-15T10:01:00.300Z | | | | |
| capture-123 | TaskCompleted | 2024-01-15T10:01:05Z | | | {"status":"COMPLETED"} | |
| capture-123 | OrchestratorStarted | 2024-01-15T10:01:05.100Z | | | | |
| capture-123 | ExecutionCompleted | 2024-01-15T10:01:05.200Z | | | {"status":"completed"} | Completed |

---

## 3. State Recovery After Restarts

### 3.1 Automatic State Recovery

Durable Functions orchestrators **automatically survive function host restarts** without any code changes:

**Recovery Process**:
1. Function host restarts (due to deployment, crash, or scale-in/out)
2. Orchestrator state remains in Azure Storage (History and Instances tables)
3. Control queue messages remain in queues
4. When host restarts, it polls control queues
5. Messages trigger orchestrator to resume
6. History is loaded from storage
7. Orchestrator replays from beginning using history
8. Execution continues from last checkpoint

**What is Preserved**:
- ✅ Orchestration instance ID
- ✅ Complete execution history
- ✅ Scheduled timers (timer messages in control queue)
- ✅ Pending external events
- ✅ Activity function results
- ✅ Local variable state (reconstructed via replay)

**What is NOT Preserved**:
- ❌ In-memory state not captured in history
- ❌ Non-deterministic operation results (must use deterministic APIs)
- ❌ Local disk state (functions may run on different VMs)

### 3.2 Timer Persistence Across Restarts

**Durable timers are fully persistent**:

```typescript
// Create timer for 60 seconds from now
const expirationDate = new Date(input.expiresAt);
const timerTask = context.df.createTimer(expirationDate);
```

**Timer Persistence Mechanism**:
1. Timer creation is recorded in History table (TimerCreated event)
2. Timer message is enqueued in control queue with visibility timeout
3. If host restarts before timer fires:
   - Timer message remains in control queue
   - When timer fires, message becomes visible
   - Message triggers orchestrator to resume
   - History shows timer was created
   - Orchestrator continues execution

**Example Scenario**:
- 10:00:00 - Create timer for 10:01:00 (60 seconds)
- 10:00:30 - Function host crashes
- 10:00:45 - Function host restarts
- 10:01:00 - Timer message becomes visible in queue
- 10:01:00 - Orchestrator resumes, timer task completes
- Execution continues as if no restart occurred

### 3.3 Eventual Consistency

**Important Note**: Azure Storage doesn't provide transactional guarantees between tables and queues.

**Consistency Model**:
- Durable Functions uses **eventual consistency** patterns
- Ensures no data is lost during crashes or connectivity issues
- History table and Instances table may be temporarily inconsistent
- System converges to consistent state over time

**Implications**:
- Instance queries may show slightly stale data
- History is always authoritative source of truth
- Orchestrator replay ensures correct state reconstruction

---

## 4. Storage Requirements and Configuration

### 4.1 Storage Account Requirements

**Account Type**:
- **Required**: Standard general-purpose Azure Storage account
- **Recommended**: General Purpose v1 (StorageV1)
- **Supported**: General Purpose v2 (StorageV2) - but can be more expensive
- **Not Supported**: Blob-only, premium, or specialized storage accounts

**Storage Services Required**:
- ✅ **Tables**: For History and Instances tables
- ✅ **Queues**: For control queues and work-item queue
- ✅ **Blobs**: For large messages and partition leases

**Performance Tier**:
- Standard tier is sufficient for most workloads
- Premium tier not required (and not supported for tables/queues)

### 4.2 Task Hub Configuration

A **task hub** is a logical container for all Durable Functions state in storage.

**Task Hub Components**:
- 2-3 Azure Tables (History, Instances, optionally Partitions)
- 1 work-item queue
- 1-16 control queues (based on partition count)
- Blob containers for leases and large messages

**Configuration in host.json**:
```json
{
  "version": "2.0",
  "extensions": {
    "durableTask": {
      "hubName": "CaptureTaskHub",
      "storageProvider": {
        "type": "AzureStorage",
        "connectionStringName": "AzureWebJobsStorage",
        "partitionCount": 4,
        "controlQueueBatchSize": 32,
        "controlQueueBufferThreshold": 256,
        "maxQueuePollingInterval": "00:00:30"
      }
    }
  }
}
```

**Key Settings**:

| Setting | Default | Description | Recommendation |
|---------|---------|-------------|----------------|
| `hubName` | Function app name | Task hub name | Use descriptive name |
| `partitionCount` | 4 | Number of control queues | 4 is sufficient for most workloads |
| `controlQueueBatchSize` | 32 | Messages dequeued per poll | Keep default |
| `controlQueueBufferThreshold` | Varies | Prefetch buffer size | Increase for high throughput |
| `maxQueuePollingInterval` | 30s | Max polling delay | Decrease for lower latency |

### 4.3 Storage Capacity Planning

**Storage Usage Estimates**:

**Per Orchestration Instance**:
- History table: ~1-10 KB per instance (depends on complexity)
- Instances table: ~1 KB per instance
- Queue messages: Transient, deleted after processing
- Blob storage: Only if messages exceed 45 KB

**Example Calculation** (100 captures/day, 60-day retention):
- Total instances: 100 × 60 = 6,000 instances
- History storage: 6,000 × 5 KB = 30 MB
- Instances storage: 6,000 × 1 KB = 6 MB
- **Total**: ~36 MB (negligible)

**Storage Costs**:
- Table storage: ~$0.05 per GB/month
- Queue transactions: ~$0.05 per 100,000 transactions
- Blob storage: ~$0.02 per GB/month
- **Estimated monthly cost**: < $1 for typical workload

### 4.4 Connection Configuration

**Option 1: Connection String** (traditional):
```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "DefaultEndpointsProtocol=https;AccountName=mystorageaccount;AccountKey=...;EndpointSuffix=core.windows.net"
  }
}
```

**Option 2: Managed Identity** (recommended, more secure):
```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage__accountName": "mystorageaccount"
  }
}
```

**Required RBAC Roles for Managed Identity**:
- Storage Queue Data Contributor
- Storage Blob Data Contributor
- Storage Table Data Contributor

### 4.5 Multiple Function Apps Sharing Storage

**Important**: If multiple function apps share a storage account, each **must** have a unique task hub name:

```json
// App 1
{
  "extensions": {
    "durableTask": {
      "hubName": "CaptureTaskHub"
    }
  }
}

// App 2
{
  "extensions": {
    "durableTask": {
      "hubName": "ProcessingTaskHub"
    }
  }
}
```

**Why**: Task hub name differentiates storage resources. Without unique names, apps will compete for messages, causing orchestrations to get stuck in "Pending" or "Running" state.

---

## 5. Implications for Capture Timeout Feature

### 5.1 State Persistence Benefits

**For Our Use Case**:
1. **Timer Survives Restarts**: 60-second capture timeout will fire even if function host restarts
2. **No Lost Captures**: Orchestrator state persists across deployments and crashes
3. **Automatic Recovery**: No manual intervention needed after restarts
4. **Audit Trail**: Complete history of all capture timeout events in History table

### 5.2 Storage Requirements

**For Our Workload** (estimated 100 captures/day):
- **Storage**: < 50 MB/month (negligible)
- **Transactions**: ~20,000/day (queue polls, table reads/writes)
- **Cost**: < $1/month for storage and transactions
- **Existing Storage**: Can use existing `AzureWebJobsStorage` account

**Recommendation**: Use existing storage account, no additional provisioning needed.

### 5.3 Configuration Recommendations

**Recommended host.json Configuration**:
```json
{
  "version": "2.0",
  "extensions": {
    "durableTask": {
      "hubName": "CaptureTaskHub",
      "storageProvider": {
        "connectionStringName": "AzureWebJobsStorage",
        "partitionCount": 4
      },
      "tracing": {
        "traceInputsAndOutputs": true,
        "traceReplayEvents": false
      },
      "maxConcurrentOrchestratorFunctions": 10,
      "maxConcurrentActivityFunctions": 10
    }
  }
}
```

**Key Decisions**:
- **hubName**: "CaptureTaskHub" - descriptive and unique
- **partitionCount**: 4 - sufficient for expected load
- **traceInputsAndOutputs**: true - helpful for debugging
- **traceReplayEvents**: false - reduces log noise
- **maxConcurrent**: 10 - reasonable limit for concurrent captures

### 5.4 Deterministic Code Requirements

**For Our Orchestrator**:
```typescript
// ✅ CORRECT - Deterministic
const expirationDate = new Date(input.expiresAt); // Input from outside
const timerTask = context.df.createTimer(expirationDate);

// ❌ WRONG - Non-deterministic
const expirationDate = new Date(Date.now() + 60000); // Date.now() is non-deterministic
```

**Best Practices**:
- Calculate expiration time in HTTP trigger function (before starting orchestrator)
- Pass expiration timestamp as input to orchestrator
- Use `context.df.currentUtcDateTime` if time is needed in orchestrator
- Never use `Date.now()`, `Math.random()`, or direct I/O in orchestrator

---

## 6. Monitoring and Debugging State

### 6.1 Viewing State in Azure Storage Explorer

**History Table**:
- Navigate to Storage Account → Tables → `CaptureTaskHubHistory`
- Filter by PartitionKey (instance ID) to see all events for an orchestration
- View complete execution timeline

**Instances Table**:
- Navigate to Storage Account → Tables → `CaptureTaskHubInstances`
- See current status of all orchestrations
- Query by instance ID or status

**Control Queues**:
- Navigate to Storage Account → Queues → `CaptureTaskHub-control-XX`
- View pending messages (timers, external events)
- Useful for debugging stuck orchestrations

### 6.2 Programmatic State Queries

```typescript
// Get orchestrator status
const client = df.getClient(context);
const status = await client.getStatus(captureRequestId);

console.log(status.runtimeStatus); // "Running", "Completed", "Failed", etc.
console.log(status.input); // Orchestrator input
console.log(status.output); // Orchestrator output
console.log(status.createdTime); // When started
console.log(status.lastUpdatedTime); // Last checkpoint
```

### 6.3 Application Insights Integration

**Automatic Logging**:
- Orchestrator start/complete events
- Activity function invocations
- Timer creation/firing
- External event receipt
- Failures and retries

**Custom Metrics**:
```typescript
context.log.metric('CaptureOrchestrator.Duration', duration);
context.log.metric('CaptureOrchestrator.EarlyTermination', isEarlyTermination ? 1 : 0);
```

---

## 7. Summary and Key Takeaways

### 7.1 State Persistence

✅ **Orchestrator state is fully persisted** to Azure Storage using event sourcing  
✅ **History table** contains complete execution history for replay  
✅ **Instances table** contains current status for queries  
✅ **Control queues** contain pending messages (timers, events)  
✅ **State survives** function host restarts, deployments, and crashes  

### 7.2 Checkpoint and Replay

✅ **Checkpoints** occur at every `await`/`yield` point  
✅ **Replay** reconstructs state by re-executing orchestrator with history  
✅ **Deterministic code** is required for correct replay behavior  
✅ **Timers persist** across restarts via queue messages  
✅ **Local variables** are restored via replay  

### 7.3 Storage Requirements

✅ **Standard general-purpose storage account** required  
✅ **AzureWebJobsStorage** can be used (no separate account needed)  
✅ **Storage costs** are negligible for typical workloads  
✅ **Task hub** automatically created on first run  
✅ **Managed identity** recommended for secure connections  

### 7.4 For Capture Timeout Feature

✅ **No additional storage provisioning** needed  
✅ **Timers will survive restarts** - captures won't be lost  
✅ **Minimal configuration** required in host.json  
✅ **Deterministic orchestrator code** is critical  
✅ **Complete audit trail** available in History table  

---

## 8. References

- [Azure Durable Functions Overview](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-overview)
- [Durable Orchestrations](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-orchestrations)
- [Azure Storage Provider](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-azure-storage-provider)
- [Orchestrator Code Constraints](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-code-constraints)
- [Task Hubs](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-task-hubs)
- [Event Sourcing Pattern](https://learn.microsoft.com/azure/architecture/patterns/event-sourcing)
- [Storage Providers](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-storage-providers)

---

**Document Status**: Complete  
**Requirements Addressed**: 6.1, 6.2, 6.3, 6.4, 6.5  
**Next Steps**: Proceed to task 1.4 (Review error handling and retry patterns)
