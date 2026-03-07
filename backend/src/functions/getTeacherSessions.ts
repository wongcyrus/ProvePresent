/**
 * Get Teacher Sessions API Endpoint
 * Returns all sessions created by a specific teacher
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import { getCoTeachers } from '../utils/sessionAccess';
// Inline types
interface Session {
  partitionKey: string;
  rowKey: string;
  teacherId: string;
  classId?: string;        // New field name
  courseName?: string;     // Legacy field name
  status: 'ACTIVE' | 'ENDED';
  startAt?: string;        // New field name
  startTime?: number;      // Legacy field name
  endAt?: string;          // New field name
  endTime?: number;        // Legacy field name
  timestamp?: Date;
  etag?: string;
}

// Assign roles based on email domain
// Inline table client creation - ISOLATED from any request context
export async function getTeacherSessions(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing GET /api/sessions/teacher/{teacherId} request');
  context.log('Request URL:', request.url);
  context.log('Request params:', JSON.stringify(request.params));

  try {
    // Parse authentication
    const principal = parseAuthFromRequest(request);
    if (!principal) {
      context.log('Missing authentication');
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Missing authentication header', timestamp: Date.now() } }
      };
    }

    const userId = getUserId(principal);
    const isTeacher = hasRole(principal, 'teacher') || hasRole(principal, 'Teacher');
    
    context.log('User ID:', userId);
    context.log('Is teacher:', isTeacher);
    context.log('User roles:', principal.userRoles);

    // Check if user is a teacher
    if (!isTeacher) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Only teachers can access this endpoint', timestamp: Date.now() } }
      };
    }

    // Get teacherId from query parameter instead of route
    const teacherId = request.query.get('teacherId');
    context.log('TeacherId from query:', teacherId);
    
    if (!teacherId) {
      context.log('ERROR: Missing teacherId query parameter');
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing teacherId query parameter', timestamp: Date.now() } }
      };
    }

    // Verify the teacher is requesting their own sessions
    if (teacherId !== userId) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'You can only access your own sessions', timestamp: Date.now() } }
      };
    }

    // Get sessions from storage (owned + shared with this teacher)
    const ownedSessions: (Session & { isShared?: boolean })[] = [];
    const sharedSessions: (Session & { isShared?: boolean })[] = [];
    
    context.log('Querying sessions table for teacherId:', teacherId);
    
    try {
      const sessionsTable = getTableClient(TableNames.SESSIONS);
      context.log('Table client created successfully');
      
      // Query all sessions and filter by teacherId or coTeachers
      let entityCount = 0;
      const teacherIdLower = teacherId.toLowerCase();
      
      for await (const entity of sessionsTable.listEntities({ 
        queryOptions: { filter: `PartitionKey eq 'SESSION'` } 
      })) {
        entityCount++;
        const session = entity as unknown as Session;
        
        // Check if teacher owns this session
        if (session.teacherId === teacherId) {
          ownedSessions.push({ ...session, isShared: false });
        } else {
          // Check if teacher is a co-teacher
          const coTeachers = getCoTeachers(session);
          if (coTeachers.some(ct => ct.toLowerCase() === teacherIdLower)) {
            sharedSessions.push({ ...session, isShared: true });
          }
        }
      }
      
      context.log('Total entities scanned:', entityCount);
      context.log('Found owned sessions:', ownedSessions.length);
      context.log('Found shared sessions:', sharedSessions.length);
    } catch (storageError: any) {
      context.error('Storage query error:', storageError);
      context.error('Error name:', storageError.name);
      context.error('Error code:', storageError.code);
      context.error('Error message:', storageError.message);
      
      // Return empty sessions instead of error (graceful degradation)
      context.log('Returning empty sessions due to storage error');
    }

    // Combine owned and shared sessions
    const sessions = [...ownedSessions, ...sharedSessions];

    // Sort by start time (most recent first)
    sessions.sort((a, b) => {
      const aTime = a.startTime || (a.startAt ? new Date(a.startAt).getTime() / 1000 : 0);
      const bTime = b.startTime || (b.startAt ? new Date(b.startAt).getTime() / 1000 : 0);
      return bTime - aTime;
    });

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
    const response = {
      sessions: sessions.map(s => ({
        sessionId: s.rowKey,
        classId: s.classId || s.courseName,  // Support both field names for backward compatibility
        teacherId: s.teacherId,
        coTeachers: getCoTeachers(s),
        status: s.status,
        startAt: s.startAt || toISOString(s.startTime) || new Date().toISOString(),
        endAt: s.endAt || toISOString(s.endTime),
        isShared: (s as any).isShared || false  // Indicates if this is a shared session
      }))
    };

    return {
      status: 200,
      jsonBody: response
    };

  } catch (error: any) {
    context.error('Error getting teacher sessions:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get teacher sessions',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('getTeacherSessions', {
  methods: ['GET'],
  route: 'teacher/sessions',
  authLevel: 'anonymous',
  handler: getTeacherSessions
});
