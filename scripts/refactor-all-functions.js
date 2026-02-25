#!/usr/bin/env node

/**
 * Automated refactoring script for Azure Functions
 * Replaces duplicate utility functions with imports from common modules
 */

const fs = require('fs');
const path = require('path');

const FUNCTIONS_DIR = path.join(__dirname, '../backend/src/functions');

// Functions to refactor
const functionsToRefactor = [
  'analyzeSlide.ts',
  'checkSession.ts',
  'clearSession.ts',
  'closeChain.ts',
  'compareSnapshots.ts',
  'createSession.ts',
  'deleteSession.ts',
  'endSession.ts',
  'generateQuestions.ts',
  'getAttendance.ts',
  'getChainHistory.ts',
  'getEarlyLeaveQR.ts',
  'getEarlyQR.ts',
  'getEntryQR.ts',
  'getExitQR.ts',
  'getLateQR.ts',
  'getSession.ts',
  'getSnapshotTrace.ts',
  'getStudentToken.ts',
  'getTeacherSessions.ts',
  'joinSession.ts',
  'listSnapshots.ts',
  'markExit.ts',
  'markStudentExit.ts',
  'negotiate.ts',
  'negotiateDashboard.ts',
  'negotiateStudent.ts',
  'registerSession.ts',
  'requestChallenge.ts',
  'reseedEntry.ts',
  'reseedExit.ts',
  'seedEntry.ts',
  'setChainHolder.ts',
  'startEarlyLeave.ts',
  'startExitChain.ts',
  'stopEarlyLeave.ts',
  'studentOnline.ts',
  'takeSnapshot.ts',
  'updateSession.ts'
];

// Patterns to remove
const PATTERNS_TO_REMOVE = [
  // parseUserPrincipal function
  /\/\/ Inline helper functions\s*\n/g,
  /function parseUserPrincipal\(header: string\): any \{\s*try \{\s*const decoded = Buffer\.from\(header, 'base64'\)\.toString\('utf-8'\);\s*return JSON\.parse\(decoded\);\s*\} catch \{\s*throw new Error\('Invalid authentication header'\);\s*\}\s*\}\s*/gs,
  /function parseUserPrincipal\(header: string\): any \{\s*const decoded = Buffer\.from\(header, 'base64'\)\.toString\('utf-8'\);\s*return JSON\.parse\(decoded\);\s*\}\s*/gs,
  
  // getUserId function
  /function getUserId\(principal: any\): string \{\s*return principal\.userDetails \|\| principal\.userId;\s*\}\s*/gs,
  
  // hasRole function (multiple variations)
  /function hasRole\(principal: any, role: string\): boolean \{[\s\S]*?\n\}\s*/g,
  
  // getRolesFromEmail function
  /function getRolesFromEmail\(email: string\): string\[\] \{[\s\S]*?\n\}\s*/g,
  
  // getTableClient function
  /function getTableClient\(tableName: string\): TableClient \{[\s\S]*?\n\}\s*/g,
];

// Table name replacements
const TABLE_REPLACEMENTS = [
  { from: "'Sessions'", to: 'TableNames.SESSIONS' },
  { from: '"Sessions"', to: 'TableNames.SESSIONS' },
  { from: "'Attendance'", to: 'TableNames.ATTENDANCE' },
  { from: '"Attendance"', to: 'TableNames.ATTENDANCE' },
  { from: "'Chains'", to: 'TableNames.CHAINS' },
  { from: '"Chains"', to: 'TableNames.CHAINS' },
  { from: "'Tokens'", to: 'TableNames.TOKENS' },
  { from: '"Tokens"', to: 'TableNames.TOKENS' },
  { from: "'UserSessions'", to: 'TableNames.USER_SESSIONS' },
  { from: '"UserSessions"', to: 'TableNames.USER_SESSIONS' },
  { from: "'AttendanceSnapshots'", to: 'TableNames.ATTENDANCE_SNAPSHOTS' },
  { from: '"AttendanceSnapshots"', to: 'TableNames.ATTENDANCE_SNAPSHOTS' },
  { from: "'ChainHistory'", to: 'TableNames.CHAIN_HISTORY' },
  { from: '"ChainHistory"', to: 'TableNames.CHAIN_HISTORY' },
  { from: "'ScanLogs'", to: 'TableNames.SCAN_LOGS' },
  { from: '"ScanLogs"', to: 'TableNames.SCAN_LOGS' },
  { from: "'DeletionLog'", to: 'TableNames.DELETION_LOG' },
  { from: '"DeletionLog"', to: 'TableNames.DELETION_LOG' },
  { from: "'QuizQuestions'", to: 'TableNames.QUIZ_QUESTIONS' },
  { from: '"QuizQuestions"', to: 'TableNames.QUIZ_QUESTIONS' },
  { from: "'QuizResponses'", to: 'TableNames.QUIZ_RESPONSES' },
  { from: '"QuizResponses"', to: 'TableNames.QUIZ_RESPONSES' },
  { from: "'QuizMetrics'", to: 'TableNames.QUIZ_METRICS' },
  { from: '"QuizMetrics"', to: 'TableNames.QUIZ_METRICS' },
];

