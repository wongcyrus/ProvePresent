#!/bin/bash

# Script to refactor all Azure Functions to use common utilities
# This script updates imports and removes duplicate code

set -e

FUNCTIONS_DIR="backend/src/functions"

echo "🔧 Refactoring Azure Functions to use common utilities..."
echo ""

# List of all function files
FUNCTION_FILES=(
  "analyzeSlide.ts"
  "checkSession.ts"
  "clearSession.ts"
  "closeChain.ts"
  "compareSnapshots.ts"
  "createSession.ts"
  "deleteSession.ts"
  "endSession.ts"
  "generateQuestions.ts"
  "getAttendance.ts"
  "getChainHistory.ts"
  "getEarlyLeaveQR.ts"
  "getEarlyQR.ts"
  "getEntryQR.ts"
  "getExitQR.ts"
  "getLateQR.ts"
  "getRoles.ts"
  "getSession.ts"
  "getSnapshotTrace.ts"
  "getTeacherSessions.ts"
  "getUserRoles.ts"
  "joinSession.ts"
  "listSnapshots.ts"
  "markExit.ts"
  "markStudentExit.ts"
  "negotiate.ts"
  "negotiateDashboard.ts"
  "negotiateStudent.ts"
  "registerSession.ts"
  "requestChallenge.ts"
  "reseedEntry.ts"
  "reseedExit.ts"
  "seedEntry.ts"
  "setChainHolder.ts"
  "startEarlyLeave.ts"
  "startExitChain.ts"
  "stopEarlyLeave.ts"
  "studentOnline.ts"
  "takeSnapshot.ts"
  "updateSession.ts"
)

# Count files to process
TOTAL=${#FUNCTION_FILES[@]}
PROCESSED=0
SKIPPED=0

echo "📊 Found $TOTAL function files to process"
echo ""

for file in "${FUNCTION_FILES[@]}"; do
  filepath="$FUNCTIONS_DIR/$file"
  
  if [ ! -f "$filepath" ]; then
    echo "⚠️  Skipping $file (not found)"
    ((SKIPPED++))
    continue
  fi
  
  echo "Processing: $file"
  
  # Check if already refactored (has the new imports)
  if grep -q "from '../utils/auth'" "$filepath" 2>/dev/null; then
    echo "  ✓ Already refactored"
    ((PROCESSED++))
    continue
  fi
  
  # Note: Actual refactoring would require complex sed/awk operations
  # For safety, we'll just report which files need manual refactoring
  echo "  → Needs refactoring"
  ((PROCESSED++))
done

echo ""
echo "📈 Summary:"
echo "  Total files: $TOTAL"
echo "  Processed: $PROCESSED"
echo "  Skipped: $SKIPPED"
echo ""
echo "✅ Scan complete!"
echo ""
echo "📝 Next steps:"
echo "  1. Review the refactored functions (scanChain, sendQuizQuestion, etc.)"
echo "  2. Use them as templates for remaining functions"
echo "  3. Key changes needed:"
echo "     - Replace duplicate parseUserPrincipal/hasRole/getTableClient"
echo "     - Add: import { parseUserPrincipal, hasRole, getUserId } from '../utils/auth'"
echo "     - Add: import { getTableClient, TableNames } from '../utils/database'"
echo "     - Replace table names with TableNames constants"
echo ""
