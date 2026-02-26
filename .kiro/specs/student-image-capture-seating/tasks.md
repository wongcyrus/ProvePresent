# Implementation Plan: Student Image Capture and Seating Position Estimation

## Overview

This implementation plan breaks down the student image capture feature into discrete coding tasks. The feature enables teachers to trigger photo capture requests during online sessions, students upload photos directly to Azure Blob Storage within a 30-second window, and GPT-4o analyzes the images to estimate seating positions based on projector visibility.

The implementation follows this sequence:
1. Set up data models and storage infrastructure
2. Implement backend Azure Functions for capture workflow
3. Build frontend components for teacher and student interfaces
4. Integrate GPT-4o vision API for position estimation
5. Wire SignalR real-time communication
6. Add comprehensive error handling and testing

## Tasks

- [ ] 1. Set up data models and storage infrastructure
  - [x] 1.1 Create TypeScript interfaces for all data models
    - Define CaptureRequest, CaptureUpload, CaptureResult, SeatingPosition interfaces
    - Create types for API request/response payloads
    - Define SignalR event payload types
    - _Requirements: 1.1, 1.2, 1.4, 2.1, 3.1, 6.1, 6.3, 7.1, 7.2, 7.3, 8.2_
  
  - [x] 1.2 Create Azure Table Storage helper functions
    - Implement createCaptureRequest, getCaptureRequest, updateCaptureRequest functions
    - Implement createCaptureUpload, getCaptureUploads functions
    - Implement createCaptureResult, getCaptureResult functions
    - Add retry logic with exponential backoff for Table Storage operations
    - _Requirements: 8.2, 8.3, 8.4_
  
  - [ ]* 1.3 Write unit tests for Table Storage helpers
    - Test CRUD operations with mock Table Storage client
    - Test retry logic on transient failures
    - Test error handling for invalid inputs
    - _Requirements: 8.2, 8.3_

- [ ] 2. Implement Azure Blob Storage integration
  - [x] 2.1 Create SAS URL generation function
    - Implement generateStudentSasUrl with write-only permissions
    - Set 90-second expiry (30s window + 60s grace)
    - Use blob naming pattern: {sessionId}/{captureRequestId}/{studentId}.jpg
    - _Requirements: 1.4, 3.1, 9.1, 9.2, 9.3, 9.4_
  
  - [x] 2.2 Create read SAS URL generation for GPT access
    - Implement generateReadSasUrl with 5-minute read-only access
    - Use for GPT image analysis
    - _Requirements: 6.1_
  
  - [x] 2.3 Implement blob verification function
    - Create verifyBlobExists to check if student upload completed
    - Use for upload notification validation
    - _Requirements: 3.3_
  
  - [ ]* 2.4 Write property test for SAS URL generation
    - **Property 4: SAS URL Uniqueness**
    - **Property 21: SAS URL Expiration Time**
    - **Property 22: SAS URL Write-Only Permissions**
    - **Property 23: Student-Specific Blob Names**
    - **Validates: Requirements 1.4, 9.1, 9.2, 9.3, 9.4**
  
  - [ ]* 2.5 Write unit tests for blob operations
    - Test SAS URL format and parameters
    - Test blob verification with existing and non-existent blobs
    - Test with Azurite local storage
    - _Requirements: 3.1, 3.3_

