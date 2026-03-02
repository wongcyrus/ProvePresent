# Getting Started

Quick guide to get the QR Chain Attendance System running locally.

## Prerequisites

- **Node.js 20+**: [Download](https://nodejs.org/)
- **Azure Functions Core Tools**: `npm install -g azure-functions-core-tools@4`
- **Azurite**: For local storage emulation
- **Git**: For version control

## Installation

### 1. Clone and Install

```bash
# Clone the repository
git clone <repository-url>
cd QRChainAttend

# Install all dependencies
npm run install:all
```

This installs dependencies for:
- Root workspace
- Frontend (Next.js)
- Backend (Azure Functions)

### 2. Start Azurite (Local Storage)

```bash
# In a separate terminal
npx azurite --silent --location azurite --debug azurite/debug.log
```

Or use the dev tools script:
```bash
./dev-tools.sh
# Select option 1: Start Azurite
```

### 3. Initialize Local Database

```bash
./scripts/init-tables.sh
```

This creates the required tables:
- Sessions
- Attendance
- Chains
- Tokens
- UserSessions
- AttendanceSnapshots
- ChainHistory
- ScanLogs
- DeletionLog

### 4. Start Development Servers

**Terminal 1 - Backend:**
```bash
cd backend
npm start
```
Backend runs on: http://localhost:7071

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```
Frontend runs on: http://localhost:3000

## First Use

1. Visit http://localhost:3000
2. Click "Login" (uses mock authentication in local dev)
3. Choose a role:
   - Teacher: Use `teacher@vtc.edu.hk` email
   - Student: Use `student@stu.vtc.edu.hk` email

## Configuration

### Frontend (`frontend/.env.local`)
```bash
NEXT_PUBLIC_API_URL=http://localhost:7071/api
NEXT_PUBLIC_ENVIRONMENT=local
```

### Backend (`backend/local.settings.json`)
```json
{
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "SIGNALR_CONNECTION_STRING": "dummy",
    "CHAIN_TOKEN_TTL_SECONDS": "10",
    "QR_ENCRYPTION_KEY": "your-32-byte-hex-key"
  }
}
```

**Note**: Token TTL is 10 seconds (not 20) for faster chain rotation.

## Testing the Flow

### As a Teacher

1. Login with `teacher@vtc.edu.hk`
2. Go to Teacher Dashboard
3. Click "Create New Session"
3. Fill in session details:
   - Class ID (e.g., "CS101")
   - Start/end times
   - Late cutoff minutes (default: 15)
   - Geofence radius (default: 1000 meters)
   - Optional: Enable geofence enforcement
   - Optional: Enable recurring sessions
5. Click "Create Session"
6. View session in dashboard
7. Click "Show Entry QR" to generate entry QR code
8. Students can scan this QR code to join

### As a Student

1. Login with `student@stu.vtc.edu.hk` (use different browser/incognito)
2. Go to Student View
3. Scan teacher's session QR code (or navigate to URL manually)
4. View session information and attendance status
5. When you become a chain holder, your QR code will display
6. Other students can scan your QR code to pass the chain

### Testing Recurring Sessions

1. Create a session with recurring enabled
2. Select pattern (DAILY, WEEKLY, MONTHLY)
3. Set recurrence end date
4. View estimated session count
5. After creation, see all generated sessions in list
6. Edit one session and choose scope (this, future, all)
7. Delete one session and choose scope

### Testing Geolocation

1. Create a session with geofence enabled
2. Click "Use Current Location" to set coordinates
3. Set radius (default: 1000 meters)
4. Toggle "Enforce Geofence" for strict mode
5. Students outside radius will see warning or be blocked
6. View location warnings in teacher dashboard

### Testing Snapshots

1. Open a session dashboard
2. Scroll to "Instant Attendance Snapshots" section
3. Set number of chains (1-20)
4. Click "Take Snapshot Now"
5. View snapshot in history list
6. See: timestamp, chains started, students online, status
7. Snapshots record who's present at that moment via chains

## Common Issues

### Backend won't start
- **Check**: Is Azurite running?
- **Fix**: Start Azurite first

### Frontend can't connect to backend
- **Check**: Is backend running on port 7071?
- **Fix**: Restart backend with `npm start`

### Tables don't exist
- **Fix**: Run `./scripts/init-tables.sh` or `./dev-tools.sh reset-db`

### Port already in use
- **Frontend**: Change port in `package.json` dev script
- **Backend**: Change port in `backend/local.settings.json`

### QR codes not generating
- **Check**: Is QR_ENCRYPTION_KEY set in local.settings.json?
- **Fix**: Generate a key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### Geolocation not working
- **Check**: Browser permissions for location
- **Fix**: Allow location access in browser settings
- **Note**: HTTPS required in production (localhost works)

### SignalR not connecting
- **Check**: Is SIGNALR_CONNECTION_STRING set?
- **Fix**: Use "dummy" for local development

## Next Steps

- [QR Chain Flow](QR_CHAIN_FLOW.md) - Understand how the system works
- [Geolocation Feature](GEOLOCATION_FEATURE.md) - Learn about location tracking
- [Snapshot Deployment](SNAPSHOT_DEPLOYMENT.md) - Understand snapshots
- [Test Flow](TEST_FLOW.md) - Testing guide
- [Deployment Guide](DEPLOYMENT_GUIDE.md) - Deploy to Azure
- [Quick Reference](QUICK_REFERENCE.md) - Common commands

## Development Tools

Use the dev tools script for common tasks:
```bash
./dev-tools.sh
```

Options:
1. Start Azurite
2. Stop Azurite
3. Reset local database
4. View logs
5. Run tests

## Useful Commands

```bash
# Reset local database
./dev-tools.sh reset-db

# View backend logs
cd backend && npm start

# Run tests
npm test

# Lint code
npm run lint

# Build for production
npm run build
```

## Feature Testing Checklist

### Authentication
- [ ] Login with teacher email
- [ ] Login with student email
- [ ] Logout
- [ ] Switch account
- [ ] Verify role assignment

### Session Management
- [ ] Create single session
- [ ] Create recurring session
- [ ] Edit session
- [ ] Delete session
- [ ] View session list

### Geolocation
- [ ] Enable geofence
- [ ] Use current location
- [ ] Test warning mode
- [ ] Test enforce mode
- [ ] View location warnings

### QR Codes
- [ ] Generate entry QR
- [ ] Generate exit QR
- [ ] Auto-refresh QR codes
- [ ] Scan QR with phone camera

### Attendance
- [ ] Join session
- [ ] Seed entry chains
- [ ] Scan chain QR codes
- [ ] Mark exit
- [ ] View attendance status

### Snapshots
- [ ] Create snapshot
- [ ] View chain trace
- [ ] Compare snapshots
- [ ] Add notes to snapshot

### Export
- [ ] Export as CSV
- [ ] Export as JSON
- [ ] Verify data completeness

### Real-time Updates
- [ ] Teacher dashboard updates
- [ ] Student view updates
- [ ] Online/offline status
- [ ] Chain holder updates

---

**Need help?** Check the [docs/](docs/) folder for detailed documentation or see [DOCS_INDEX.md](DOCS_INDEX.md) for complete documentation index.
