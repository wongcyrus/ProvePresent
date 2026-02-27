# UI Not Updating After Deployment - Fix Guide

## Problem
After deploying to Azure Static Web Apps, the UI doesn't show the latest changes due to aggressive caching at multiple levels:
- Browser cache
- Azure Static Web Apps CDN cache
- Service worker cache (if any)

## Quick Fix (Recommended)

### Option 1: Use the Force Deploy Script
```bash
cd frontend
./force-deploy.sh
```

This script:
1. Cleans all build artifacts
2. Rebuilds with a fresh timestamp
3. Adds cache-busting meta tags
4. Shows deployment instructions

### Option 2: Manual Steps

1. **Clean build artifacts:**
```bash
cd frontend
rm -rf .next out node_modules/.cache
```

2. **Rebuild:**
```bash
npm run build
```

3. **Deploy to Azure Static Web Apps:**
```bash
# If using Azure CLI
az staticwebapp deploy --name <your-app-name> --resource-group <your-rg> --app-location ./out

# Or use GitHub Actions (push to main branch)
git add .
git commit -m "Force cache refresh"
git push
```

4. **Clear browser cache:**
- Chrome/Edge: `Ctrl+Shift+Delete` → Clear cached images and files
- Firefox: `Ctrl+Shift+Delete` → Clear cache
- Safari: `Cmd+Option+E`
- Or use **Incognito/Private mode** to test

## Verification Steps

### 1. Check Build Timestamp
Open browser DevTools (F12) → Network tab → Reload page → Click `index.html` → Check Response Headers for `build-time` meta tag

### 2. Check Static Web App Deployment
```bash
az staticwebapp show \
  --name <your-app-name> \
  --resource-group <your-rg> \
  --query "defaultHostname"
```

### 3. Hard Refresh in Browser
- Chrome/Edge/Firefox: `Ctrl+Shift+R` or `Ctrl+F5`
- Mac: `Cmd+Shift+R`

### 4. Check Network Tab
- Open DevTools → Network tab
- Check if files are loaded from cache (shows "disk cache" or "memory cache")
- If yes, do a hard refresh

## Configuration Changes Made

### 1. Updated `staticwebapp.config.json`
Moved cache control headers from global to route-specific:

```json
{
  "routes": [
    {
      "route": "/*.js",
      "headers": {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
      }
    },
    {
      "route": "/*.css",
      "headers": {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
      }
    },
    {
      "route": "/index.html",
      "headers": {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
      }
    }
  ]
}
```

### 2. Next.js Config Already Has Dynamic Build ID
```javascript
async generateBuildId() {
  return 'build-' + Date.now();
}
```

This ensures each build has a unique ID.

## Advanced Troubleshooting

### If UI Still Not Updating

#### 1. Check Azure Static Web Apps Deployment Status
```bash
az staticwebapp show \
  --name <your-app-name> \
  --resource-group <your-rg> \
  --query "{name:name, status:status, lastUpdated:lastUpdatedOn}"
```

#### 2. View Recent Deployments
```bash
az staticwebapp environment list \
  --name <your-app-name> \
  --resource-group <your-rg>
```

#### 3. Check GitHub Actions (if using)
- Go to your GitHub repo → Actions tab
- Check if the latest workflow run succeeded
- Look for any deployment errors

#### 4. Purge Azure CDN Cache (if applicable)
If your Static Web App uses Azure CDN:
```bash
az cdn endpoint purge \
  --resource-group <your-rg> \
  --profile-name <cdn-profile> \
  --name <endpoint-name> \
  --content-paths '/*'
```

#### 5. Check Service Worker
If you have a service worker, it might be caching aggressively:
- Open DevTools → Application tab → Service Workers
- Click "Unregister" to remove it
- Or add "Update on reload" checkbox

#### 6. Test with Different Browser
Try opening the site in a different browser or incognito mode to rule out local cache issues.

## Prevention - Best Practices

### 1. Use Versioned Assets
Add version query strings to assets:
```html
<script src="/app.js?v=1.2.3"></script>
```

### 2. Use Content Hashing
Next.js already does this for production builds in the `_next` folder.

### 3. Set Appropriate Cache Headers
- HTML files: `no-cache` (always revalidate)
- JS/CSS with hashes: `max-age=31536000` (1 year)
- Images: `max-age=86400` (1 day)

### 4. Monitor Deployments
Set up alerts for deployment failures:
```bash
az monitor metrics alert create \
  --name "StaticWebApp-Deployment-Failed" \
  --resource-group <your-rg> \
  --scopes <resource-id> \
  --condition "count deploymentStatus == 'Failed'"
```

## Common Causes

1. **Browser Cache**: Most common - users need to hard refresh
2. **CDN Cache**: Azure Static Web Apps uses CDN - takes time to propagate
3. **Service Worker**: If implemented, can aggressively cache
4. **Build Not Deployed**: Check if deployment actually succeeded
5. **Wrong Environment**: Deploying to staging instead of production

## Testing Checklist

After deployment, verify:
- [ ] Build completed successfully
- [ ] Deployment to Azure succeeded
- [ ] Hard refresh in browser (Ctrl+Shift+R)
- [ ] Test in incognito mode
- [ ] Check Network tab for cache status
- [ ] Verify build timestamp in HTML
- [ ] Test on different browser
- [ ] Test on mobile device

## Quick Commands Reference

```bash
# Clean and rebuild
cd frontend
rm -rf .next out node_modules/.cache
npm run build

# Deploy (if using Azure CLI)
az staticwebapp deploy --name <app> --resource-group <rg> --app-location ./out

# Check deployment status
az staticwebapp show --name <app> --resource-group <rg>

# Purge CDN cache (if applicable)
az cdn endpoint purge --resource-group <rg> --profile-name <profile> --name <endpoint> --content-paths '/*'
```

## Support

If none of these solutions work:
1. Check Azure Static Web Apps service health
2. Review deployment logs in Azure Portal
3. Check GitHub Actions logs (if using)
4. Contact Azure support

## Summary

The most common fix is:
1. Run `./force-deploy.sh` in frontend folder
2. Deploy the `out` folder
3. Hard refresh browser (Ctrl+Shift+R)
4. Test in incognito mode

This should resolve 95% of cache-related deployment issues.
