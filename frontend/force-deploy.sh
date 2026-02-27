#!/bin/bash

# Force Deploy Script for Azure Static Web Apps
# This script ensures the UI updates by clearing caches and forcing a fresh build

set -e

echo "🚀 Force Deploy - Clearing all caches and rebuilding..."

# Step 1: Clean all build artifacts
echo "📦 Step 1: Cleaning build artifacts..."
rm -rf .next
rm -rf out
rm -rf node_modules/.cache
echo "✅ Build artifacts cleaned"

# Step 2: Rebuild with fresh timestamp
echo "🔨 Step 2: Building with fresh timestamp..."
export BUILD_TIME=$(date +%s)
npm run build
echo "✅ Build completed with timestamp: $BUILD_TIME"

# Step 3: Add cache-busting meta tag to index.html
echo "🏷️  Step 3: Adding cache-busting meta tag..."
if [ -f "out/index.html" ]; then
  # Add meta tag to force browser refresh
  sed -i "/<head>/a \  <meta http-equiv=\"Cache-Control\" content=\"no-cache, no-store, must-revalidate\">\n  <meta http-equiv=\"Pragma\" content=\"no-cache\">\n  <meta http-equiv=\"Expires\" content=\"0\">\n  <meta name=\"build-time\" content=\"$BUILD_TIME\">" out/index.html
  echo "✅ Cache-busting meta tags added"
else
  echo "⚠️  Warning: out/index.html not found"
fi

# Step 4: Display deployment instructions
echo ""
echo "✅ Build ready for deployment!"
echo ""
echo "📋 Next steps:"
echo "1. Deploy the 'out' folder to Azure Static Web Apps"
echo "2. After deployment, clear browser cache:"
echo "   - Chrome/Edge: Ctrl+Shift+Delete → Clear cached images and files"
echo "   - Or use Incognito/Private mode"
echo "3. If still not updating, run this Azure CLI command:"
echo ""
echo "   az staticwebapp show --name <your-app-name> --resource-group <your-rg>"
echo ""
echo "4. To force Azure CDN cache purge (if using CDN):"
echo "   az cdn endpoint purge --resource-group <your-rg> --profile-name <profile> --name <endpoint> --content-paths '/*'"
echo ""
echo "🎯 Build timestamp: $BUILD_TIME"
echo "   Check this in browser DevTools → Network → index.html → Response Headers"
