# ProvePresent

<p align="center">
  <img src="images/logo.png" alt="ProvePresent Logo" width="200"/>
</p>

**Peer-Verified Event Attendance**

Attendees prove they're actually present by passing verification tokens to each other. No more proxy attendance or remote check-ins.

---

## How It Works

1. **Organizer starts a session** → Entry chains are seeded to random attendees
2. **Attendees pass the chain** → Scan QR codes from others to verify presence
3. **Chain completes** → Everyone who participated is marked present
4. **Exit verification** → Same process when event ends

The chain mechanism ensures attendees must be physically present to participate - you can't pass a QR code to someone who isn't there.

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Chain Verification** | Peer-to-peer token passing proves physical presence |
| **Real-time Dashboard** | Organizers see live attendance as chains progress |
| **Live Quiz** | AI generates questions from presentation slides (GPT-4) |
| **Seating Analysis** | Capture photos to analyze venue arrangement |
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

#### Recommended CDKTF path

1. **Prepare environment config**
   ```bash
   cd infrastructure/cdktf
   cp .env.staging.example .env.staging
   # edit .env.staging with your environment values
   ```

2. **Run full deployment**
   ```bash
   ./deploy-full.sh staging
   ```

This runs the full working deployment flow:
- creates or verifies the resource group and Static Web App prerequisite
- deploys infrastructure with CDKTF
- publishes the backend
- deploys the frontend to the SWA production environment
- creates Foundry agents and updates Function App settings

See **[CDKTF Infrastructure Runbook](infrastructure/cdktf/README.md)** for environment details and full instructions.

#### Original Bicep path

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

See **[Deployment Guide](docs/deployment/DEPLOYMENT_GUIDE.md)** for both deployment paths.

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
├── infrastructure/    # Bicep and CDKTF IaC
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
- **[CDKTF Runbook](infrastructure/cdktf/README.md)** - CDKTF full deployment path
- **[System Architecture](docs/architecture/SYSTEM_ARCHITECTURE.md)** - Technical design
- **[Infrastructure](docs/architecture/INFRASTRUCTURE_BICEP.md)** - Bicep modules
- **[Full Index](DOCUMENTATION_INDEX.md)** - All docs

---

## Authentication

Users are assigned roles through the ExternalOrganizers table:

| Role | Access |
|------|--------|
| Organizer | Create and manage events, view attendance |
| Attendee | Join events, participate in verification chains |

To add organizers, use the `manageExternalOrganizers` API endpoint or Azure Portal to add emails to the ExternalOrganizers table.

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

**Last Updated**: July 28, 2026
