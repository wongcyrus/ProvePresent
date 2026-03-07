#!/bin/bash

# Script to clean up root-level markdown files
# Moves useful docs to docs/ folder and archives temporary ones

set -e

echo "=========================================="
echo "Root Documentation Cleanup"
echo "=========================================="
echo ""

# Create archive directory
ARCHIVE_DIR=".archive/root-docs-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$ARCHIVE_DIR"

# Create docs directories if they don't exist
mkdir -p docs/authentication
mkdir -p docs/deployment

echo "Organizing documentation files..."
echo ""

# Move authentication docs to docs/authentication/
if [ -f "JWT_OTP_CONFIGURATION_GUIDE.md" ]; then
    echo "Moving JWT_OTP_CONFIGURATION_GUIDE.md to docs/authentication/"
    mv JWT_OTP_CONFIGURATION_GUIDE.md docs/authentication/
fi

if [ -f "JWT_OTP_SETUP_EXAMPLE.md" ]; then
    echo "Moving JWT_OTP_SETUP_EXAMPLE.md to docs/authentication/"
    mv JWT_OTP_SETUP_EXAMPLE.md docs/authentication/
fi

# Move deployment/migration docs to docs/deployment/
if [ -f "BACKEND_AUTH_MIGRATION.md" ]; then
    echo "Moving BACKEND_AUTH_MIGRATION.md to docs/deployment/"
    mv BACKEND_AUTH_MIGRATION.md docs/deployment/
fi

if [ -f "DEV_SCRIPT_MIGRATION_COMPLETE.md" ]; then
    echo "Moving DEV_SCRIPT_MIGRATION_COMPLETE.md to docs/deployment/"
    mv DEV_SCRIPT_MIGRATION_COMPLETE.md docs/deployment/
fi

# Archive temporary/summary docs
echo ""
echo "Archiving temporary documentation..."

if [ -f "DOCUMENTATION_CLEANUP_SUMMARY.md" ]; then
    echo "Archiving DOCUMENTATION_CLEANUP_SUMMARY.md"
    mv DOCUMENTATION_CLEANUP_SUMMARY.md "$ARCHIVE_DIR/"
fi

echo ""
echo "=========================================="
echo "Cleanup Complete!"
echo "=========================================="
echo ""
echo "Documentation structure:"
echo ""
echo "Root level (essential):"
echo "  - README.md (project overview)"
echo "  - GETTING_STARTED.md (setup guide)"
echo "  - DOCUMENTATION_INDEX.md (doc index)"
echo "  - PROJECT_STATUS.md (project status)"
echo "  - SECURITY.md (security info)"
echo "  - AGENT_SERVICE_GUIDE.md (agent guide)"
echo ""
echo "docs/authentication/:"
echo "  - JWT_OTP_CONFIGURATION_GUIDE.md"
echo "  - JWT_OTP_SETUP_EXAMPLE.md"
echo ""
echo "docs/deployment/:"
echo "  - DEPLOYMENT_GUIDE.md"
echo "  - BACKEND_AUTH_MIGRATION.md"
echo "  - DEV_SCRIPT_MIGRATION_COMPLETE.md"
echo ""
echo "Archived to: $ARCHIVE_DIR"
echo ""
