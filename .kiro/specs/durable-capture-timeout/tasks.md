# Implementation Plan: Migrate Timer Polling to Durable Functions

## Overview

This implementation plan migrates the Azure Function timer polling mechanism to Azure Durable Functions for the student image capture timeout feature. The current implementation uses a timer function (`processCaptureTimeout.ts`) that runs every 10 seconds to check for expired capture requests, which is inefficient and wastes compute resources. The new implementation will use Azure Durable Functions orchestrators with durable timers to create event-driven, per-request timeout handling that eliminates polling overhead.

The implementation follows this sequence:
1. Research Azure Durable Functions documentation and patterns
2. Set up Durable Functions infrastructure and configuration
3. Create orchestrator function with durable timer
4. Create activity function for timeout processing
5. Update initiate capture to start orchestrator
6. Update upload notification to support early termination
7. Remove old timer function
8. Add comprehensive testing and monitoring

## Tasks

- [ ] 1. Research Azure Durable Functions
  - [x] 1.1 Review Microsoft Learn documentation for Durable Functions
    - Read Durable Functions overview and concepts
    - Study durable timer patterns and examples
    - Review orchestrator constraints (deterministic replay, no I/O)
    - Review activity function patterns
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  
  - [x] 1.2 Review external event patterns
    - Study how to raise external events to orchestrators
    - Review event-based early termination patterns
    - Understand event handling in orchestrator code
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  
  - [x] 1.3 Review state management and persistence
    - Understand how orchestrator state is persisted
    - Study checkpoint and replay mechanisms
    - Review storage requirements for durable state
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  
  - [x] 1.4 Review error handling and retry patterns
    - Study activity function retry policies
    - Review error handling in orchestrators
    - Understand failure scenarios and recovery
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 2. Set up Durable Functions infrastructure
  - [x] 2.1 Install Durable Functions npm package
    - Add durable-functions package to backend/package.json
    - Install @azure/functions v4 if not already present
    - Update package-lock.json
    - _Requirements: 5.1_
  
  - [x] 2.2 Configure Durable Functions in host.json
    - Add durableTask extension configuration
    - Configure task hub name (e.g., "CaptureTaskHub")
    - Set appropriate timeout and retry settings
    - _Requirements: 5.1, 5.2_
  
  - [x] 2.3 Update infrastructure for Durable Functions storage
    - Verify AzureWebJobsStorage is configured for durable state
    - Ensure storage account supports table storage (required for state)
    - Add any required Bicep configuration for Durable Functions
    - _Requirements: 5.2, 5.3, 6.1_
  
  - [x] 2.4 Verify Durable Functions runtime availability
    - Test that Durable Functions extension loads correctly
    - Verify storage connection for state management
    - Check that task hub is created in storage
    - _Requirements: 5.4, 5.5_

- [ ] 3. Create capture timeout orchestrator
  - [x] 3.1 Create captureTimeoutOrchestrator.ts file
    - Define orchestrator function with DurableOrchestrationContext
    - Accept captureRequestId as input parameter
    - Add deterministic logging for orchestrator start
    - _Requirements: 1.1, 8.1_
  
  - [x] 3.2 Implement durable timer creation
    - Calculate expiration time from input (createdAt + timeout duration)
    - Create durable timer using context.createTimer()
    - Log timer creation with expiration timestamp
    - _Requirements: 1.2, 8.2_
  
  - [x] 3.3 Implement external event listener
    - Set up listener for "allUploadsComplete" external event
    - Use context.waitForExternalEvent() with event name
    - _Requirements: 1.3, 3.2_
  
  - [x] 3.4 Implement race condition between timer and event
    - Use Promise.race() to wait for either timer or external event
    - Determine which completed first (timeout vs early termination)
    - Cancel timer if external event fires first
    - _Requirements: 1.3, 1.4, 1.5, 3.3_
  
  - [x] 3.5 Invoke activity function for timeout processing
    - Call context.callActivity() with activity function name
    - Pass captureRequestId as parameter
    - Configure retry policy (3 retries with exponential backoff)
    - _Requirements: 1.4, 1.5, 7.1_
  
  - [x] 3.6 Handle orchestrator completion
    - Log orchestrator completion status
    - Return result indicating success or failure
    - Ensure all code paths complete the orchestration
    - _Requirements: 8.5_
  
  - [x] 3.7 Register orchestrator function
    - Use app.orchestration() to register the function
    - Set appropriate function name
    - _Requirements: 1.1_

