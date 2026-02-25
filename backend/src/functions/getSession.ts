/**
 * Get Session API Endpoint - REFACTORED (Self-contained)
 * No external service dependencies
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseUserPrincipal, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
// Inline types
interface Session {
  partitionKey: string;
  rowKey: string;
  teacherId: string;
  classId: string;
  courseName?: string; // Legacy field
  status: 'ACTIVE' | 'ENDED';
  startAt: string; // ISO string
  endAt: string; // ISO string
  startTime?: number; // Legacy field
  endTime?: number; // Legacy field
  timestamp?: Date;
  etag?: string;
}

interface AttendanceRecord {
  partitionKey: string;
  rowKey: string;
  studentId: string;
  entryStatus: string;
  entryAt?: number;
  exitVerified?: boolean;
  exitedAt?: number;
}

interface Chain {
  partitionKey: string;
  rowKey: string;
  phase: string;
  currentToken: string;
  index?: number;
  state?: string;
  lastHolder?: string;
  lastSeq?: number;
  lastAt?: number;
}

// Inline table client creation
export async function getSession(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing GET /api/sessions/{sessionId} request');

  try {
    // Parse authentication
    const principalHeader = request.headers.get('x-ms-client-principal') || request.headers.get('x-client-principal');
    if (!principalHeader) {
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Missing authentication header', timestamp: Date.now() } }
      };
    }

    const principal = parseUserPrincipal(principalHeader);
    const userId = getUserId(principal);
    const isTeacher = hasRole(principal, 'Teacher');

    // Get sessionId
    const sessionId = request.params.sessionId;
    if (!sessionId) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing sessionId', timestamp: Date.now() } }
      };
    }

    // Get session from storage
    const sessionsTable = getTableClient(TableNames.SESSIONS);
    let session: Session;
    
    try {
      const entity = await sessionsTable.getEntity('SESSION', sessionId);
      session = entity as unknown as Session;
    } catch (error: any) {
      if (error.statusCode === 404) {
        return {
          status: 404,
          jsonBody: { error: { code: 'NOT_FOUND', message: 'Session not found', timestamp: Date.now() } }
        };
      }
      throw error;
    }

    // Check ownership for teachers
    if (isTeacher && session.teacherId !== userId) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'You do not own this session', timestamp: Date.now() } }
      };
    }

    // Get attendance records
    const attendanceTable = getTableClient(TableNames.ATTENDANCE);
    const attendance: AttendanceRecord[] = [];
    const now = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
    const onlineThreshold = 30; // Consider online if seen in last 30 seconds
    
    for await (const entity of attendanceTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${sessionId}'` } })) {
      const record = entity as any;
      
      // Check if student is online based on lastSeen timestamp only
      const lastSeen = record.lastSeen ? (record.lastSeen as number) : 0;
      const isRecentlyActive = lastSeen > 0 && (now - lastSeen) < onlineThreshold;
      
      attendance.push({
        ...record,
        isOnline: isRecentlyActive, // Only use timestamp, ignore the isOnline flag
        // Use joinedAt if available, otherwise fall back to Timestamp (for existing records)
        joinedAt: record.joinedAt || (record.timestamp ? Math.floor(new Date(record.timestamp).getTime() / 1000) : undefined)
      } as unknown as AttendanceRecord);
    }

    // Get chains
    const chainsTable = getTableClient(TableNames.CHAINS);
    const chains: Chain[] = [];
    
    for await (const entity of chainsTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${sessionId}'` } })) {
      chains.push(entity as unknown as Chain);
    }
    
    context.log(`Fetched ${chains.length} chains for session ${sessionId}`);
    chains.forEach(c => {
      context.log(`Chain ${c.rowKey}: lastHolder=${c.lastHolder}, lastSeq=${c.lastSeq}, state=${c.state}`);
    });

    // Get active tokens to identify current holders
    const tokensTable = getTableClient(TableNames.TOKENS);
    const activeHolders = new Set<string>();
    
    for await (const token of tokensTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${sessionId}'` } })) {
      // Check if token is still valid
      if (token.expiresAt && (token.expiresAt as number) > now) {
        activeHolders.add(token.holderId as string);
      }
    }

    // Calculate stats
    const stats = {
      totalStudents: attendance.length,
      onlineStudents: attendance.filter(a => (a as any).isOnline).length,
      presentEntry: attendance.filter(a => a.entryStatus === 'PRESENT_ENTRY').length,
      lateEntry: attendance.filter(a => a.entryStatus === 'LATE_ENTRY').length,
      earlyLeave: attendance.filter(a => a.exitedAt && a.exitedAt < (session.endTime || 0)).length,
      exitVerified: attendance.filter(a => a.exitVerified).length,
      notYetVerified: attendance.filter(a => !a.exitVerified).length,
      activeHolders: activeHolders.size
    };

    // Helper to safely convert timestamp to ISO string
    const toISOString = (timestamp: number | undefined): string | undefined => {
      if (!timestamp || isNaN(timestamp)) return undefined;
      try {
        return new Date(timestamp * 1000).toISOString();
      } catch {
        return undefined;
      }
    };

    // Build response
    const response: any = {
      session: {
        sessionId: session.rowKey,
        classId: session.classId || session.courseName, // Support both new and legacy field names
        teacherId: session.teacherId,
        startAt: session.startAt || toISOString(session.startTime) || new Date().toISOString(),
        endAt: session.endAt || toISOString(session.endTime),
        lateCutoffMinutes: 15, // Default value
        exitWindowMinutes: 30, // Default value
        status: session.status,
        ownerTransfer: false,
        lateEntryActive: false,
        earlyLeaveActive: false,
        createdAt: session.startAt || toISOString(session.startTime) || new Date().toISOString()
      },
      attendance: attendance.map(a => ({
        sessionId,
        studentId: a.studentId || a.rowKey, // Use rowKey (email) as fallback
        entryStatus: a.entryStatus,
        entryMethod: (a as any).entryMethod, // DIRECT_QR or CHAIN
        entryAt: a.entryAt, // Use entryAt directly from database
        exitVerified: a.exitVerified || false,
        exitMethod: (a as any).exitMethod, // DIRECT_QR or CHAIN
        exitedAt: (a as any).exitedAt, // Exit timestamp
        joinedAt: (a as any).joinedAt, // Include join timestamp
        locationWarning: (a as any).locationWarning,
        locationDistance: (a as any).locationDistance,
        isOnline: (a as any).isOnline || false,
        isHolder: activeHolders.has(a.studentId || a.rowKey) // Check if student is a current holder
      })),
      chains: chains.map(c => ({
        sessionId,
        phase: c.phase,
        chainId: c.rowKey,
        index: c.index || 0,
        state: c.state || 'ACTIVE',
        lastHolder: c.lastHolder,
        lastSeq: c.lastSeq || 0,
        lastAt: c.lastAt
      })),
      stats
    };

    return {
      status: 200,
      jsonBody: response
    };

  } catch (error: any) {
    context.error('Error getting session:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get session',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('getSession', {
  methods: ['GET'],
  route: 'sessions/{sessionId}',
  authLevel: 'anonymous',
  handler: getSession
});
