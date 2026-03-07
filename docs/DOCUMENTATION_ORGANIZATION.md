# Documentation Organization

## Overview
This document describes the organization of project documentation after the cleanup on March 7, 2026.

## Structure

### Root Level (Essential Only)
These are the most important documents that users need immediate access to:

- **README.md** - Project overview, features, and quick links
- **GETTING_STARTED.md** - Setup and deployment guide
- **DOCUMENTATION_INDEX.md** - Complete documentation index
- **PROJECT_STATUS.md** - Current project status and roadmap
- **SECURITY.md** - Security guidelines and best practices
- **AGENT_SERVICE_GUIDE.md** - Azure AI Foundry agents guide

### docs/authentication/
Authentication-related documentation:

- **JWT_OTP_CONFIGURATION_GUIDE.md** - Comprehensive JWT and OTP configuration guide
- **JWT_OTP_SETUP_EXAMPLE.md** - Complete setup examples and authentication flow

### docs/deployment/
Deployment and migration documentation:

- **DEPLOYMENT_GUIDE.md** - Full deployment instructions
- **BACKEND_AUTH_MIGRATION.md** - Backend JWT authentication migration details
- **DEV_SCRIPT_MIGRATION_COMPLETE.md** - Development script migration summary

### docs/architecture/
System architecture documentation:

- **SYSTEM_ARCHITECTURE.md** - Overall system design
- **INFRASTRUCTURE_BICEP.md** - Bicep IaC modules
- **DEPLOYMENT_SCRIPTS.md** - Deployment script architecture
- **DATABASE_TABLES.md** - Database schema (16 tables)
- **DATABASE_MANAGEMENT.md** - Database operations
- **LIVE_QUIZ.md** - AI quiz feature

### docs/development/
Development environment documentation:

- **LOCAL_DEVELOPMENT.md** - Local development setup
- **DEVELOPMENT_ENVIRONMENT.md** - Environment configuration

### docs/ (Reference)
Additional reference documentation:

- **BACKEND_ARCHITECTURE.md** - Backend details
- **FRONTEND_ARCHITECTURE.md** - Frontend details
- **MONITORING.md** - Monitoring setup
- **CICD_SETUP.md** - CI/CD configuration

## Archived Documentation

### .archive/outdated-docs-YYYYMMDD-HHMMSS/
Outdated migration documentation from Azure AD to OTP:
- Azure AD removal documentation
- OTP migration plans and summaries
- Temporary fix/cleanup documentation
- Migration scripts

### .archive/root-docs-YYYYMMDD-HHMMSS/
Temporary documentation that was consolidated:
- Documentation cleanup summaries
- Temporary migration notes

### .archive/azure-ad-legacy-YYYYMMDD/
Legacy Azure AD configuration files and scripts:
- `.external-id-credentials` files
- Azure AD setup scripts
- Azure AD configuration documentation

## Documentation Principles

### Root Level
- Keep only essential, frequently-accessed documents
- Maximum 6-8 files for easy navigation
- Each file should serve a clear, distinct purpose

### Subdirectories
- Group related documentation by topic
- Use clear, descriptive folder names
- Maintain consistent structure across folders

### Archiving
- Archive outdated documentation with timestamps
- Keep archives for reference and rollback
- Document what was archived and why

## Finding Documentation

### Quick Start
1. Start with **README.md** for project overview
2. Follow **GETTING_STARTED.md** for setup
3. Check **DOCUMENTATION_INDEX.md** for complete list

### Authentication Setup
1. Read **docs/authentication/JWT_OTP_CONFIGURATION_GUIDE.md**
2. Follow examples in **docs/authentication/JWT_OTP_SETUP_EXAMPLE.md**

### Deployment
1. Read **docs/deployment/DEPLOYMENT_GUIDE.md**
2. For migration details, see **docs/deployment/BACKEND_AUTH_MIGRATION.md**

### Architecture
1. Start with **docs/architecture/SYSTEM_ARCHITECTURE.md**
2. Dive into specific topics as needed

## Maintenance

### Adding New Documentation
1. Determine the appropriate location:
   - Root level: Only if essential and frequently accessed
   - Subdirectory: Group with related documentation
2. Update **DOCUMENTATION_INDEX.md**
3. Follow existing naming conventions

### Updating Documentation
1. Update the document
2. Update "Last Updated" date
3. Update **DOCUMENTATION_INDEX.md** if description changes

### Archiving Documentation
1. Create timestamped archive directory
2. Move outdated files
3. Update **DOCUMENTATION_INDEX.md**
4. Document what was archived in archive README

## Cleanup History

### March 7, 2026
- Removed Azure AD authentication documentation
- Consolidated JWT/OTP documentation
- Organized root-level files into subdirectories
- Archived temporary migration documentation
- Updated DOCUMENTATION_INDEX.md

## Related Scripts

- **cleanup-outdated-docs.sh** - Archives outdated migration docs
- **cleanup-root-docs.sh** - Organizes root-level documentation

## Future Improvements

Consider these improvements for documentation:
1. Add diagrams to architecture docs
2. Create video tutorials for complex setups
3. Add troubleshooting guides
4. Create API reference documentation
5. Add code examples to more docs
