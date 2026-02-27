# SignalR Event Name Mismatch Fix

## Issue
Students not receiving real-time updates when becoming chain holder. QR code only appears after manual page refresh.

## Root Cause
Event name mismatch between backend broadcasts and frontend listeners:

### Backend (signalrBroadcast.ts)
- Broadcasts: `chainUpdate`
- Broadcasts: `attendanceUpdate`

### Frontend (SimpleStudentView.tsx) - BEFORE FIX
- Listened for: `chainUpdated` ❌
- Listened for: `attendanceUpdated` ❌
- Listened for: `sessionUpdated` ❌

## Fix Applied
Updated `frontend/src/components/SimpleStudentView.tsx` to listen for correct event names:

```typescript
// BEFORE
connection.on('chainUpdated', () => { ... });
connection.on('attendanceUpdated', () => { ... });
connection.on('sessionUpdated', () => { ... });

// AFTER
connection.on('chainUpdate', (update: any) => { ... });
connection.on('attendanceUpdate', (update: any) => { ... });
connection.on('sessionUpdate', (update: any) => { ... });
```

## Impact
- Students now receive real-time updates when they become chain holder
- QR code appears immediately without refresh
- Attendance status updates in real-time
- Consistent with TeacherDashboard.tsx which already used correct event names

## Testing
1. Start a session as teacher
2. Student A scans entry QR
3. Student B scans Student A's QR code
4. Student A should immediately see their holder status change (no refresh needed)
5. Student B should immediately see QR code appear

## Deployment
Frontend needs to be redeployed:

```bash
cd frontend
npm install
npm run build
# Deploy to Static Web App
```

Or use:
```bash
./deploy-frontend-only.sh dev
```
