# Database Tables - QR Chain Attendance System

**Date**: February 25, 2026  
**Storage**: Azure Table Storage

## Required Tables (12 Total)

### 1. Sessions
**Purpose**: Store active attendance sessions

**Schema**:
```
PartitionKey: "SESSION"
RowKey: sessionId (UUID)
Fields:
  - classId: string
  - teacherId: string (email)
  - startAt: timestamp
  - status: "ACTIVE" | "ENDED"
  - createdAt: timestamp
```

### 2. Attendance
**Purpose**: Track student attendance records

**Schema**:
```
PartitionKey: sessionId
RowKey: studentId (email)
Fields:
  - entryStatus: "PRESENT_ENTRY" | "LATE_ENTRY" [optional]
  - entryMethod: "DIRECT_QR" | "CHAIN" [optional]
  - entryAt: number (Unix seconds) [optional]
  - exitVerified: boolean
  - exitMethod: "DIRECT_QR" | "CHAIN" [optional]
  - exitedAt: number (Unix seconds) [optional]
  - earlyLeaveAt: number (Unix seconds) [optional]
  - finalStatus: string [optional]
  - joinedAt: number (Unix seconds)
  - isOnline: boolean
  - lastSeen: number (Unix seconds)
  - locationWarning: string [optional]
  - locationDistance: number [optional]
  - scanLocation: string (JSON) [optional]
  - Timestamp: Azure auto-generated
```

**Entry/Exit Methods**:
- **Entry Chain**: Sets `entryMethod: 'CHAIN'`, `entryStatus`, `entryAt`
- **Entry QR**: Currently not implemented (students join but entry marked via chains)
- **Exit Chain**: Sets `exitMethod: 'CHAIN'`, `exitVerified: true`, `exitedAt`
- **Exit QR**: Sets `exitMethod: 'DIRECT_QR'`, `exitVerified: true`, `exitedAt`

### 3. Chains
**Purpose**: Store QR code chain data for entry/exit/snapshot tracking

**Schema**:
```
PartitionKey: sessionId
RowKey: chainId (UUID)
Fields:
  - phase: "ENTRY" | "EXIT" | "SNAPSHOT"
  - state: "ACTIVE" | "STALLED" | "COMPLETED"
  - index: number (chain index within phase)
  - lastHolder: string (email of current holder)
  - lastSeq: number (sequence number of last transfer)
  - lastAt: number (Unix seconds of last activity)
  - createdAt: number (Unix seconds)
  - completedAt: number (Unix seconds) [optional]
  - snapshotId: string (UUID) [optional - for SNAPSHOT phase]
  - snapshotIndex: number [optional - for SNAPSHOT phase]
```

### 4. Tokens
**Purpose**: Store chain tokens for QR code validation

**Schema**:
```
PartitionKey: sessionId
RowKey: tokenId (UUID)
Fields:
  - chainId: string (UUID)
  - holderId: string (email of current holder)
  - seq: number (sequence number in chain)
  - expiresAt: number (Unix seconds, default 10s TTL)
  - createdAt: number (Unix seconds)
  - snapshotId: string (UUID) [optional - for SNAPSHOT tokens]
```

**Token Lifecycle**:
- Created when chain is seeded or passed
- Expires after 10 seconds (configurable via CHAIN_TOKEN_TTL_SECONDS)
- Deleted when scanned or chain closed
- Auto-cleanup on session end

### 5. UserSessions
**Purpose**: Map users to their active sessions

**Schema**:
```
PartitionKey: userId (email)
RowKey: sessionId
Fields:
  - role: "teacher" | "student"
  - joinedAt: number (Unix seconds)
  - status: "active" | "ended"
```

### 6. AttendanceSnapshots
**Purpose**: Store metadata for on-demand attendance snapshots

**Schema**:
```
PartitionKey: sessionId
RowKey: snapshotId (UUID)
Fields:
  - snapshotIndex: number (1, 2, 3...)
  - capturedAt: number (Unix seconds)
  - totalStudents: number (online students at time of snapshot)
  - chainsCreated: number (number of chains started)
  - status: "ACTIVE" | "COMPLETED"
  - presentCount: number [optional - calculated after chains complete]
```

### 7. ChainHistory
**Purpose**: Track chain transfer history for audit and analysis

