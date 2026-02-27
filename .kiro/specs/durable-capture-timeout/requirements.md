# Requirements Document

## Introduction

This feature migrates the Azure Function timer polling mechanism to Azure Durable Functions for the student image capture timeout feature. The current implementation uses a timer function that runs every 10 seconds to check for expired capture requests, which is inefficient and wastes compute resources. The new implementation will use Azure Durable Functions orchestrators with durable timers to create event-driven, per-request timeout handling that eliminates polling overhead.

## Glossary

- **Capture_Request**: A teacher-initiated request for students to upload photos, with a defined expiration time (default 60 seconds)
- **Durable_Orchestrator**: An Azure Durable Functions orchestrator that manages long-running workflows with durable timers
- **Durable_Timer**: A timer mechanism in Azure Durable Functions that schedules future work without polling
- **Timer_Function**: The current polling-based Azure Function that runs every 10 seconds (to be removed)
- **Capture_Timeout_Handler**: The activity function that processes expired capture requests
- **Early_Termination**: Completing a capture request before expiration when all students have uploaded
- **Position_Estimation**: GPT-based analysis of uploaded student photos to determine seating positions
- **Capture_Upload**: A record of a student's uploaded photo for a specific capture request
- **SignalR**: Azure service used to broadcast real-time events to teachers and students

## Requirements

### Requirement 1: Durable Orchestrator Creation

**User Story:** As a teacher, I want capture requests to be processed efficiently without polling overhead, so that the system scales better and reduces costs

#### Acceptance Criteria

1. WHEN a capture request is initiated, THE Capture_Initiation_Function SHALL start a new Durable_Orchestrator instance with the captureRequestId as the instance ID
2. THE Durable_Orchestrator SHALL create a durable timer for the exact expiration time (createdAt + timeout duration)
3. THE Durable_Orchestrator SHALL wait for either the timer to fire OR an external event signaling early termination
4. WHEN the timer fires, THE Durable_Orchestrator SHALL invoke the Capture_Timeout_Handler activity function
5. WHEN an early termination event is received, THE Durable_Orchestrator SHALL cancel the timer and invoke the Capture_Timeout_Handler activity function

### Requirement 2: Timeout Processing Activity

**User Story:** As a system, I want to process expired capture requests consistently, so that the same logic applies whether timeout occurs naturally or via early termination

#### Acceptance Criteria

1. THE Capture_Timeout_Handler SHALL query the CaptureUploads table for all uploaded images for the given captureRequestId
2. THE Capture_Timeout_Handler SHALL update the Capture_Request status to 'ANALYZING'
3. THE Capture_Timeout_Handler SHALL broadcast a captureExpired event via SignalR to all students and the teacher
4. WHEN uploadedCount is greater than 0, THE Capture_Timeout_Handler SHALL invoke the Position_Estimation function
5. WHEN uploadedCount equals 0, THE Capture_Timeout_Handler SHALL update the Capture_Request status to 'COMPLETED' with no results
6. WHEN Position_Estimation succeeds, THE Capture_Timeout_Handler SHALL store results and update status to 'COMPLETED'
7. WHEN Position_Estimation fails, THE Capture_Timeout_Handler SHALL update status to 'FAILED' and broadcast error details
8. THE Capture_Timeout_Handler SHALL broadcast captureResults event via SignalR to the teacher

### Requirement 3: Early Termination Support

**User Story:** As a teacher, I want capture requests to complete immediately when all students have uploaded, so that I don't have to wait for the full timeout period

#### Acceptance Criteria

1. WHEN a student upload is recorded, THE Upload_Notification_Function SHALL check if uploadedCount equals onlineStudentCount
2. WHEN all students have uploaded, THE Upload_Notification_Function SHALL raise an external event to the Durable_Orchestrator instance
3. THE Durable_Orchestrator SHALL respond to the early termination event by canceling the durable timer
4. WHEN early termination occurs, THE Durable_Orchestrator SHALL invoke the Capture_Timeout_Handler activity function immediately

### Requirement 4: Timer Function Removal

**User Story:** As a system administrator, I want to remove the polling timer function, so that we eliminate unnecessary compute costs and complexity

#### Acceptance Criteria

