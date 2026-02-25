# Database Management Guide

## Local Development Database

### Using Azurite (Local Storage Emulator)

Local development uses **Azurite** to emulate Azure Storage locally.

**Configuration:**
- Connection string in `backend/local.settings.json`
- Points to `127.0.0.1:10002` (Table Storage)
- No internet connection required

**Start Azurite:**
```bash
npx azurite --silent --location azurite --debug azurite/debug.log
```

**Reset Local Database:**
```bash
./dev-tools.sh reset-db
```

⚠️ **Important**: This command is **LOCAL ONLY** - it only resets Azurite, not production Azure.

This script:
1. Stops Azurite
2. Deletes the `azurite` folder (or `/workspace` directory)
3. Restarts Azurite
4. Recreates all tables

**What it affects**:
- ✅ Local Azurite emulator only
- ✅ Data in `/workspace/` directory
- ❌ Does NOT affect production Azure

**When to use**:
- Testing with fresh database
- Clearing test data
- Fixing corrupted local data
- Starting clean for development

**Tables Created:**

All table names are defined in `scripts/tables-config.sh` (single source of truth):
- Sessions
- Attendance
- Chains
- Tokens
- UserSessions
- AttendanceSnapshots
- ChainHistory
- ScanLogs
- DeletionLog

---

## Production Database

### Using Azure Table Storage

Production uses **Azure Table Storage** in the cloud.

**Configuration:**
- Storage Account: `stqrattendancedev`
- Resource Group: `rg-qr-attendance-dev`
- Connection string stored in Azure Function App settings

**Reset Production Database:**
```bash
./scripts/reset-production-db.sh
```

⚠️ **DANGER**: This deletes ALL production data and requires confirmation.

**What it does**:
- Connects to Azure Storage Account
- Deletes all tables
- Recreates empty tables
- **ALL PRODUCTION DATA IS LOST**

**When to use** (RARE):
- Initial production setup
- Clearing old test data from production
- Emergency data corruption fix
- **NEVER during active use**

**Safety checklist before running**:
- [ ] Backup any important data
- [ ] Notify all users
- [ ] Confirm no active sessions
- [ ] Have rollback plan ready
- [ ] Document why you're doing this

⚠️ **WARNING:** This will delete ALL production data!

This script:
1. Asks for confirmation
2. Deletes all tables
3. Recreates all tables
4. Shows the list of tables

**Tables Created:**

All table names are defined in `scripts/tables-config.sh` (single source of truth):
- Sessions
- Attendance
- Chains
- Tokens
- UserSessions
- AttendanceSnapshots
- ChainHistory
- ScanLogs
- DeletionLog

---

## Verify Configuration

Check that local development is properly configured:

```bash
./scripts/verify-local-dev.sh
```

This checks:
- Frontend environment variables
- Backend storage configuration
- Azurite running status
- Backend running status
- Frontend running status

---

## Configuration Summary

### Local Development
| Service | Endpoint |
|---------|----------|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:7071/api |
| Storage | Azurite (127.0.0.1:10002) |
| SignalR | Disabled (polling fallback) |
| Authentication | Mock login |

### Production
| Service | Endpoint |
|---------|----------|
| Frontend | https://red-grass-0f8bc910f.4.azurestaticapps.net |
| Backend API | https://func-qrattendance-dev.azurewebsites.net/api |
| Storage | stqrattendancedev (Azure) |
| SignalR | signalr-qrattendance-dev (Azure) |
| Authentication | Azure AD (VTC ADFS) |

---

## Common Tasks

### View Production Tables
```bash
az storage table list \
  --account-name stqrattendancedev \
  --query "[].name" \
  --output table
```

### Query Production Data
```bash
# List all sessions
az storage entity query \
  --account-name stqrattendancedev \
  --table-name Sessions \
  --filter "PartitionKey eq 'SESSION'" \
  --output table

# List attendance for a session
az storage entity query \
  --account-name stqrattendancedev \
  --table-name Attendance \
  --filter "PartitionKey eq 'SESSION_ID_HERE'" \
  --output table
```

### Delete Specific Session
```bash
SESSION_ID="your-session-id"

# Delete session
az storage entity delete \
  --account-name stqrattendancedev \
  --table-name Sessions \
  --partition-key "SESSION" \
  --row-key "$SESSION_ID"

# Delete attendance records
az storage entity query \
  --account-name stqrattendancedev \
  --table-name Attendance \
  --filter "PartitionKey eq '$SESSION_ID'" \
  --select PartitionKey,RowKey \
  --output json | \
  jq -r '.items[] | "\(.PartitionKey) \(.RowKey)"' | \
  while read pk rk; do
    az storage entity delete \
      --account-name stqrattendancedev \
      --table-name Attendance \
      --partition-key "$pk" \
      --row-key "$rk"
  done
```

---

## Troubleshooting

### Local Development Issues

**Problem:** Backend can't connect to storage
- **Solution:** Make sure Azurite is running on port 10002
- **Check:** `lsof -i :10002`
- **Start:** `npx azurite --silent --location azurite --debug azurite/debug.log`

**Problem:** Frontend calls production API
- **Solution:** Check `frontend/.env.local` has `NEXT_PUBLIC_API_URL=http://localhost:7071/api`
- **Solution:** Check `NEXT_PUBLIC_ENVIRONMENT=local`

**Problem:** Tables don't exist
- **Solution:** Run `./dev-tools.sh reset-db` or `./scripts/init-tables.sh`

### Production Issues

**Problem:** Can't access production database
- **Solution:** Make sure you're logged in to Azure CLI: `az login`
- **Solution:** Check you have access to the resource group

**Problem:** Tables are corrupted
- **Solution:** Run `./scripts/reset-production-db.sh` (⚠️ deletes all data)

**Problem:** Old test data in production
- **Solution:** Run `./scripts/reset-production-db.sh` to start fresh

---

## Best Practices

1. **Always use local development for testing**
   - Faster iteration
   - No risk to production data
   - No Azure costs

2. **Reset local database frequently**
   - Keeps test data clean
   - Fast and safe

3. **Be careful with production database**
   - Always confirm before resetting
   - Consider backing up important data first
   - Test changes locally first

4. **Use the verification script**
   - Run `./scripts/verify-local-dev.sh` before starting work
   - Ensures you're not accidentally using production services

---

## Scripts Reference

| Script | Purpose | Safe? |
|--------|---------|-------|
| `./dev-tools.sh reset-db` | Reset local Azurite database | ✅ Yes |
| `scripts/reset-production-db.sh` | Reset production Azure database | ⚠️ Requires confirmation |
| `scripts/verify-local-dev.sh` | Check local dev configuration | ✅ Yes (read-only) |
| `scripts/init-tables.sh` | Initialize local tables | ✅ Yes |

---

## Environment Variables

### Frontend (`frontend/.env.local`)
```bash
NEXT_PUBLIC_API_URL=http://localhost:7071/api
NEXT_PUBLIC_ENVIRONMENT=local
NEXT_PUBLIC_AAD_CLIENT_ID=dc482c34-ebaa-4239-aca3-2810a4f51728
NEXT_PUBLIC_AAD_TENANT_ID=8ff7db19-435d-4c3c-83d3-ca0a46234f51
```

### Backend (`backend/local.settings.json`)
```json
{
  "Values": {
    "AzureWebJobsStorage": "AccountName=devstoreaccount1;...",
    "SIGNALR_CONNECTION_STRING": "dummy",
    "CHAIN_TOKEN_TTL_SECONDS": "20"
  }
}
```

---

**Last Updated:** February 8, 2026