- [x] 3. Checkpoint - Ensure storage infrastructure tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement initiate capture Azure Function
  - [x] 4.1 Create HTTP trigger function for POST /api/sessions/{sessionId}/capture/initiate
    - Validate teacher authentication and session ownership
    - Query online students from Attendance table
    - Generate unique captureRequestId (UUID)
    - Calculate expiresAt timestamp (createdAt + 30 seconds)
    - _Requirements: 1.1, 1.2_
  
  - [x] 4.2 Generate SAS URLs for all online students
    - Call generateStudentSasUrl for each student
    - Store URLs in memory for SignalR broadcast
    - _Requirements: 1.4, 9.1_
  
  - [x] 4.3 Store capture request in Table Storage
    - Create CaptureRequest entity with status 'ACTIVE'
    - Store onlineStudentIds as JSON array
    - Set uploadedCount to 0
    - _Requirements: 8.2, 8.3_
  
  - [x] 4.4 Broadcast capture request via SignalR
    - Send captureRequest event to each student with their SAS URL
    - Include captureRequestId, sasUrl, expiresAt, blobName
    - _Requirements: 1.1, 7.1_
  
  - [x] 4.5 Return success response to teacher
    - Return captureRequestId, expiresAt, onlineStudentCount
    - Handle errors (no online students, invalid session, auth failures)
    - _Requirements: 1.1_
  
  - [ ]* 4.6 Write property tests for capture initiation
    - **Property 1: Broadcast Delivery to All Online Students**
    - **Property 2: Capture Window Duration**
    - **Property 3: Multiple Capture Requests Per Session**
    - **Validates: Requirements 1.1, 1.2, 1.3, 7.1**
  
  - [ ]* 4.7 Write unit tests for initiate capture function
    - Test with valid session and online students
    - Test with no online students (400 error)
    - Test with invalid session (404 error)
    - Test with unauthorized user (403 error)
    - Test multiple captures for same session
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 5. Implement upload notification Azure Function
  - [x] 5.1 Create HTTP trigger function for POST /api/sessions/{sessionId}/capture/{captureRequestId}/upload
    - Validate student authentication
    - Extract sessionId, captureRequestId, blobName from request
    - _Requirements: 3.3_
  
  - [x] 5.2 Validate upload timing and blob existence
    - Check if capture request is still active (not expired)
    - Verify blob exists in storage using verifyBlobExists
    - Return 400 if expired or blob doesn't exist
    - _Requirements: 5.2, 5.4_
  
  - [x] 5.3 Record upload in Table Storage
    - Create CaptureUpload entity with studentId, blobName, uploadedAt
    - Increment uploadedCount in CaptureRequest entity
    - _Requirements: 3.3, 8.2_
  
  - [x] 5.4 Notify teacher via SignalR
    - Send uploadComplete event with studentId, uploadedAt, uploadedCount, totalCount
    - _Requirements: 7.2_
  
  - [x] 5.5 Return success response to student
    - Return success: true, uploadedAt timestamp
    - _Requirements: 3.3_
  
  - [ ]* 5.6 Write property tests for upload notification
    - **Property 8: Upload Completion Notification**
    - **Property 12: Post-Expiration Upload Rejection**
    - **Property 17: Upload Notification via SignalR**
    - **Validates: Requirements 3.3, 5.2, 5.4, 7.2**
  
  - [ ]* 5.7 Write unit tests for upload notification function
    - Test valid upload within window
    - Test upload after expiration (rejection)
    - Test with non-existent blob (error)
    - Test with unauthorized student (403 error)
    - _Requirements: 3.3, 5.2, 5.4_

- [x] 6. Implement capture timeout processor Azure Function
  - [x] 6.1 Create timer trigger function (runs every 10 seconds)
    - Query CaptureRequests table for requests with expiresAt < now and status 'ACTIVE'
    - Process each expired request
    - _Requirements: 5.1, 5.2_
  
  - [x] 6.2 Handle capture expiration
    - Update status to 'ANALYZING'
    - Query CaptureUploads for all uploaded images
    - Broadcast captureExpired event to all students and teacher
    - Include uploadedCount and totalCount in event
    - _Requirements: 5.2, 5.3, 7.3_
  
  - [x] 6.3 Trigger position estimation
    - If uploadedCount > 0, call estimateSeatingPositions function
    - If uploadedCount = 0, mark as COMPLETED with no results
    - Handle GPT analysis errors and update status to FAILED
    - _Requirements: 6.1_
  
  - [x] 6.4 Broadcast results to teacher
    - Send captureResults event with positions or error message
    - Update status to 'COMPLETED' or 'FAILED'
    - _Requirements: 6.3, 7.3_
  
  - [ ]* 6.5 Write property tests for timeout processing
    - **Property 13: Teacher Notification on Expiration**
    - **Property 14: Analysis Trigger on Completion**
    - **Property 18: Expiration Notification via SignalR**
    - **Validates: Requirements 5.3, 6.1, 7.3**
  
  - [ ]* 6.6 Write unit tests for timeout processor
    - Test identification of expired requests
    - Test status transitions (ACTIVE → ANALYZING → COMPLETED)
    - Test with zero uploads (no GPT call)
    - Test with partial uploads
    - Test error handling for GPT failures
    - _Requirements: 5.1, 5.2, 6.1_