**Schema**:
```
PartitionKey: chainId
RowKey: {seq}_{timestamp} (sortable)
Fields:
  - sessionId: string
  - chainId: string (UUID)
  - sequence: number
  - fromHolder: string (email)
  - toHolder: string (email)
  - scannedAt: number (Unix seconds)
  - phase: "ENTRY" | "EXIT" | "SNAPSHOT"
```

### 8. ScanLogs
**Purpose**: Audit log for all QR code scans

**Schema**:
```
PartitionKey: sessionId
RowKey: {timestamp}_{scanId}
Fields:
  - studentId: string (email)
  - scanType: string
  - success: boolean
  - timestamp: number (Unix seconds)
  - metadata: string (JSON)
```

### 9. DeletionLog
**Purpose**: Audit trail for deleted sessions

**Schema**:
```
PartitionKey: "DELETION"
RowKey: {timestamp}_{sessionId}
Fields:
  - sessionId: string
  - deletedBy: string (email)
  - deletedAt: number (Unix seconds)
  - reason: string
  - metadata: string (JSON)
```

## Removed Tables

### ~~QRTokens~~ (NOT USED)

**Reason**: Switched to encryption-based approach. Tokens are now encrypted/decrypted in-memory without database storage.

**Previous Schema** (for reference):
```
PartitionKey: sessionId
RowKey: "entry-{token}" or "exit-{token}"
Fields:
  - type: "ENTRY" | "EXIT"
  - token: 64-char hex string
  - sessionId: string
  - createdAt: timestamp
  - expiresAt: timestamp
  - isActive: boolean
```

**Why Removed**:
- ❌ Database overhead for every QR generation
- ❌ Need to clean up expired tokens
- ❌ Additional storage costs
- ✅ Encryption is faster (CPU-only)
- ✅ No cleanup needed (auto-expire)
- ✅ Simpler architecture

## Table Initialization

### Local Development (Azurite)

```bash
# Start Azurite
azurite --silent --location ./azurite --debug ./azurite/debug.log

# Initialize tables
./scripts/init-tables.sh
```

### Azure Production

```bash
# Option 1: Using script
./scripts/init-tables.sh rg-qr-attendance-dev stqrattendancedev

# Option 2: Using Azure CLI directly
az storage table create --name Sessions \
  --connection-string "<connection-string>"
# Repeat for each table
```

## Table Usage

### Sessions Table
- Created when teacher starts a session
- Updated when session ends
- Queried to list active sessions

### Attendance Table
- Created when student joins session (with `joinedAt`)
- Updated when student exits (with `exitedAt`, `exitVerified`)
- Queried for attendance reports
- Exported to CSV

### Chains Table
- Created for entry/exit QR chains
- Updated every rotation (configurable seconds)
- Used for chain validation

### Tokens Table
- Created for session tokens
- Used for chain token validation
- Cleaned up when session ends

### UserSessions Table
- Created when user joins session
- Used to track active sessions per user
- Cleaned up when session ends

## Storage Costs

**Estimated costs** (Azure Table Storage):
- Storage: $0.045 per GB/month
- Transactions: $0.00036 per 10,000 transactions

**Typical usage** (100 students, 10 sessions/day):
- Storage: < 1 GB/month
- Transactions: ~50,000/day
- **Monthly cost**: < $1

## Performance

### Read Operations
- Get session: ~10ms
- Get attendance: ~10ms
- List sessions: ~50ms

### Write Operations
- Create session: ~20ms
- Update attendance: ~20ms
- Batch operations: ~50ms

### No Database for QR Tokens
- Token generation: ~1ms (encryption only)
- Token validation: ~1ms (decryption only)
- **Zero database overhead**

## Backup and Recovery

### Backup Strategy
```bash
# Export tables to JSON
az storage table export \
  --name Sessions \
  --connection-string "<connection-string>" \
  --output-file sessions-backup.json
```

### Recovery
```bash
# Import from JSON
az storage table import \
  --name Sessions \
  --connection-string "<connection-string>" \
  --input-file sessions-backup.json
```

## Monitoring

### Check Table Sizes
```bash
az storage table list \
  --connection-string "<connection-string>" \
  --query "[].{name:name}" -o table
```

