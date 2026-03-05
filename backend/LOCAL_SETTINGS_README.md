# Local Settings Configuration

This file explains how to configure `local.settings.json` for local development.

## Setup Instructions

1. Copy the template file:
   ```bash
   cp local.settings.json.template local.settings.json
   ```

2. Update the values in `local.settings.json`:

### Required Settings

#### AzureWebJobsStorage
For local development with Azurite (default):
```json
"AzureWebJobsStorage": "AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;DefaultEndpointsProtocol=http;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;"
```

For Azure Storage (production testing):
```json
"AzureWebJobsStorage": "DefaultEndpointsProtocol=https;AccountName=YOUR_ACCOUNT;AccountKey=YOUR_KEY;EndpointSuffix=core.windows.net"
```

#### SIGNALR_CONNECTION_STRING
Get this from Azure Portal → SignalR Service → Keys:
```json
"SIGNALR_CONNECTION_STRING": "Endpoint=https://your-signalr-name.service.signalr.net;AccessKey=YOUR_ACCESS_KEY;Version=1.0;"
```

For local dev without SignalR (polling fallback):
```json
"SIGNALR_CONNECTION_STRING": "dummy"
```

### Optional Settings

#### Token Expiration
```json
"CHAIN_TOKEN_TTL_SECONDS": "20",
"LATE_ROTATION_SECONDS": "60",
"EARLY_LEAVE_ROTATION_SECONDS": "60"
```

#### Location Constraints
```json
"WIFI_SSID_ALLOWLIST": "ClassroomWiFi,SchoolNetwork"
```

#### Azure OpenAI (for future features)
```json
"AOAI_ENDPOINT": "https://your-openai.openai.azure.com/",
"AOAI_KEY": "your-key",
"AOAI_DEPLOYMENT": "gpt-4"
```

#### Custom OTP Email via SMTP
Used by HTTP function route `/api/auth/on-otp-send-email`.
```json
"OTP_SMTP_HOST": "smtp.gmail.com",
"OTP_SMTP_PORT": "465",
"OTP_SMTP_SECURE": "true",
"OTP_SMTP_USERNAME": "your@gmail.com",
"OTP_SMTP_PASSWORD": "your-16-char-google-app-password",
"OTP_FROM_EMAIL": "your@gmail.com",
"OTP_FROM_NAME": "QR Chain Attend",
"OTP_EMAIL_SUBJECT": "Your verification code",
"OTP_APP_NAME": "QR Chain Attend"
```

For Google Workspace, use an App Password (not your normal account password).

## Environment-Specific Configurations

### Local Development (Azurite)
- Use the default `AzureWebJobsStorage` connection string
- Set `SIGNALR_CONNECTION_STRING` to "dummy" if you don't have SignalR
- Dashboard will use polling fallback (5 second refresh)

### Production Testing (Azure Resources)
- Use real Azure Storage connection string
- Use real SignalR connection string
- Real-time updates via SignalR

## Security Notes

⚠️ **NEVER commit `local.settings.json` to version control!**

- This file contains sensitive keys and connection strings
- It's already in `.gitignore`
- Only commit the `.template` file
- Share keys securely with team members (e.g., Azure Key Vault, 1Password)

## Troubleshooting

### SignalR not working
1. Check connection string is correct
2. Check Azure Portal → SignalR → Keys
3. Verify SignalR service is running
4. Check browser console for connection errors
5. Fallback: Set to "dummy" and use polling

### Storage not working
1. Ensure Azurite is running: `azurite --silent --location ./azurite --debug ./azurite/debug.log`
2. Check connection string format
3. Verify tables are initialized: `./scripts/init-tables.sh`

### CORS errors
1. Check `Host.CORS` is set to "*" for local dev
2. For production, set specific origins