- [x] 4. Create capture timeout activity function
  - [x] 4.1 Create processCaptureTimeoutActivity.ts file
    - Define activity function with ActivityContext
    - Accept captureRequestId as input parameter
    - Extract existing logic from processCaptureTimeout.ts
    - _Requirements: 2.1, 2.2_
  
  - [x] 4.2 Implement upload query logic
    - Query CaptureUploads table for all uploaded images
    - Get uploadedCount and totalCount
    - _Requirements: 2.1_
  
  - [x] 4.3 Update capture request status to ANALYZING
    - Call updateCaptureRequest with status 'ANALYZING'
    - Set analysisStartedAt timestamp
    - _Requirements: 2.2_
  
  - [x] 4.4 Broadcast captureExpired event
    - Call broadcastToHub with captureExpired event
    - Include uploadedCount and totalCount in payload
    - Broadcast to all students and teacher
    - _Requirements: 2.3_
  
  - [x] 4.5 Handle zero uploads case
    - If uploadedCount === 0, update status to COMPLETED
    - Broadcast captureResults with empty positions
    - Skip position estimation
    - _Requirements: 2.4, 2.5_
  
  - [x] 4.6 Invoke position estimation for uploads
    - If uploadedCount > 0, call estimateSeatingPositions
    - Pass captureRequestId and image URLs
    - Handle estimation success and failure
    - _Requirements: 2.4_
  
  - [x] 4.7 Store results and update status
    - On success: create CaptureResult and update status to COMPLETED
    - On failure: update status to FAILED with error message
    - _Requirements: 2.6_
  
  - [x] 4.8 Broadcast results to teacher
    - Call broadcastToHub with captureResults event
    - Include positions or error message
    - _Requirements: 2.8_
  
  - [x] 4.9 Implement error handling
    - Wrap all logic in try-catch
    - Log errors with context
    - Throw error to trigger orchestrator retry
    - _Requirements: 7.1, 7.2, 7.3_
  
  - [x] 4.10 Register activity function
    - Use app.activity() to register the function
    - Set appropriate function name
    - _Requirements: 2.1_

- [x] 5. Update initiate capture function
  - [x] 5.1 Import Durable Functions client
    - Import DurableClient from durable-functions
    - Get client instance from context
    - _Requirements: 1.1_
  
  - [x] 5.2 Start orchestrator instance after creating capture request
    - Call client.startNew() with orchestrator name
    - Use captureRequestId as instance ID
    - Pass input data (captureRequestId, createdAt, timeout)
    - _Requirements: 1.1, 8.1_
  
  - [x] 5.3 Handle orchestrator start errors
    - Catch errors from startNew()
    - Log error details
    - Return 500 error to teacher if orchestrator fails to start
    - _Requirements: 7.5_
  
  - [x] 5.4 Add logging for orchestrator start
    - Log orchestrator instance ID
    - Log input parameters
    - _Requirements: 8.1_

- [x] 6. Update upload notification function
  - [x] 6.1 Import Durable Functions client
    - Import DurableClient from durable-functions
    - Get client instance from context
    - _Requirements: 3.1_
  
  - [x] 6.2 Check if all students have uploaded
    - After incrementing uploadedCount, compare with onlineStudentCount
    - Determine if uploadedCount === onlineStudentCount
    - _Requirements: 3.1_
  
  - [x] 6.3 Raise external event for early termination
    - If all uploaded, call client.raiseEvent()
    - Use captureRequestId as instance ID
    - Use "allUploadsComplete" as event name
    - Pass empty payload or confirmation data
    - _Requirements: 3.2, 3.4_
  
  - [x] 6.4 Handle event raise errors
    - Catch errors from raiseEvent()
    - Log error but don't fail the upload notification
    - Orchestrator will still complete via timer if event fails
    - _Requirements: 7.4_
  
  - [x] 6.5 Add logging for early termination
    - Log when all uploads complete
    - Log external event raise
    - _Requirements: 8.3_

- [x] 7. Remove old timer function
  - [x] 7.1 Delete processCaptureTimeout.ts file
    - Remove the file from backend/src/functions/
    - _Requirements: 4.1_
  
  - [x] 7.2 Verify no dependencies on timer function
    - Search codebase for references to processCaptureTimeout
    - Ensure no imports or calls to the function
    - _Requirements: 4.3_
  
  - [x] 7.3 Update documentation
    - Remove references to timer function from CAPTURE_FEATURE_COMPLETE.md
    - Update TIMER_FUNCTION_ANALYSIS.md to reflect migration completion
    - Add notes about Durable Functions approach
    - _Requirements: 4.4_
  
  - [x] 7.4 Update deployment scripts if needed
    - Check if any scripts reference the timer function
    - Update function app configuration if needed
    - _Requirements: 4.2_

