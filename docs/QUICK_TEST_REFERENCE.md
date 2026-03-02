# Quick Test Reference - Student Image Capture

## URLs
- **Frontend**: https://wonderful-tree-08b1a860f.1.azurestaticapps.net
- **Teacher**: https://wonderful-tree-08b1a860f.1.azurestaticapps.net/teacher
- **Student**: https://wonderful-tree-08b1a860f.1.azurestaticapps.net/student

## Test Sequence

### Setup (2 minutes)
1. **Teacher**: Login → Create/Open Session
2. **Student**: Login → Join Session
3. **Teacher**: Verify "🟢 Online Now" shows count ≥ 1

### Capture Flow (1 minute)
4. **Teacher**: Click "📸 Capture Student Photos (X online)"
5. **Student**: StudentCaptureUI appears automatically (within 2 seconds)
6. **Student**: Take Photo → Capture → Upload
7. **Student**: See "Photo uploaded successfully!" message

### Verify Results (1 minute)
8. **Teacher**: Navigate to "Capture History" section
9. **Teacher**: View most recent capture (status: ACTIVE → PROCESSING → COMPLETED)
10. **Teacher**: View seating grid with student positions

## Expected Behaviors

### Teacher Side
- ✅ Button enabled when students online
- ✅ Success message: "Capture request sent to X students"
- ✅ Capture appears in history immediately
- ✅ Upload count updates in real-time

### Student Side
- ✅ UI appears within 2 seconds of teacher click
- ✅ 30-second countdown timer visible
- ✅ Camera permission requested (first time)
- ✅ Photo preview before upload
- ✅ Success message after upload

## Troubleshooting

### Button Disabled?
→ Check student is online (joined session)

### Student No UI?
→ Check browser console for SignalR errors

### Upload Failed?
→ Check if 30 seconds expired

### No Results?
→ Wait 30-60 seconds for GPT processing

## Browser Console Checks

### Student Console Should Show:
```
SignalR connected for capture events
Capture request received: {captureRequestId, sasUrl, ...}
```

### Teacher Console Should Show:
```
Capture request initiated successfully
```

## Quick Verification
```bash
./verify-capture-deployment.sh
```

## Quick Redeploy
```bash
# Backend only (1-2 min)
./deploy-backend-only.sh

# Frontend only (2-3 min)
./deploy-frontend-only.sh
```

## Success Indicators
- ✅ Teacher sees success message
- ✅ Student UI appears automatically
- ✅ Photo uploads successfully
- ✅ Capture appears in history
- ✅ Seating grid shows positions

## Timing Expectations
- Capture initiation: <2 sec
- SignalR broadcast: <1 sec
- Student UI render: <2 sec
- Photo upload: <5 sec
- GPT analysis: 30-60 sec

## Common Issues

| Issue | Solution |
|-------|----------|
| Button disabled | Student must join session |
| No UI on student | Check SignalR connection |
| Upload fails | Capture within 30 seconds |
| No results | Wait for GPT processing |

## Full Documentation
See `CAPTURE_FEATURE_COMPLETE.md` for comprehensive documentation including:
- Architecture overview
- Technical fixes and solutions
- API endpoints
- GPT-4o integration
- Troubleshooting guide
- Cost considerations

