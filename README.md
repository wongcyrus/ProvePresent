# ProvePresent

**Peer-Verified Classroom Attendance**

Students prove they're actually in class by passing verification tokens to each other. No more proxy attendance or buddy check-ins.

---

## How It Works

1. **Teacher starts a session** → Entry chains are seeded to random students
2. **Students pass the chain** → Scan QR codes from classmates to verify presence
3. **Chain completes** → Everyone who participated is marked present
4. **Exit verification** → Same process when class ends

The chain mechanism ensures students must be physically present to participate - you can't pass a QR code to someone who isn't there.

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Chain Verification** | Peer-to-peer token passing proves physical presence |
| **Real-time Dashboard** | Teachers see live attendance as chains progress |
| **Live Quiz** | AI generates questions from lecture slides (GPT-4) |
| **Seating Analysis** | Capture photos to analyze classroom arrangement |
| **Geolocation** | Optional location validation with configurable radius |
| **Recurring Sessions** | Daily, weekly, or monthly schedules |
| **Export** | CSV/JSON with full audit trail |

---

## Tech Stack

```
Frontend:     Next.js 15 + React 18 + TypeScript
Backend:      Azure Functions v4 (Node.js 22)
Database:     Azure Table Storage (16 tables)
Real-time:    Azure SignalR Service
AI:           Azure OpenAI + Foundry Agent Service
Auth:         Email OTP (Self-managed JWT)
Hosting:      Azure Static Web Apps
```

---

## Quick Start

### Deploy to Azure

1. **Setup JWT configuration**
   ```bash
   ./setup-jwt-config.sh
   ```

2. **Verify SMTP credentials**
   ```bash
   # Ensure .otp-email-credentials exists with valid SMTP settings
   cat .otp-email-credentials
   ```

3. **Deploy**
   ```bash
   ./deploy-full-production.sh
   ```

See **[Quick Start Guide](QUICK_START.md)** for complete instructions.

### Local Development

```bash
npm install
./start-local-dev.sh

# Frontend: http://localhost:3000
# Backend:  http://localhost:7071
```

---

## Project Structure

```
├── backend/           # Azure Functions (44+ endpoints)
├── frontend/          # Next.js application
├── infrastructure/    # Bicep IaC templates
├── docs/
│   ├── architecture/  # System design
│   ├── deployment/    # Deploy guides
│   └── development/   # Dev setup
└── scripts/           # Utilities
```

---

## Documentation

- **[Getting Started](GETTING_STARTED.md)** - Setup guide
- **[Deployment Guide](docs/deployment/DEPLOYMENT_GUIDE.md)** - Azure deployment
- **[System Architecture](docs/architecture/SYSTEM_ARCHITECTURE.md)** - Technical design
- **[Infrastructure](docs/architecture/INFRASTRUCTURE_BICEP.md)** - Bicep modules
- **[Full Index](DOCUMENTATION_INDEX.md)** - All docs

---

## Authentication

Roles are assigned automatically by email domain:

| Domain | Role |
|--------|------|
| `@vtc.edu.hk` (excluding students) | Teacher |
| `@stu.vtc.edu.hk` | Student |

---

## Status

**Version**: 3.0  
**Status**: ✅ Production Ready

| Component | Count |
|-----------|-------|
| Backend Functions | 44+ |
| Frontend Components | 22+ |
| Database Tables | 16 |

---

## License

MIT

---

**Last Updated**: March 6, 2026
