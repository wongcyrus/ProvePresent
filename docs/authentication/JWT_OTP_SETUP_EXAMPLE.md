# JWT OTP Configuration - Complete Example

## Quick Setup

### Option 1: Automated Setup (Recommended)

```bash
# Run the setup script - it generates everything automatically
./setup-jwt-config.sh

# Deploy with the new configuration
./deploy-full-production.sh
```

### Option 2: Manual Setup

```bash
# 1. Copy the template
cp .jwt-otp-config.template .jwt-otp-config

# 2. Generate a secure JWT secret
JWT_SECRET=$(openssl rand -hex 32)

# 3. Update the config file (macOS)
sed -i '' "s/your-secure-secret-here-at-least-32-characters-long/$JWT_SECRET/" .jwt-otp-config

# Or on Linux:
sed -i "s/your-secure-secret-here-at-least-32-characters-long/$JWT_SECRET/" .jwt-otp-config

# 4. Deploy
./deploy-full-production.sh
```

## Configuration File Example

Here's a complete `.jwt-otp-config` file with all options:

```bash
# JWT Configuration (Required)
JWT_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2
JWT_EXPIRY_HOURS=24

# OTP Configuration (Optional - these are the defaults)
OTP_EXPIRY_MINUTES=5
OTP_MAX_ATTEMPTS=3
OTP_RATE_LIMIT_MINUTES=15
OTP_RATE_LIMIT_COUNT=3
```

## Minimal Configuration

If you only want to set the required values:

```bash
# Only JWT_SECRET is required - everything else has defaults
JWT_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2
```

## Configuration Options Explained

### JWT_SECRET (Required)
- **Purpose**: Signs JWT tokens to prevent tampering
- **Format**: At least 32 characters (64 recommended)
- **Generate**: `openssl rand -hex 32`
- **Security**: Never commit to git, use different secrets per environment

### JWT_EXPIRY_HOURS (Optional, default: 24)
- **Purpose**: How long users stay logged in
- **Values**: 
  - `24` = 1 day (recommended for production)
  - `168` = 1 week (for convenience)
  - `1` = 1 hour (for high security)

### OTP_EXPIRY_MINUTES (Optional, default: 5)
- **Purpose**: How long the OTP code is valid
- **Values**:
  - `5` = 5 minutes (recommended)
  - `10` = 10 minutes (more user-friendly)
  - `2` = 2 minutes (high security)

### OTP_MAX_ATTEMPTS (Optional, default: 3)
- **Purpose**: Maximum wrong OTP attempts before lockout
- **Values**:
  - `3` = 3 attempts (recommended)
  - `5` = 5 attempts (more lenient)
  - `1` = 1 attempt (very strict)

### OTP_RATE_LIMIT_MINUTES (Optional, default: 15)
- **Purpose**: Time window for rate limiting OTP requests
- **Values**:
  - `15` = 15 minutes (recommended)
  - `60` = 1 hour (stricter)

### OTP_RATE_LIMIT_COUNT (Optional, default: 3)
- **Purpose**: Max OTP requests within rate limit window
- **Values**:
  - `3` = 3 requests per window (recommended)
  - `5` = 5 requests (more lenient)

## How It Works

### 1. Configuration Loading

The deployment script automatically loads `.jwt-otp-config`:

```bash
# In deploy-full-production.sh
load_jwt_otp_config() {
  if [ -f .jwt-otp-config ]; then
    echo "Loading JWT/OTP configuration..."
    source ./.jwt-otp-config
    
    # Validate JWT_SECRET
    if [ -z "$JWT_SECRET" ]; then
      echo "Error: JWT_SECRET not set in .jwt-otp-config"
      exit 1
    fi
  else
    echo "Error: .jwt-otp-config not found"
    exit 1
  fi
}
```

### 2. Environment Variables

The configuration is set as Azure Function App settings:

```bash
az functionapp config appsettings set \
  --name "$FUNCTION_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    "JWT_SECRET=$JWT_SECRET" \
    "JWT_EXPIRY_HOURS=$JWT_EXPIRY_HOURS" \
    "OTP_EXPIRY_MINUTES=$OTP_EXPIRY_MINUTES" \
    "OTP_MAX_ATTEMPTS=$OTP_MAX_ATTEMPTS" \
    "OTP_RATE_LIMIT_MINUTES=$OTP_RATE_LIMIT_MINUTES" \
    "OTP_RATE_LIMIT_COUNT=$OTP_RATE_LIMIT_COUNT"
```

