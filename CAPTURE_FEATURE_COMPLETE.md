# Student Image Capture & Seating Feature - Complete Documentation

## Overview
This feature allows teachers to capture photos of all online students simultaneously for attendance verification and seating arrangement analysis using GPT-4o vision.

## Architecture

### Components
1. **Teacher Dashboard** - Initiate capture requests
2. **Student UI** - Capture and upload photos
3. **Backend Functions** - Process and analyze images
4. **Azure Storage** - Store images and results
5. **Azure OpenAI GPT-4o** - Analyze spatial relationships

### Flow
```
Teacher clicks "Capture Student Photos"
  ↓
Backend creates capture request
  ↓
SignalR broadcasts to specific online students
  ↓
Students see camera modal, capture photo
  ↓
Photos uploaded to blob storage with SAS URLs
  ↓
Backend notified of uploads
  ↓
When all uploaded (or timeout), GPT-4o analyzes positions
  ↓
Results stored and displayed to teacher
```

## Key Technical Fixes

### 1. SignalR User-Specific Broadcast (401 Error Fix)
**Problem**: Broadcasting to specific users via REST API returned 401 Unauthorized.

**Root Cause**: JWT token's `aud` claim must exactly match the request URL including `/users/{userId}`.

**Solution**:
```typescript
// backend/src/utils/signalrBroadcast.ts
const encodedUserId = encodeURIComponent(userId);
const signalRUrl = `${endpoint}/api/v1/hubs/${hubName}/users/${encodedUserId}`;

const jwtPayload = {
  aud: signalRUrl,  // Must match exact URL
  iat: now,
  exp: expiry
};
```

