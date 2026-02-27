# Configuration Validation for Student Image Capture Feature

## Required Environment Variables

The student image capture and seating position estimation feature requires the following environment variables to be configured:

### 1. Azure Blob Storage
- **Variable**: `AzureWebJobsStorage`
- **Purpose**: Used for storing student capture images and generating SAS URLs
- **Used in**:
  - `backend/src/utils/blobStorage.ts` - SAS URL generation and blob verification
  - `backend/src/utils/database.ts` - Table Storage client initialization
  - `backend/src/functions/notifyImageUpload.ts` - Blob URL construction
- **Format**: Azure Storage connection string
- **Example**: `DefaultEndpointsProtocol=https;AccountName=myaccount;AccountKey=...;EndpointSuffix=core.windows.net`

### 2. Azure SignalR Service
- **Variable**: `SIGNALR_CONNECTION_STRING`
- **Purpose**: Real-time communication for capture requests, upload notifications, and results
- **Used in**:
  - `backend/src/utils/signalrBroadcast.ts` - All broadcast functions
  - `backend/src/functions/negotiate*.ts` - SignalR connection negotiation
- **Format**: Azure SignalR connection string
- **Example**: `Endpoint=https://myservice.service.signalr.net;AccessKey=...;Version=1.0;`

### 3. Azure OpenAI Service
- **Variable**: `AZURE_OPENAI_ENDPOINT`
- **Purpose**: Azure OpenAI endpoint for chat/vision APIs used by quiz generation and seating estimation
- **Used in**:
  - `backend/src/utils/gptPositionEstimation.ts` - Position analysis
  - `backend/src/functions/processCaptureTimeoutActivity.ts` - Activity function for timeout processing
- **Format**: Azure OpenAI endpoint URL
- **Example**: `https://myopenai.openai.azure.com/`

- **Variable**: `AZURE_OPENAI_KEY`
- **Purpose**: API key for Azure OpenAI authentication
- **Used in**:
  - `backend/src/utils/gptPositionEstimation.ts` - API authentication
- **Format**: Azure OpenAI API key
- **Example**: `abc123...xyz789`

- **Variable**: `AZURE_OPENAI_DEPLOYMENT`
- **Purpose**: Deployment name for chat model (question generation and default model reference)
- **Used in**:
  - `backend/src/utils/gptPositionEstimation.ts` - API calls
  - `backend/src/functions/processCaptureTimeoutActivity.ts` - Result metadata
- **Format**: Deployment name string
- **Default**: `gpt-5.2-chat`
- **Example**: `gpt-5.2-chat`

- **Variable**: `AZURE_OPENAI_VISION_DEPLOYMENT`
- **Purpose**: Deployment name for vision-capable model used by slide/image analysis
- **Used in**:
  - `backend/src/utils/gptPositionEstimation.ts` - Image-based seating analysis
  - `backend/src/functions/analyzeSlide.ts` - Slide image analysis
- **Format**: Deployment name string
- **Default**: Falls back to `AZURE_OPENAI_DEPLOYMENT` when not set
- **Example**: `gpt-4o-vision`

## Configuration Validation

### Startup Validation
The following functions validate configuration on startup:

1. **Database Operations** (`backend/src/utils/database.ts`):
   - Throws error if `AzureWebJobsStorage` is not configured
   - Validates connection string format

2. **SignalR Operations** (`backend/src/utils/signalrBroadcast.ts`):
   - Logs warning and skips broadcast if `SIGNALR_CONNECTION_STRING` is not configured or contains 'dummy'
   - Gracefully degrades to polling mode on frontend

3. **GPT Operations** (`backend/src/utils/gptPositionEstimation.ts`):
   - Throws error if `AZURE_OPENAI_ENDPOINT` or `AZURE_OPENAI_KEY` is not configured
   - Uses default deployment name if `AZURE_OPENAI_DEPLOYMENT` is not set

### Runtime Validation
Each function validates required environment variables before use:

- **Capture Initiation**: Requires `AzureWebJobsStorage` and `SIGNALR_CONNECTION_STRING`
- **Upload Notification**: Requires `AzureWebJobsStorage` and `SIGNALR_CONNECTION_STRING`
- **Timeout Orchestrator**: Requires `AzureWebJobsStorage` (for durable state)
- **Timeout Processing**: Requires all three services (Storage, SignalR, OpenAI)
- **Position Estimation**: Requires `AZURE_OPENAI_*` variables

## SignalR Hub Configuration