### 3. Backend Usage

The backend functions use these environment variables:

```typescript
// backend/src/utils/jwt.ts
const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_EXPIRY_HOURS = parseInt(process.env.JWT_EXPIRY_HOURS || '24');

export function createToken(email: string): string {
  const payload = {
    email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (JWT_EXPIRY_HOURS * 3600)
  };
  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' });
}
```

```typescript
// backend/src/utils/otp.ts
const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES || '5');
const OTP_MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS || '3');

export function generateOTP(): { code: string; expiresAt: number } {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + (OTP_EXPIRY_MINUTES * 60 * 1000);
  return { code, expiresAt };
}
```

## Authentication Flow Example

### 1. User Requests OTP

```bash
# Frontend calls
POST /api/auth/request-otp
{
  "email": "teacher@vtc.edu.hk"
}

# Backend generates 6-digit OTP
# Stores in OtpCodes table with expiry (5 minutes)
# Sends email with OTP code
```

### 2. User Verifies OTP

```bash
# Frontend calls
POST /api/auth/verify-otp
{
  "email": "teacher@vtc.edu.hk",
  "code": "123456"
}

# Backend validates:
# - OTP exists and not expired (5 minutes)
# - Attempts < max attempts (3)
# - Rate limit not exceeded (3 requests per 15 minutes)

# If valid:
# - Creates JWT token (expires in 24 hours)
# - Sets HttpOnly cookie: auth-token=<jwt>
# - Returns success
```

### 3. Authenticated Requests

```bash
# Frontend calls with credentials: 'include'
GET /api/sessions/123
Cookie: auth-token=<jwt>

# Backend:
# - Extracts JWT from cookie
# - Verifies signature using JWT_SECRET
# - Checks expiry (24 hours)
# - Returns user principal with email and roles
```

## Security Best Practices

### 1. Generate Strong Secrets

```bash
# Good: 64 character hex string
openssl rand -hex 32
# Output: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2

# Bad: Short or predictable
JWT_SECRET=mysecret123
```

### 2. Different Secrets Per Environment

```bash
# Development
JWT_SECRET=dev-secret-a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6

# Staging
JWT_SECRET=staging-secret-x1y2z3a4b5c6d7e8f9g0h1i2j3k4l5m6

# Production
JWT_SECRET=prod-secret-p1q2r3s4t5u6v7w8x9y0z1a2b3c4d5e6
```

### 3. Never Commit Secrets

```bash
# .gitignore already includes:
.jwt-otp-config
.otp-email-credentials

# Verify:
git status
# Should NOT show .jwt-otp-config
```

### 4. Rotate Secrets Regularly

```bash
# Generate new secret
NEW_SECRET=$(openssl rand -hex 32)

# Update config
sed -i "s/JWT_SECRET=.*/JWT_SECRET=$NEW_SECRET/" .jwt-otp-config

# Redeploy
./deploy-full-production.sh

# Note: This will log out all users
```

## Troubleshooting

### Error: JWT_SECRET not set

```bash
# Check if file exists
ls -la .jwt-otp-config

# If not, create it
./setup-jwt-config.sh
```

### Error: JWT_SECRET too short

```bash
# Generate a proper secret
openssl rand -hex 32

# Update .jwt-otp-config with the new secret
```

### Users getting logged out frequently

```bash
# Increase JWT expiry
# Edit .jwt-otp-config:
JWT_EXPIRY_HOURS=168  # 1 week

# Redeploy
./deploy-full-production.sh
```

### OTP codes expiring too quickly

```bash
# Increase OTP expiry
# Edit .jwt-otp-config:
OTP_EXPIRY_MINUTES=10  # 10 minutes

# Redeploy
./deploy-full-production.sh
```

## Files Reference

- `.jwt-otp-config.template` - Template with all options and comments
- `.jwt-otp-config.example` - Complete example with sample values
- `.jwt-otp-config` - Your actual config (git-ignored)
- `setup-jwt-config.sh` - Automated setup script
- `JWT_OTP_CONFIGURATION_GUIDE.md` - Detailed configuration guide
