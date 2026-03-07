#!/bin/bash
# Setup JWT and OTP Configuration
# This script creates .jwt-otp-config with a secure JWT_SECRET

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}=========================================="
echo "JWT and OTP Configuration Setup"
echo -e "==========================================${NC}"
echo ""

# Check if .jwt-otp-config already exists
if [ -f ".jwt-otp-config" ]; then
    echo -e "${YELLOW}⚠ .jwt-otp-config already exists${NC}"
    echo ""
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Keeping existing configuration."
        echo ""
        echo "To use existing config:"
        echo "  source ./.jwt-otp-config"
        echo "  ./deploy-full-production.sh"
        exit 0
    fi
    echo ""
fi

# Generate secure JWT_SECRET
echo "Generating secure JWT_SECRET..."
JWT_SECRET=$(openssl rand -hex 32)

if [ -z "$JWT_SECRET" ]; then
    echo -e "${RED}✗ Failed to generate JWT_SECRET${NC}"
    echo "Please ensure openssl is installed"
    exit 1
fi

echo -e "${GREEN}✓ JWT_SECRET generated (64 characters)${NC}"
echo ""

# Create configuration file
cat > .jwt-otp-config << EOF
# JWT and OTP Configuration
# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
# DO NOT commit this file to git!
# This file is automatically loaded by deploy-full-production.sh

# JWT Configuration
JWT_SECRET=$JWT_SECRET
JWT_EXPIRY_HOURS=24

# OTP Configuration (optional - has defaults)
OTP_EXPIRY_MINUTES=5
OTP_MAX_ATTEMPTS=3
OTP_RATE_LIMIT_MINUTES=15
OTP_RATE_LIMIT_COUNT=3
EOF

echo -e "${GREEN}✓ Configuration file created: .jwt-otp-config${NC}"
echo ""

# Verify .gitignore
if ! grep -q ".jwt-otp-config" .gitignore 2>/dev/null; then
    echo -e "${YELLOW}⚠ Adding .jwt-otp-config to .gitignore${NC}"
    echo ".jwt-otp-config" >> .gitignore
fi

echo -e "${GREEN}✓ Configuration complete!${NC}"
echo ""
echo "Next steps:"
echo ""
echo "1. Verify SMTP settings in .otp-email-credentials"
echo ""
echo "2. Deploy to Azure (configuration is automatically loaded):"
echo "   ${GREEN}./deploy-full-production.sh${NC}"
echo ""

# Offer to show the JWT_SECRET
echo -e "${YELLOW}=========================================="
echo "IMPORTANT: Save your JWT_SECRET"
echo -e "==========================================${NC}"
echo ""
echo "Your JWT_SECRET has been generated and saved to .jwt-otp-config"
echo ""
read -p "Do you want to display it now? (y/N): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${YELLOW}JWT_SECRET:${NC}"
    echo "$JWT_SECRET"
    echo ""
    echo -e "${RED}⚠ Keep this secret secure!${NC}"
    echo "  - Never commit it to git"
    echo "  - Store it in a password manager"
    echo "  - Use Azure Key Vault for production"
    echo ""
fi

echo "Setup complete!"