- [~] 7. Checkpoint - Ensure backend functions tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement GPT-4o position estimation
  - [x] 8.1 Create estimateSeatingPositions function
    - Accept captureRequestId and array of image blob URLs
    - Generate read SAS URLs for each image
    - Construct GPT system and user prompts
    - _Requirements: 6.1, 6.2_
  
  - [x] 8.2 Call Azure OpenAI GPT-4o vision API
    - Use multi-image analysis with all student photos
    - Set max_tokens: 2000, temperature: 0.3
    - Include 60-second timeout
    - Implement retry logic (1 retry on failure)
    - _Requirements: 6.1_
  
  - [x] 8.3 Parse GPT response and extract positions
    - Extract JSON from response (handle code blocks)
    - Parse positions array with studentId, estimatedRow, estimatedColumn, confidence, reasoning
    - Parse analysisNotes
    - _Requirements: 6.2, 6.3_
  
  - [x] 8.4 Store results in Table Storage
    - Create CaptureResult entity with positions JSON and metadata
    - Store gptModel, gptTokensUsed, analyzedAt
    - _Requirements: 6.3, 8.2_
  
  - [x] 8.5 Handle GPT errors
    - Catch API failures, timeouts, parsing errors
    - Log raw response for debugging
    - Return error status for caller to handle
    - _Requirements: 6.4_
  
  - [ ]* 8.6 Write property tests for position estimation
    - **Property 15: Results Delivery to Teacher**
    - **Property 16: Analysis Failure Notification**
    - **Validates: Requirements 6.3, 6.4**
  
  - [ ]* 8.7 Write unit tests for GPT integration
    - Test prompt construction with multiple images
    - Test JSON response parsing (valid and malformed)
    - Test error handling (API failure, timeout)
    - Mock GPT API for deterministic testing
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 9. Implement get capture results Azure Function
  - [x] 9.1 Create HTTP trigger function for GET /api/sessions/{sessionId}/capture/{captureRequestId}/results
    - Validate teacher authentication and session ownership
    - Query CaptureRequest to get status
    - _Requirements: 8.4_
  
  - [x] 9.2 Return results based on status
    - If status is 'COMPLETED', query and return CaptureResult with positions
    - If status is 'ANALYZING', return 202 (analysis in progress)
    - If status is 'FAILED', return error message
    - If status is 'ACTIVE', return 202 (capture in progress)
    - _Requirements: 6.3, 8.4_
  
  - [ ]* 9.3 Write property test for historical data retrieval
    - **Property 20: Historical Data Retrieval**
    - **Validates: Requirements 8.4**
  
  - [ ]* 9.4 Write unit tests for get results function
    - Test with completed capture (return results)
    - Test with in-progress capture (return 202)
    - Test with failed capture (return error)
    - Test with unauthorized user (403 error)
    - _Requirements: 8.4_

- [x] 10. Implement student capture interface (frontend)
  - [x] 10.1 Create StudentCaptureUI component
    - Add state management for capture flow (isVisible, captureRequestId, sasUrl, expiresAt, photo, uploadStatus)
    - Conditionally render capture button based on isVisible state
    - Add timer display showing countdown from 30 seconds
    - _Requirements: 2.1, 2.2, 2.3, 5.1_
  
  - [x] 10.2 Implement camera access and photo capture
    - Request camera permission using navigator.mediaDevices.getUserMedia()
    - Display camera preview in video element
    - Capture photo to canvas and convert to Blob
    - Show photo preview before upload
    - _Requirements: 2.1_
  
  - [x] 10.3 Implement image validation
    - Validate file size ≤ 1MB before upload
    - If > 1MB, attempt compression using canvas API
    - If still > 1MB after compression, show error message
    - Prevent upload from starting if validation fails
    - _Requirements: 4.1, 4.2, 4.3_
  
  - [x] 10.4 Implement direct blob upload
    - Upload photo to Azure Blob Storage using SAS URL
    - Use PUT request with x-ms-blob-type: BlockBlob header
    - Show upload progress indicator
    - Implement retry logic (1 retry after 2-second delay)
    - _Requirements: 3.1, 3.2_
  
  - [x] 10.5 Notify backend of upload completion
    - Call POST /api/sessions/{sessionId}/capture/{captureRequestId}/upload
    - Include blobName in request body
    - Handle success and error responses
    - _Requirements: 3.3_
  
  - [x] 10.6 Handle upload success and errors
    - On success: hide capture UI, show success message
    - On failure: show error message, allow retry within window
    - On timeout: show "Time expired" message
    - _Requirements: 2.4, 3.4, 5.4_
  
  - [ ]* 10.7 Write property tests for student UI
    - **Property 5: Capture Button Visibility on Request**
    - **Property 6: Capture Button Hidden After Upload**
    - **Property 11: Oversized Image Rejection**
    - **Validates: Requirements 2.1, 2.4, 4.2, 4.3**
  
  - [ ]* 10.8 Write unit tests for student capture component
    - Test button visibility states (hidden, shown, hidden after upload)
    - Test image size validation (pass ≤1MB, fail >1MB)
    - Test compression logic
    - Test upload with mocked fetch
    - Test timer countdown and expiration
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 4.1, 4.2, 4.3_