**Reference**: [Azure SignalR REST API Docs](https://learn.microsoft.com/azure/azure-signalr/signalr-reference-data-plane-rest-api)

### 2. SignalR Hub Connection for Students
**Problem**: Students connected to wrong hub, couldn't receive capture events.

**Solution**: Created dedicated `studentNegotiate` endpoint that connects students to the dashboard hub with proper JWT audience claim:
```typescript
// backend/src/functions/studentNegotiate.ts
aud: `${endpoint}/client/?hub=${hubName}`
```

### 3. Student ID Display Format
**Problem**: Email addresses displayed in full (e.g., `t-cywong@stu.vtc.edu.hk`).

**Solution**: Created utility to remove domain:
```typescript
// frontend/src/utils/formatStudentId.ts
export function formatStudentId(studentId: string): string {
  return studentId.split('@')[0];
}
```

### 4. Online Student Count
**Problem**: "Capture Student Photos" button always disabled (count was 0).

**Solution**: Calculate from attendance records:
```typescript
const onlineStudentCount = attendance.filter(record => 
  (record as any).isOnline
).length;
```

## Storage Resources

### Tables (in storage.bicep)
- **CaptureRequests** - Track capture sessions
- **CaptureUploads** - Track individual student uploads
- **CaptureResults** - Store GPT analysis results

### Blob Container
- **student-captures** - Store student photos
  - Path: `{sessionId}/{captureRequestId}/{studentId}.jpg`

## API Endpoints

### Teacher Endpoints
- `POST /api/sessions/{sessionId}/capture/initiate` - Start capture
- `GET /api/sessions/{sessionId}/capture/{captureRequestId}/results` - Get results
- `GET /api/sessions/{sessionId}/capture/history` - Get history

### Student Endpoints
- `POST /api/sessions/{sessionId}/student/negotiate` - SignalR connection
- `POST /api/sessions/{sessionId}/capture/{captureRequestId}/upload` - Notify upload

### Background
- **Durable Functions Orchestrator** - Event-driven timeout handling with durable timers
- **Activity Function** - Processes expired captures and triggers GPT analysis

## GPT-4o Position Estimation

### Model Configuration
- **Deployment**: `gpt-5.2-chat` (actually GPT-4o)
- **SKU**: GlobalStandard
- **Capacity**: 250K TPM (1/4 of 1M quota)

### Analysis Process
All student images are sent in a single GPT API call for spatial comparison:
```typescript
// backend/src/utils/gptPositionEstimation.ts
const messages = [{
  role: 'user',
  content: [
    { type: 'text', text: prompt },
    ...studentImages.map(img => ({
      type: 'image_url',
      image_url: { url: img.dataUrl }
    }))
  ]
}];
```

## Testing

### Manual Test Flow
1. Teacher opens dashboard, creates/joins session
2. Student opens student page, joins same session
3. Verify student shows as online (green indicator)
4. Teacher clicks "📸 Capture Student Photos"
5. Student sees camera modal automatically
6. Student captures photo
7. Photo uploads to blob storage
8. Teacher sees upload progress
9. After all uploads (or 30s timeout), GPT analyzes
10. Teacher sees seating grid visualization

### Expected Logs

**Backend (successful broadcast)**:
```
Broadcasting captureRequest to user t-cywong@stu.vtc.edu.hk at: https://signalr-qrattendance-dev.service.signalr.net/api/v1/hubs/dashboard{sessionId}/users/t-cywong%40stu.vtc.edu.hk
Broadcast to user t-cywong@stu.vtc.edu.hk successful
```

**Student Console**:
```
[SignalR] Capture request received: {captureRequestId: "...", sasUrl: "...", expiresAt: ..., blobName: "..."}
[SignalR] Setting capture state: {captureRequestId: "...", hasSasUrl: true, expiresAt: ...}
```

## Deployment

### Quick Deployment Scripts
```bash
# Backend only (faster for backend changes)
./deploy-backend-only.sh

# Frontend only (faster for UI changes)
./deploy-frontend-only.sh

# Full deployment (infrastructure + backend + frontend)
./deploy-full-development.sh
```

### Verification
```bash
# Check deployment status
./verify-capture-deployment.sh

# View backend logs
./capture-backend-logs.sh
```

## Files Modified

### Backend
- `backend/src/functions/initiateImageCapture.ts` - Initiate capture
- `backend/src/functions/studentNegotiate.ts` - Student SignalR connection
- `backend/src/functions/notifyImageUpload.ts` - Handle upload notifications
- `backend/src/functions/captureTimeoutOrchestrator.ts` - Durable orchestrator for timeouts
- `backend/src/functions/processCaptureTimeoutActivity.ts` - Activity function for timeout processing
- `backend/src/functions/getCaptureResults.ts` - Get analysis results
- `backend/src/functions/getCaptureHistory.ts` - Get capture history
- `backend/src/utils/signalrBroadcast.ts` - Fixed user-specific broadcast
- `backend/src/utils/gptPositionEstimation.ts` - GPT analysis
- `backend/src/utils/captureStorage.ts` - Storage operations
- `backend/src/utils/blobStorage.ts` - SAS URL generation

### Frontend
- `frontend/src/components/TeacherDashboard.tsx` - Capture button & history
- `frontend/src/components/SimpleStudentView.tsx` - SignalR connection
- `frontend/src/components/StudentCaptureUI.tsx` - Camera modal
- `frontend/src/components/CaptureHistory.tsx` - History display
- `frontend/src/components/SeatingGridVisualization.tsx` - Results display
- `frontend/src/utils/formatStudentId.ts` - ID formatting utility

### Infrastructure
- `infrastructure/modules/storage.bicep` - Added tables & container
- `infrastructure/modules/openai.bicep` - GPT-5.2-chat deployment

## Known Issues & Limitations

### Current Limitations
1. **Timeout**: 30 seconds for all students to upload
2. **Image Size**: Client-side compression to ~200KB per image
3. **Concurrent Captures**: One capture request per session at a time
4. **GPT Analysis**: Requires at least 2 students for spatial comparison

### Future Enhancements
- Configurable timeout duration
- Retry mechanism for failed uploads
- Real-time progress updates during GPT analysis
- Historical comparison of seating arrangements
- Export seating chart as PDF

## Troubleshooting

### Student doesn't receive capture request
1. Check student is marked as online in Attendance table
2. Verify SignalR connection (green "🟢 Live" indicator)
3. Check browser console for connection errors
4. Verify student's userId matches exactly (case-sensitive)

### 401 Error on broadcast
1. Check `SIGNALR_CONNECTION_STRING` environment variable
2. Verify connection string format: `Endpoint=...;AccessKey=...`
3. Ensure SignalR service is in "Serverless" mode

### GPT analysis fails
1. Check `OPENAI_ENDPOINT` and `OPENAI_API_KEY` are set
2. Verify GPT-5.2-chat deployment exists and has capacity
3. Check image sizes are within limits (max 20MB per request)
4. Review Application Insights for detailed error messages

### Upload fails
1. Check SAS URL is valid and not expired
2. Verify blob container "student-captures" exists
3. Check CORS settings on storage account
4. Ensure student has network connectivity

## Cost Considerations

### Per Capture Request
- **Storage**: ~$0.0001 per capture (images + metadata)
- **SignalR**: ~$0.001 per 1000 messages
- **GPT-4o**: ~$0.01-0.05 per analysis (depends on image count)
- **Function Execution**: ~$0.0001 per capture

### Monthly Estimates (100 students, 20 sessions/month)
- Storage: ~$0.20
- SignalR: ~$2.00
- GPT-4o: ~$10-50 (depends on usage)
- Functions: ~$0.20
- **Total**: ~$12-52/month

## References
- [Azure SignalR Service REST API](https://learn.microsoft.com/azure/azure-signalr/signalr-reference-data-plane-rest-api)
- [Azure OpenAI GPT-4o Vision](https://learn.microsoft.com/azure/ai-services/openai/how-to/gpt-with-vision)
- [Azure Blob Storage SAS](https://learn.microsoft.com/azure/storage/common/storage-sas-overview)
- [MediaDevices API](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
