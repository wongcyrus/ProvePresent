#!/bin/bash
# Script to capture backend logs during testing

echo "Monitoring Function App logs..."
echo "Press Ctrl+C to stop"
echo ""
echo "Waiting for initiateImageCapture calls..."
echo "=========================================="

# Stream logs and filter for capture-related messages
az monitor app-insights query \
  --app $(az monitor app-insights component list --resource-group rg-qr-attendance-dev --query "[0].appId" -o tsv) \
  --analytics-query "traces | where timestamp > ago(5m) | where message contains 'capture' or message contains 'Broadcasting' | project timestamp, message | order by timestamp desc" \
  --output table

echo ""
echo "To see live logs, open Azure Portal:"
echo "https://portal.azure.com → Function App → func-qrattendance-dev → Log stream"