function refactorFunction(filename) {
  const filepath = path.join(FUNCTIONS_DIR, filename);
  
  if (!fs.existsSync(filepath)) {
    console.log(`⚠️  Skipping ${filename} (not found)`);
    return false;
  }
  
  let content = fs.readFileSync(filepath, 'utf8');
  const originalContent = content;
  
  // Check if already refactored
  if (content.includes("from '../utils/auth'")) {
    console.log(`✓ ${filename} already refactored`);
    return false;
  }
  
  // Remove duplicate functions
  for (const pattern of PATTERNS_TO_REMOVE) {
    content = content.replace(pattern, '');
  }
  
  // Remove TableClient import if present (we'll add it back with database utils)
  content = content.replace(/import \{ TableClient \} from '@azure\/data-tables';\s*\n/g, '');
  
  // Add new imports after the first import statement
  const firstImportMatch = content.match(/^import .* from .*;$/m);
  if (firstImportMatch) {
    const insertPosition = content.indexOf(firstImportMatch[0]) + firstImportMatch[0].length;
    
    // Check what utilities are needed
    const needsAuth = originalContent.includes('parseUserPrincipal') || 
                      originalContent.includes('hasRole') || 
                      originalContent.includes('getUserId');
    const needsDatabase = originalContent.includes('getTableClient');
    
    let importsToAdd = '';
    if (needsAuth) {
      importsToAdd += "\nimport { parseUserPrincipal, hasRole, getUserId } from '../utils/auth';";
    }
    if (needsDatabase) {
      importsToAdd += "\nimport { getTableClient, TableNames } from '../utils/database';";
    }
    
    if (importsToAdd) {
      content = content.slice(0, insertPosition) + importsToAdd + content.slice(insertPosition);
    }
  }
  
  // Replace table names with constants
  for (const { from, to } of TABLE_REPLACEMENTS) {
    const regex = new RegExp(`getTableClient\\(${from}\\)`, 'g');
    content = content.replace(regex, `getTableClient(${to})`);
  }
  
  // Clean up extra blank lines
  content = content.replace(/\n\n\n+/g, '\n\n');
  
  // Only write if content changed
  if (content !== originalContent) {
    fs.writeFileSync(filepath, content, 'utf8');
    console.log(`✅ ${filename} refactored`);
    return true;
  }
  
  return false;
}

// Main execution
console.log('🔧 Starting automated refactoring...\n');

let refactored = 0;
let skipped = 0;
let errors = 0;

for (const filename of functionsToRefactor) {
  try {
    if (refactorFunction(filename)) {
      refactored++;
    } else {
      skipped++;
    }
  } catch (error) {
    console.error(`❌ Error refactoring ${filename}:`, error.message);
    errors++;
  }
}

console.log('\n📊 Summary:');
console.log(`  Refactored: ${refactored}`);
console.log(`  Skipped: ${skipped}`);
console.log(`  Errors: ${errors}`);
console.log(`  Total: ${functionsToRefactor.length}`);

if (errors === 0) {
  console.log('\n✅ Refactoring complete! Run "npm run build" to verify.');
} else {
  console.log('\n⚠️  Some errors occurred. Please review manually.');
  process.exit(1);
}