- [x] 8. Add monitoring and observability
  - [x] 8.1 Add orchestrator lifecycle logging
    - Log orchestrator start with captureRequestId
    - Log timer creation with expiration timestamp
    - Log external event receipt
    - Log activity function invocation
    - Log orchestrator completion
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  
  - [x] 8.2 Add Application Insights custom metrics
    - Emit metric for orchestrator duration
    - Emit metric for early termination rate
    - Emit metric for timeout processing success rate
    - _Requirements: 8.6_
  
  - [x] 8.3 Add error logging
    - Log orchestrator failures with details
    - Log activity function retry attempts
    - Log external event failures
    - _Requirements: 7.3, 8.5_

- [x] 9. Implement testing
  - [x] 9.1 Write unit tests for orchestrator logic
    - Test timer creation and expiration
    - Test external event handling
    - Test race condition between timer and event
    - Test activity function invocation
    - Mock DurableOrchestrationContext
    - _Requirements: 10.1_
  
  - [x] 9.2 Write unit tests for activity function
    - Test upload query logic
    - Test status transitions
    - Test position estimation invocation
    - Test result broadcasting
    - Test error handling
    - Mock table storage and SignalR
    - _Requirements: 10.2_
  
  - [x] 9.3 Write integration test for complete timeout flow
    - Create capture request
    - Start orchestrator
    - Wait for timer to expire
    - Verify activity function executes
    - Verify status updates and broadcasts
    - _Requirements: 10.3_
  
  - [x] 9.4 Write integration test for early termination flow
    - Create capture request
    - Start orchestrator
    - Simulate all students uploading
    - Raise external event
    - Verify activity function executes immediately
    - Verify timer is cancelled
    - _Requirements: 10.4_
  
  - [x] 9.5 Write test for orchestrator state persistence
    - Start orchestrator
    - Simulate function host restart
    - Verify orchestrator resumes from checkpoint
    - Verify timer expiration still occurs
    - _Requirements: 10.6_
  
  - [x] 9.6 Write test for error handling and retry
    - Simulate activity function failure
    - Verify retry attempts (up to 3)
    - Verify final failure handling
    - Verify status update to FAILED
    - _Requirements: 10.7_
  
  - [x] 9.7 Write test for timer cancellation
    - Start orchestrator with timer
    - Raise external event before timer expires
    - Verify timer is cancelled
    - Verify no duplicate processing
    - _Requirements: 10.5_

- [x] 10. Verify backward compatibility
  - [x] 10.1 Test capture timeout processing logic
    - Verify same status transitions (ACTIVE → ANALYZING → COMPLETED/FAILED)
    - Verify same SignalR events (captureExpired, captureResults)
    - Verify same result storage format
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  
  - [x] 10.2 Test timeout duration configuration
    - Verify default 60-second timeout (updated from 30s)
    - Verify timeout can be configured via environment variable
    - _Requirements: 9.5_
  
  - [x] 10.3 Test with existing capture requests
    - Verify new orchestrator works with existing table schema
    - Verify no breaking changes to API contracts
    - _Requirements: 9.1, 9.4_

- [x] 11. Deploy and validate
  - [x] 11.1 Deploy to development environment
    - Deploy backend with Durable Functions
    - Verify orchestrator and activity functions are registered
    - Verify task hub is created in storage
    - _Requirements: 5.5_
  
  - [x] 11.2 Test end-to-end capture flow
    - Initiate capture as teacher
    - Verify orchestrator starts
    - Wait for timeout
    - Verify processing completes
    - Verify results delivered
    - _Requirements: 9.1, 9.2, 9.3_
  
  - [x] 11.3 Test early termination flow
    - Initiate capture as teacher
    - Have all students upload quickly
    - Verify early termination triggers
    - Verify processing completes immediately
    - _Requirements: 9.1, 9.2_
  
  - [x] 11.4 Monitor orchestrator execution
    - Check Application Insights for orchestrator traces
    - Verify custom metrics are emitted
    - Check for any errors or warnings
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  
  - [x] 11.5 Verify timer function is removed
    - Check that processCaptureTimeout is not running
    - Verify no timer trigger executions in logs
    - _Requirements: 4.1, 4.2_

## Notes

- All tasks should be completed in sequence to ensure proper migration
- Task 1 (Research) is critical - do not skip Microsoft Learn documentation review
- Orchestrator functions must be deterministic (no Date.now(), no HTTP calls, no random)
- Activity functions can perform any I/O operations (database, HTTP, etc.)
- Durable timers persist across function host restarts
- External events are queued if orchestrator is not yet waiting for them
- Use captureRequestId as orchestrator instance ID for easy correlation
- Retry policy for activity functions: 3 attempts with exponential backoff (2s, 4s, 8s)
- Default timeout duration should be configurable (environment variable)
- Monitor orchestrator execution in Application Insights for troubleshooting
- Test thoroughly before removing old timer function
- Keep TIMER_FUNCTION_ANALYSIS.md for historical reference
- Update all documentation to reflect new Durable Functions approach