### Hub Naming Convention
- **Pattern**: `dashboard{sessionId}` where sessionId has hyphens removed
- **Example**: Session ID `a1b2c3d4-e5f6-7890-abcd-ef1234567890` → Hub name `dashboarda1b2c3d4e5f678900abcdef1234567890`
- **Implementation**: `backend/src/utils/signalrBroadcast.ts` and `backend/src/functions/negotiateDashboard.ts`

### Event Names
The following SignalR events are used for the capture feature:

1. **captureRequest** (Teacher → Students)
   - Sent when teacher initiates capture
   - Payload: `{ captureRequestId, sasUrl, expiresAt, blobName }`
   - Handler: `frontend/src/components/SimpleStudentView.tsx` line 398

2. **uploadComplete** (Student → Teacher)
   - Sent when student completes upload
   - Payload: `{ captureRequestId, studentId, uploadedAt, uploadedCount, totalCount }`
   - Handler: `frontend/src/components/TeacherDashboard.tsx` line 530

3. **captureExpired** (System → All)
   - Sent when 30-second window expires
   - Payload: `{ captureRequestId, uploadedCount, totalCount }`
   - Handlers:
     - Student: `frontend/src/components/SimpleStudentView.tsx` line 408
     - Teacher: `frontend/src/components/TeacherDashboard.tsx` line 537

4. **captureResults** (System → Teacher)
   - Sent when GPT analysis completes
   - Payload: `{ captureRequestId, status, positions?, analysisNotes?, errorMessage? }`
   - Handler: `frontend/src/components/TeacherDashboard.tsx` line 544

### Event Handler Registration
- **Teacher Dashboard**: Handlers registered in `registerEventHandlers` callback (line 515)
- **Student View**: Handlers registered in `connectSignalR` effect (line 398-412)
- **Handler Cleanup**: Old handlers are deregistered before registering new ones to avoid stale closures

## Local Development Setup

### Using Azurite (Local Storage Emulator)
```bash
# Install Azurite
npm install -g azurite

# Start Azurite
azurite --silent --location ./azurite --debug ./azurite/debug.log

# Use this connection string in local.settings.json
"AzureWebJobsStorage": "AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;DefaultEndpointsProtocol=http;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;"
```

### SignalR Local Development
For local development without Azure SignalR:
- Set `SIGNALR_CONNECTION_STRING` to a dummy value or leave empty
- Frontend will fall back to HTTP polling
- SignalR broadcasts will be skipped with log messages

### Azure OpenAI Local Development
- Requires actual Azure OpenAI service (no local emulator available)
- Use a development deployment with appropriate rate limits
- Consider mocking GPT responses in tests

## Configuration Issues and Troubleshooting

### Issue: "AzureWebJobsStorage not configured"
- **Cause**: Missing or empty `AzureWebJobsStorage` environment variable
- **Solution**: Add connection string to `local.settings.json` or Azure Function App settings

### Issue: "SignalR not configured, skipping broadcast"
- **Cause**: Missing or dummy `SIGNALR_CONNECTION_STRING`
- **Impact**: Real-time updates disabled, frontend falls back to polling
- **Solution**: Add valid SignalR connection string

### Issue: "Azure OpenAI not configured"
- **Cause**: Missing `AZURE_OPENAI_ENDPOINT` or `AZURE_OPENAI_KEY`
- **Impact**: Position estimation will fail
- **Solution**: Add Azure OpenAI credentials

### Issue: "GPT API error: 404"
- **Cause**: Invalid `AZURE_OPENAI_DEPLOYMENT` name
- **Solution**: Verify deployment name matches Azure OpenAI resource

### Issue: SAS URL generation fails
- **Cause**: Invalid storage connection string format
- **Solution**: Verify connection string includes AccountName and AccountKey

## Environment Variable Template Update

The `backend/local.settings.json.template` should be updated to use consistent naming:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "...",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "SIGNALR_CONNECTION_STRING": "...",
    "AZURE_OPENAI_ENDPOINT": "https://your-openai.openai.azure.com/",
    "AZURE_OPENAI_KEY": "your-api-key",
    "AZURE_OPENAI_DEPLOYMENT": "gpt-5.2-chat",
    "AZURE_OPENAI_VISION_DEPLOYMENT": "gpt-4o-vision"
  }
}
```

**Note**: The template currently uses `AOAI_*` prefix, but the code uses `AZURE_OPENAI_*`. This should be corrected for consistency.