- [x] 11. Implement SignalR event handling for student
  - [x] 11.1 Add captureRequest event listener
    - Extract captureRequestId, sasUrl, expiresAt, blobName from event
    - Update state to show capture UI
    - Start 30-second countdown timer
    - _Requirements: 2.1, 7.1_
  
  - [x] 11.2 Add captureExpired event listener
    - Hide capture UI
    - Clear state (captureRequestId, sasUrl, photo)
    - Stop countdown timer
    - _Requirements: 2.3, 7.3_
  
  - [ ]* 11.3 Write unit tests for SignalR event handling
    - Test captureRequest event processing
    - Test captureExpired event processing
    - Test state updates on each event
    - _Requirements: 2.1, 2.3, 7.1, 7.3_

- [~] 12. Checkpoint - Ensure student UI tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Implement teacher capture control (frontend)
  - [x] 13.1 Create TeacherCaptureControl component
    - Add state management (status, captureRequestId, expiresAt, uploadedCount, totalCount, results, error)
    - Add "Capture Student Photos" button (enabled when session active and students online)
    - Add status indicator (idle, capturing, analyzing, completed, failed)
    - Add timer display (30-second countdown)
    - Add upload progress display (X/Y students uploaded)
    - _Requirements: 1.1, 5.3_
  
  - [x] 13.2 Implement capture initiation
    - Call POST /api/sessions/{sessionId}/capture/initiate on button click
    - Update state with captureRequestId, expiresAt, totalCount
    - Set status to 'capturing'
    - Start countdown timer
    - _Requirements: 1.1_
  
  - [x] 13.3 Handle initiation errors
    - Show error message for no online students
    - Show error message for API failures
    - Disable button during capture
    - _Requirements: 1.1_
  
  - [ ]* 13.4 Write unit tests for teacher capture control
    - Test button enabled/disabled states
    - Test capture initiation with mocked API
    - Test error handling (no students, API failure)
    - Test timer countdown
    - _Requirements: 1.1_

- [x] 14. Implement SignalR event handling for teacher
  - [x] 14.1 Add uploadComplete event listener
    - Increment uploadedCount in state
    - Update progress display (X/Y students uploaded)
    - _Requirements: 7.2_
  
  - [x] 14.2 Add captureExpired event listener
    - Set status to 'analyzing'
    - Stop countdown timer
    - Show "Analyzing positions..." message
    - _Requirements: 5.3, 7.3_
  
  - [x] 14.3 Add captureResults event listener
    - If status is 'COMPLETED', update state with positions and show results
    - If status is 'FAILED', show error message
    - Set status to 'completed' or 'failed'
    - _Requirements: 6.3, 7.3_
  
  - [ ]* 14.4 Write unit tests for teacher SignalR events
    - Test uploadComplete event (counter increment)
    - Test captureExpired event (status change)
    - Test captureResults event (success and failure)
    - _Requirements: 5.3, 6.3, 7.2, 7.3_

- [x] 15. Implement seating position visualization
  - [x] 15.1 Create SeatingGridVisualization component
    - Accept positions array as prop
    - Calculate grid dimensions based on max row and column
    - Render grid with student positions
    - Show studentId, confidence level, reasoning on hover/click
    - _Requirements: 6.3_
  
  - [x] 15.2 Add visual indicators for confidence levels
    - HIGH confidence: green border
    - MEDIUM confidence: yellow border
    - LOW confidence: red border
    - _Requirements: 6.2_
  
  - [ ]* 15.3 Write unit tests for seating visualization
    - Test grid rendering with various position configurations
    - Test confidence level styling
    - Test empty state (no positions)
    - _Requirements: 6.3_

