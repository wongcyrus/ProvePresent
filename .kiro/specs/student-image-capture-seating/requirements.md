# Requirements Document

## Introduction

This feature enables teachers to capture student photos during online sessions and estimate their seating positions using AI analysis. Teachers can trigger photo capture requests at any time during a session, and students upload photos directly to Azure Blob Storage within a time limit. The system uses GPT to analyze the collected images and estimate student seating positions based on projector visibility in the background.

## Glossary

- **Teacher**: The user who manages the session and initiates photo capture requests
- **Student**: The online participant who responds to photo capture requests
- **Capture_Request**: A teacher-initiated event that prompts students to take and upload photos
- **Image_Capture_System**: The system component that manages photo capture workflow
- **Upload_Service**: The system component that handles direct uploads to Azure Blob Storage
- **Position_Estimator**: The system component that uses GPT to analyze images and estimate seating positions
- **SAS_URL**: Shared Access Signature URL that provides temporary, secure access to Azure Blob Storage
- **Session**: An existing attendance session in the QR chain attendance system
- **Capture_Window**: The 30-second time period during which students can upload photos

## Requirements

### Requirement 1: Teacher-Initiated Photo Capture

**User Story:** As a teacher, I want to request all online students to take a photo during a session, so that I can collect visual attendance data and estimate seating positions.

#### Acceptance Criteria

1. WHEN a Teacher initiates a Capture_Request, THE Image_Capture_System SHALL broadcast the request to all online Students in the Session
2. WHEN a Capture_Request is initiated, THE Image_Capture_System SHALL start a 30-second Capture_Window timer
3. THE Image_Capture_System SHALL allow multiple Capture_Requests within a single Session
4. WHEN a Capture_Request is broadcast, THE Image_Capture_System SHALL generate unique SAS_URLs for each Student

### Requirement 2: Student Photo Upload Interface

**User Story:** As a student, I want to see a capture button only when the teacher requests a photo, so that I can respond to capture requests without distraction.

#### Acceptance Criteria

1. WHEN a Capture_Request is received, THE Image_Capture_System SHALL display the capture button to the Student
2. WHILE no Capture_Request is active, THE Image_Capture_System SHALL hide the capture button from the Student
3. WHEN the Capture_Window expires, THE Image_Capture_System SHALL hide the capture button from the Student
4. WHEN a Student completes an upload, THE Image_Capture_System SHALL hide the capture button from that Student

### Requirement 3: Direct Blob Storage Upload

**User Story:** As a student, I want to upload my photo directly to storage from my browser, so that the upload is fast and doesn't require server processing.

#### Acceptance Criteria

1. WHEN a Student captures a photo, THE Upload_Service SHALL upload the image directly to Azure Blob Storage using the provided SAS_URL
2. THE Upload_Service SHALL perform all upload operations within the web browser without server intermediation
3. WHEN an upload completes successfully, THE Upload_Service SHALL notify the Image_Capture_System of completion
4. IF an upload fails, THEN THE Upload_Service SHALL notify the Student with an error message

### Requirement 4: Image Size Validation

**User Story:** As a system administrator, I want to limit image sizes to 1MB, so that storage costs remain manageable and uploads complete quickly.

#### Acceptance Criteria

1. WHEN a Student selects an image, THE Upload_Service SHALL validate that the file size does not exceed 1MB
2. IF an image exceeds 1MB, THEN THE Upload_Service SHALL display an error message to the Student
3. IF an image exceeds 1MB, THEN THE Upload_Service SHALL prevent the upload from starting

### Requirement 5: Capture Time Limit

**User Story:** As a teacher, I want students to have a 30-second time limit to upload photos, so that the capture process completes in a reasonable timeframe.

#### Acceptance Criteria

1. WHEN a Capture_Request is initiated, THE Image_Capture_System SHALL enforce a 30-second Capture_Window
2. WHEN the Capture_Window expires, THE Image_Capture_System SHALL stop accepting uploads for that Capture_Request
3. WHEN the Capture_Window expires, THE Image_Capture_System SHALL notify the Teacher of completion status
4. IF a Student attempts to upload after the Capture_Window expires, THEN THE Upload_Service SHALL reject the upload with a timeout message

### Requirement 6: Seating Position Estimation

**User Story:** As a teacher, I want the system to estimate student seating positions from their photos, so that I can understand the physical classroom layout.

#### Acceptance Criteria

1. WHEN all uploads for a Capture_Request are complete or the Capture_Window expires, THE Position_Estimator SHALL analyze the collected images using GPT
2. THE Position_Estimator SHALL use projector visibility in image backgrounds to estimate relative seating positions
3. WHEN position estimation completes, THE Position_Estimator SHALL provide the results to the Teacher
4. IF GPT analysis fails, THEN THE Position_Estimator SHALL notify the Teacher with an error message

### Requirement 7: Real-Time Communication

**User Story:** As a student, I want to receive capture requests immediately, so that I have the full time window to respond.

#### Acceptance Criteria

1. WHEN a Teacher initiates a Capture_Request, THE Image_Capture_System SHALL use SignalR to broadcast the request in real-time
2. WHEN a Student uploads a photo, THE Image_Capture_System SHALL use SignalR to notify the Teacher in real-time
3. WHEN the Capture_Window expires, THE Image_Capture_System SHALL use SignalR to notify all participants in real-time

### Requirement 8: Session Integration

**User Story:** As a teacher, I want photo capture to integrate with existing sessions, so that I can use it within my current workflow.

#### Acceptance Criteria

1. THE Image_Capture_System SHALL integrate with the existing Session management system
2. WHEN a Capture_Request is initiated, THE Image_Capture_System SHALL associate captured images with the current Session
3. THE Image_Capture_System SHALL store Capture_Request metadata with the Session record
4. THE Image_Capture_System SHALL allow access to historical capture data for completed Sessions

### Requirement 9: SAS URL Security

**User Story:** As a system administrator, I want SAS URLs to be temporary and student-specific, so that storage access remains secure.

#### Acceptance Criteria

1. WHEN generating SAS_URLs, THE Upload_Service SHALL create unique URLs for each Student
2. THE Upload_Service SHALL configure SAS_URLs to expire after the Capture_Window plus a 60-second grace period
3. THE Upload_Service SHALL configure SAS_URLs with write-only permissions
4. THE Upload_Service SHALL configure SAS_URLs to allow only a single blob upload per URL
