/**
 * Create Session API Endpoint - REFACTORED (Self-contained)
 * No external service dependencies
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import { randomUUID } from 'crypto';

// Inline types
interface CreateSessionRequest {
  classId: string;
  startAt: string;
  endAt: string;
  lateCutoffMinutes: number;
  exitWindowMinutes?: number;
  constraints?: any;
  isRecurring?: boolean;
  recurrencePattern?: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  recurrenceEndDate?: string;
  // Geolocation fields
  location?: {
    latitude: number;
    longitude: number;
  };
  geofenceRadius?: number;
  enforceGeofence?: boolean;
}

interface CreateSessionResponse {
  sessionIds: string[];
  count: number;
  parentSessionId?: string;
  sessionQR?: string;
}

// Calculate recurring session dates
function calculateRecurrenceDates(
  startAt: string,
  endAt: string,
  pattern: 'DAILY' | 'WEEKLY' | 'MONTHLY',
  endDate: string
): Array<{ startAt: string; endAt: string }> {
  const dates: Array<{ startAt: string; endAt: string }> = [];
  const recurrenceEnd = new Date(endDate);
  
  let current = new Date(startAt);
  const startTime = new Date(startAt);
  const endTime = new Date(endAt);
  const baseDuration = endTime.getTime() - startTime.getTime();
  
  // Add first occurrence
  dates.push({
    startAt: startAt,
    endAt: endAt
  });
  
  // Generate subsequent occurrences
  while (true) {
    switch (pattern) {
      case 'DAILY':
        current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
        break;
      case 'WEEKLY':
        current = new Date(current.getTime() + 7 * 24 * 60 * 60 * 1000);
        break;
      case 'MONTHLY':
        const nextMonth = new Date(current);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        current = nextMonth;
        break;
    }
    
    if (current > recurrenceEnd) break;
    
    const occurrenceEnd = new Date(current.getTime() + baseDuration);
    dates.push({
      startAt: current.toISOString(),
      endAt: occurrenceEnd.toISOString()
    });
  }
  
  return dates;
}

export async function createSession(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/sessions request');

  try {
    // Parse authentication
    const principal = parseAuthFromRequest(request);
    if (!principal) {
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Missing authentication header', timestamp: Date.now() } }
      };
    }    
    // Require Teacher role
    if (!hasRole(principal, 'Teacher') && !hasRole(principal, 'teacher')) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Teacher role required', timestamp: Date.now() } }
      };
    }

    // Parse request body
    const body = await request.json() as CreateSessionRequest;

    // Validate required fields
    if (!body.classId || !body.startAt || !body.endAt || body.lateCutoffMinutes === undefined) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing required fields', timestamp: Date.now() } }
      };
    }

    // Validate recurring fields if isRecurring is true
    if (body.isRecurring && (!body.recurrencePattern || !body.recurrenceEndDate)) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'recurrencePattern and recurrenceEndDate required for recurring sessions', timestamp: Date.now() } }
      };
    }

    const teacherId = getUserId(principal);
    const now = new Date().toISOString();
    const sessionsTable = getTableClient(TableNames.SESSIONS);
    
    const createdSessionIds: string[] = [];
    let parentSessionId: string | undefined;

    // Calculate recurring dates if needed
    let sessionDates: Array<{ startAt: string; endAt: string }> = [
      { startAt: body.startAt, endAt: body.endAt }
    ];

    if (body.isRecurring && body.recurrencePattern && body.recurrenceEndDate) {
      sessionDates = calculateRecurrenceDates(
        body.startAt,
        body.endAt,
        body.recurrencePattern,
        body.recurrenceEndDate
      );
      parentSessionId = randomUUID();
    }

    // Create session entities (single or multiple for recurring)
    for (let i = 0; i < sessionDates.length; i++) {
      const sessionId = randomUUID();
      
      if (i === 0) {
        parentSessionId = sessionId;
      }

      const entity = {
        partitionKey: 'SESSION',
        rowKey: sessionId,
        classId: body.classId,
        teacherId,
        startAt: sessionDates[i].startAt,
        endAt: sessionDates[i].endAt,
        lateCutoffMinutes: body.lateCutoffMinutes,
        exitWindowMinutes: body.exitWindowMinutes ?? 10,
        status: 'ACTIVE',
        ownerTransfer: true,
        constraints: body.constraints ? JSON.stringify(body.constraints) : undefined,
        lateEntryActive: false,
        earlyLeaveActive: false,
        isRecurring: body.isRecurring ?? false,
        recurrencePattern: body.recurrencePattern,
        parentSessionId: body.isRecurring ? parentSessionId : undefined,
        occurrenceNumber: body.isRecurring ? i + 1 : undefined,
        createdAt: now,
        // Geolocation fields
        location: body.location ? JSON.stringify(body.location) : undefined,
        geofenceRadius: body.geofenceRadius,
        enforceGeofence: body.enforceGeofence ?? false
      };

      await sessionsTable.createEntity(entity);
      createdSessionIds.push(sessionId);
    }

    // Generate Session QR for first session
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
    const sessionQR = `${baseUrl}/student?sessionId=${createdSessionIds[0]}`;

    const response: CreateSessionResponse = {
      sessionIds: createdSessionIds,
      count: createdSessionIds.length,
      parentSessionId: body.isRecurring ? parentSessionId : undefined,
      sessionQR
    };

    return {
      status: 201,
      jsonBody: response
    };

  } catch (error: any) {
    context.error('Error creating session:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create session',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('createSession', {
  methods: ['POST'],
  route: 'sessions',
  authLevel: 'anonymous',
  handler: createSession
});