- [x] 16. Implement comprehensive error handling
  - [x] 16.1 Add camera access error handling (student)
    - Show friendly message when camera permission denied
    - Provide retry button and link to browser help
    - _Requirements: 2.1_
  
  - [x] 16.2 Add upload error handling (student)
    - Implement automatic retry on network failure
    - Show clear error messages for different failure types
    - Keep photo in memory for manual retry within window
    - _Requirements: 3.4_
  
  - [x] 16.3 Add SignalR disconnection handling
    - Implement automatic reconnection (built into SignalR)
    - Show warning message during connection issues
    - Allow upload to continue (doesn't require SignalR)
    - _Requirements: 7.1, 7.2, 7.3_
  
  - [x] 16.4 Add backend error logging
    - Log all errors with timestamp, error type, sessionId, captureRequestId, studentId
    - Use appropriate log levels (ERROR, WARN, INFO, DEBUG)
    - Include stack traces for server errors
    - _Requirements: 6.4_
  
  - [ ]* 16.5 Write unit tests for error handling
    - Test camera permission denied flow
    - Test upload retry logic
    - Test SignalR reconnection
    - Test error logging format
    - _Requirements: 2.1, 3.4, 6.4_

- [~] 17. Checkpoint - Ensure all UI and error handling tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Add session integration
  - [x] 18.1 Integrate capture control into existing TeacherDashboard
    - Add TeacherCaptureControl component to dashboard
    - Position below attendance controls
    - Pass sessionId and online student data as props
    - _Requirements: 8.1_
  
  - [x] 18.2 Integrate capture interface into existing SimpleStudentView
    - Add StudentCaptureUI component to student view
    - Ensure SignalR connection uses existing hub connection
    - Pass sessionId as prop
    - _Requirements: 8.1_
  
  - [x] 18.3 Add capture history to session details
    - Show list of past capture requests with timestamps
    - Allow teacher to view historical results
    - Call GET /api/sessions/{sessionId}/capture/{captureRequestId}/results
    - _Requirements: 8.4_
  
  - [ ]* 18.4 Write property test for session association
    - **Property 19: Session Association**
    - **Validates: Requirements 8.2, 8.3**
  
  - [ ]* 18.5 Write integration tests for session integration
    - Test capture flow within active session
    - Test historical data retrieval
    - Test with multiple sessions
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 19. Wire all components together
  - [x] 19.1 Verify SignalR hub configuration
    - Ensure dashboard{sessionId} hub is used for all events
    - Verify event names match between backend and frontend
    - Test connection establishment and reconnection
    - _Requirements: 7.1, 7.2, 7.3_
  
  - [x] 19.2 Verify environment variables and configuration
    - Check AzureWebJobsStorage connection string
    - Check AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY, AZURE_OPENAI_DEPLOYMENT
    - Check SignalR connection string
    - Add configuration validation on startup
    - _Requirements: 3.1, 6.1, 7.1_
  
  - [x] 19.3 Test end-to-end capture flow
    - Teacher initiates capture → Students receive request → Students upload → Timeout triggers → GPT analyzes → Results delivered
    - Verify all SignalR events fire correctly
    - Verify data flows through all components
    - _Requirements: 1.1, 2.1, 3.1, 5.1, 6.1, 6.3, 7.1, 7.2, 7.3_
  
  - [ ]* 19.4 Write integration tests for complete flow
    - Test complete capture flow with multiple students
    - Test partial upload scenario
    - Test timeout with no uploads
    - Test multiple concurrent captures
    - Test SignalR reconnection during capture
    - _Requirements: 1.1, 2.1, 3.1, 5.1, 6.1, 6.3_

- [~] 20. Final checkpoint - Ensure all integration tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property-based tests use fast-check library with minimum 100 iterations
- All property tests include comment tags: `// Feature: student-image-capture-seating, Property N: [Title]`
- Integration tests use Azurite for local development and real Azure services for CI/CD
- Manual testing checklist covers browser compatibility, accessibility, and performance
- GPT-4o vision API requires Azure OpenAI deployment with vision-enabled model
- SAS URLs are student-specific and time-limited for security
- Direct browser-to-blob upload reduces server load and improves performance
- SignalR uses existing dashboard hub infrastructure for real-time communication
