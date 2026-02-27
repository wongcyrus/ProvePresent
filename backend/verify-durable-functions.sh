#!/bin/bash

# Durable Functions Runtime Verification Script
# This script verifies that Durable Functions is properly configured

echo "=========================================="
echo "Durable Functions Runtime Verification"
echo "=========================================="
echo ""

# Check 1: Verify durable-functions package is installed
echo "✓ Checking durable-functions package..."
if grep -q '"durable-functions"' package.json; then
    VERSION=$(grep '"durable-functions"' package.json | sed 's/.*: "//;s/".*//')
    echo "  ✓ durable-functions package installed: $VERSION"
else
    echo "  ✗ durable-functions package NOT found in package.json"
    exit 1
fi
echo ""

# Check 2: Verify host.json has durableTask configuration
echo "✓ Checking host.json configuration..."
if grep -q '"durableTask"' host.json; then
    echo "  ✓ durableTask extension configured in host.json"
    
    # Extract task hub name
    HUB_NAME=$(grep -A 1 '"durableTask"' host.json | grep '"hubName"' | sed 's/.*: "//;s/".*//')
    if [ -n "$HUB_NAME" ]; then
        echo "  ✓ Task hub name: $HUB_NAME"
    fi
    
    # Check storage provider
    if grep -q '"storageProvider"' host.json; then
        echo "  ✓ Storage provider configured"
        CONNECTION=$(grep -A 2 '"storageProvider"' host.json | grep '"connectionStringName"' | sed 's/.*: "//;s/".*//')
        if [ -n "$CONNECTION" ]; then
            echo "  ✓ Storage connection: $CONNECTION"
        fi
    fi
else
    echo "  ✗ durableTask extension NOT configured in host.json"
    exit 1
fi
echo ""

# Check 3: Verify test orchestrator exists
echo "✓ Checking test orchestrator..."
if [ -f "src/functions/testDurableOrchestrator.ts" ]; then
    echo "  ✓ Test orchestrator file exists"
    
    # Check for proper imports
    if grep -q "from 'durable-functions'" src/functions/testDurableOrchestrator.ts; then
        echo "  ✓ Durable Functions imports found"
    fi
    
    # Check for orchestrator registration
    if grep -q "df.app.orchestration" src/functions/testDurableOrchestrator.ts; then
        echo "  ✓ Orchestrator registration found"
    fi
    
    # Check for activity registration
    if grep -q "df.app.activity" src/functions/testDurableOrchestrator.ts; then
        echo "  ✓ Activity registration found"
    fi
else
    echo "  ✗ Test orchestrator file NOT found"
    exit 1
fi
echo ""

# Check 4: Verify TypeScript compilation
echo "✓ Checking TypeScript compilation..."
if [ -d "dist/src/functions" ]; then
    if [ -f "dist/src/functions/testDurableOrchestrator.js" ]; then
        echo "  ✓ Test orchestrator compiled successfully"
    else
        echo "  ⚠ Test orchestrator not yet compiled (run 'npm run build')"
    fi
else
    echo "  ⚠ dist directory not found (run 'npm run build')"
fi
echo ""

# Check 5: Verify Azure Functions Core Tools (optional)
echo "✓ Checking Azure Functions Core Tools..."
if command -v func &> /dev/null; then
    FUNC_VERSION=$(func --version)
    echo "  ✓ Azure Functions Core Tools installed: $FUNC_VERSION"
else
    echo "  ⚠ Azure Functions Core Tools not found (optional for local testing)"
fi
echo ""

# Summary
echo "=========================================="
echo "Verification Summary"
echo "=========================================="
echo ""
echo "Configuration Status: ✓ READY"
echo ""
echo "Next Steps:"
echo "1. Set AzureWebJobsStorage environment variable"
echo "2. Run 'npm start' to start the Functions host"
echo "3. Test the orchestrator: curl http://localhost:7071/api/test/durable"
echo "4. Check Azure Storage for task hub tables (CaptureTaskHub*)"
echo ""
echo "Task Hub Tables to verify in Azure Storage:"
echo "  - ${HUB_NAME}History"
echo "  - ${HUB_NAME}Instances"
echo "  - ${HUB_NAME}WorkItems"
echo ""