### Query Table Data
```bash
# List all sessions
az storage entity query \
  --table-name Sessions \
  --connection-string "<connection-string>"

# List attendance for a session
az storage entity query \
  --table-name Attendance \
  --filter "PartitionKey eq 'session-id'" \
  --connection-string "<connection-string>"
```

## Migration Notes

### Timestamp Standardization (February 2026)

**All timestamps now use Unix seconds (10 digits)**:
- Changed from milliseconds to seconds throughout backend
- Frontend converts to milliseconds when needed: `timestamp * 1000`
- Consistent across all tables and functions

**Fields affected**:
- All `*At` fields (createdAt, entryAt, exitedAt, etc.)
- All `expiresAt` fields
- All `lastSeen`, `lastAt` fields

### Entry/Exit Methods (February 2026)

**Added method tracking**:
- `entryMethod`: "DIRECT_QR" or "CHAIN"
- `exitMethod`: "DIRECT_QR" or "CHAIN"
- Allows distinguishing how attendance was verified
- Old records without these fields show "—" in UI

### Snapshot Simplification (February 2026)

**Simplified snapshot system**:
- Removed complex snapshot types (ENTRY/EXIT)
- Now just "SNAPSHOT" phase for on-demand attendance
- Snapshots create chains to record who's present at a moment
- No trace viewing or comparison features (removed)

### From QRTokens to Encryption

**No migration needed**:
- QRTokens table was never used in production
- Encryption-based approach is backward compatible
- Existing sessions continue to work
- No data loss

**If QRTokens table exists**:
```bash
# Optional: Delete unused table
az storage table delete \
  --name QRTokens \
  --connection-string "<connection-string>"
```

## Summary

✅ **12 tables required** (Sessions, Attendance, Chains, Tokens, UserSessions, AttendanceSnapshots, ChainHistory, ScanLogs, DeletionLog, QuizQuestions, QuizResponses, QuizMetrics)  
❌ **QRTokens NOT needed** (encryption-based approach)  
✅ **Simple schema** (easy to understand and maintain)  
✅ **Low cost** (< $1/month for typical usage)  
✅ **Fast performance** (< 50ms for most operations)  
✅ **Timestamps in seconds** (consistent across all tables)  
✅ **Method tracking** (entry/exit via CHAIN or DIRECT_QR)  
✅ **Quiz support** (3 tables for Live Quiz feature)

### 10. QuizQuestions
**Purpose**: Store AI-generated quiz questions

**Schema**:
```
PartitionKey: sessionId
RowKey: questionId (UUID)
Fields:
  - slideImageUrl: string (blob URL)
  - slideContent: string (JSON - analysis from GPT-4o Vision)
  - question: string
  - questionType: "MULTIPLE_CHOICE" | "SHORT_ANSWER"
  - options: string (JSON array for multiple choice)
  - correctAnswer: string
  - difficulty: "EASY" | "MEDIUM" | "HARD"
  - timeLimit: number (seconds, default 60)
  - createdAt: number (Unix seconds)
```

### 11. QuizResponses
**Purpose**: Track student quiz answers and evaluation

**Schema**:
```
PartitionKey: sessionId
RowKey: responseId (UUID)
Fields:
  - questionId: string (UUID)
  - studentId: string (email)
  - answer: string
  - isCorrect: boolean
  - score: number (0-100)
  - responseTime: number (seconds)
  - submittedAt: number (Unix seconds)
  - sentAt: number (Unix seconds)
  - expiresAt: number (Unix seconds)
  - status: "PENDING" | "ANSWERED" | "EXPIRED"
  - aiEvaluation: string (feedback from GPT-4o)
```

### 12. QuizMetrics
**Purpose**: Track student quiz performance and engagement

**Schema**:
```
PartitionKey: sessionId
RowKey: studentId (email)
Fields:
  - totalQuestions: number
  - correctAnswers: number
  - questionCount: number
  - averageResponseTime: number (seconds)
  - engagementScore: number (0-100)
  - lastQuestionAt: number (Unix seconds)
```

**Engagement Score Calculation**:
- Accuracy: 50% weight (correctAnswers / totalQuestions)
- Speed: 30% weight (1 - responseTime / timeLimit)
- Participation: 20% weight (min(totalQuestions * 4, 20))

---

**Next Step**: Run `./scripts/init-tables.sh` to create all required tables