1. THE System SHALL remove the processCaptureTimeout.ts timer function file
2. THE System SHALL remove the timer trigger registration from Azure Functions configuration
3. THE System SHALL verify no other components depend on the Timer_Function
4. THE System SHALL update any documentation referencing the Timer_Function

### Requirement 5: Durable Functions Infrastructure

**User Story:** As a developer, I want the infrastructure to support Durable Functions, so that orchestrators can persist state and manage timers

#### Acceptance Criteria

1. THE Azure_Functions_Host SHALL be configured with the Durable Functions extension
2. THE System SHALL provision a storage account for Durable Functions state management
3. THE System SHALL configure the AzureWebJobsStorage connection string for durable state
4. WHERE the infrastructure uses Bicep templates, THE Infrastructure_Code SHALL include Durable Functions configuration
5. THE System SHALL verify Durable Functions runtime is available in the deployment environment

### Requirement 6: Orchestrator State Management

**User Story:** As a system, I want orchestrator state to be persisted reliably, so that capture timeouts are not lost during function restarts

#### Acceptance Criteria

1. THE Durable_Orchestrator SHALL persist its state to Azure Storage after each checkpoint
2. WHEN the function host restarts, THE Durable_Orchestrator SHALL resume from the last checkpoint
3. THE Durable_Orchestrator SHALL maintain the timer expiration even across host restarts
4. THE System SHALL use deterministic replay to reconstruct orchestrator state
5. THE Durable_Orchestrator SHALL not execute non-deterministic operations (random, Date.now, HTTP calls) directly

### Requirement 7: Error Handling and Retry

**User Story:** As a system, I want robust error handling for timeout processing, so that transient failures don't cause capture requests to be lost

#### Acceptance Criteria

1. WHEN the Capture_Timeout_Handler activity function fails, THE Durable_Orchestrator SHALL retry up to 3 times with exponential backoff
2. WHEN all retries are exhausted, THE Durable_Orchestrator SHALL update the Capture_Request status to 'FAILED'
3. WHEN a failure occurs, THE System SHALL log detailed error information including captureRequestId and error type
4. THE Durable_Orchestrator SHALL handle external event failures gracefully without terminating the orchestration
5. WHEN the orchestrator cannot be started, THE Capture_Initiation_Function SHALL return an error to the teacher

### Requirement 8: Monitoring and Observability

**User Story:** As a system administrator, I want to monitor durable orchestrations, so that I can troubleshoot issues and track system health

#### Acceptance Criteria

1. THE System SHALL log when a Durable_Orchestrator instance is started with the captureRequestId
2. THE System SHALL log when a durable timer is created with the expiration timestamp
3. THE System SHALL log when early termination events are received
4. THE System SHALL log when the Capture_Timeout_Handler activity function is invoked
5. THE System SHALL log orchestrator completion status (completed, failed, terminated)
6. WHERE Application Insights is configured, THE System SHALL emit custom metrics for orchestrator duration and success rate

### Requirement 9: Backward Compatibility

**User Story:** As a developer, I want the migration to maintain existing behavior, so that teachers and students experience no disruption

#### Acceptance Criteria

1. THE Capture_Timeout_Handler SHALL implement the same processing logic as the current Timer_Function
2. THE System SHALL broadcast the same SignalR events (captureExpired, captureResults) as the current implementation
3. THE System SHALL maintain the same Capture_Request status transitions (ACTIVE → ANALYZING → COMPLETED/FAILED)
4. THE System SHALL store results in the same table structure as the current implementation
5. THE System SHALL support the same timeout duration configuration (default 60 seconds)

### Requirement 10: Testing and Validation

**User Story:** As a developer, I want comprehensive tests for the durable orchestrator, so that I can verify correct behavior before deployment

#### Acceptance Criteria

1. THE Test_Suite SHALL include unit tests for the Durable_Orchestrator logic
2. THE Test_Suite SHALL include unit tests for the Capture_Timeout_Handler activity function
3. THE Test_Suite SHALL include integration tests for the complete timeout flow (initiate → wait → expire → process)
4. THE Test_Suite SHALL include integration tests for early termination flow (initiate → all upload → process)
5. THE Test_Suite SHALL verify timer cancellation when early termination occurs
6. THE Test_Suite SHALL verify orchestrator state persistence and replay behavior
7. THE Test_Suite SHALL verify error handling and retry logic
