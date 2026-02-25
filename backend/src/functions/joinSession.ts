/**
 * Join Session API Endpoint - REFACTORED (Self-contained)
 * No external service dependencies
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseUserPrincipal, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import * as crypto from 'crypto';
import { validateGeolocation } from '../utils/geolocation';

function decryptToken(encryptedToken: string): any {
  try {
    const secret = process.env.QR_ENCRYPTION_KEY || 'default-secret-key-change-in-production';
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(secret, 'salt', 32);
    
    const parts = encryptedToken.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid token format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  } catch (error) {
    throw new Error('Failed to decrypt token');
  }
}

export async function joinSession(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/sessions/{sessionId}/join request');

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
    
    context.log('User principal:', JSON.stringify(principal, null, 2));
    
    // Require Student role
    if (!hasRole(principal, 'Student') && !hasRole(principal, 'student')) {
      context.log('Access denied: User does not have Student role');
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Student role required', timestamp: Date.now() } }
      };
    }
    
    context.log('Student role verified for user:', getUserId(principal));

    const studentId = getUserId(principal);
    const sessionId = request.params.sessionId;
    
    if (!sessionId) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing sessionId', timestamp: Date.now() } }
      };
    }

    // Parse request body for token validation and location
    let token: string | undefined;
    let studentLocation: { latitude: number; longitude: number; accuracy?: number } | undefined;
    try {
      const body = await request.json() as any;
      token = body?.token;
      studentLocation = body?.location;
    } catch {
      // No body or invalid JSON - token is optional for backward compatibility
    }

    // If token is provided, decrypt and validate it
    if (token) {
      try {
        const tokenData = decryptToken(token);
        
        // Verify token type
        if (tokenData.type !== 'ENTRY') {
          return {
            status: 403,
            jsonBody: { error: { code: 'INVALID_TOKEN_TYPE', message: 'Token is not an entry token', timestamp: Date.now() } }
          };
        }
        
        // Verify session ID matches
        if (tokenData.sessionId !== sessionId) {
          return {
            status: 403,
            jsonBody: { error: { code: 'SESSION_MISMATCH', message: 'Token session does not match', timestamp: Date.now() } }
          };
        }
        
        // Check if token is expired (20 seconds validity)
        const now = Math.floor(Date.now() / 1000);
        if (tokenData.expiresAt < now) {
          return {
            status: 403,
            jsonBody: { error: { code: 'TOKEN_EXPIRED', message: 'Entry token has expired', timestamp: Date.now() } }
          };
        }
      } catch (error: any) {
        return {
          status: 403,
          jsonBody: { error: { code: 'INVALID_TOKEN', message: 'Invalid or corrupted entry token', timestamp: Date.now() } }
        };
      }
    }

    // Verify session exists and get geolocation settings
    const sessionsTable = getTableClient(TableNames.SESSIONS);
    let session;
    try {
      session = await sessionsTable.getEntity('SESSION', sessionId);
    } catch (error: any) {
      if (error.statusCode === 404) {
        return {
          status: 404,
          jsonBody: { error: { code: 'NOT_FOUND', message: 'Session not found', timestamp: Date.now() } }
        };
      }
      throw error;
    }

    // Parse geolocation settings
    let sessionLocation: { latitude: number; longitude: number } | undefined;
    if (session.location) {
      try {
        sessionLocation = typeof session.location === 'string' 
          ? JSON.parse(session.location as string)
          : session.location;
      } catch {
        // Invalid location format, ignore
      }
    }
    const geofenceRadius = session.geofenceRadius as number | undefined;
    const enforceGeofence = session.enforceGeofence as boolean | undefined;

    // Validate geolocation
    const geoCheck = validateGeolocation(
      sessionLocation,
      geofenceRadius,
      enforceGeofence,
      studentLocation
    );

    const missingLocationWarning = !studentLocation ? 'Location not provided' : undefined;
    if (missingLocationWarning) {
      context.warn(`Join without location: student=${studentId}, session=${sessionId}`);
    }

    const locationWarning = geoCheck.warning || missingLocationWarning;

    // Block entry if geofence is enforced and student is out of bounds
    if (geoCheck.shouldBlock) {
      return {
        status: 403,
        jsonBody: {
          error: {
            code: 'GEOFENCE_VIOLATION',
            message: geoCheck.warning || 'You are outside the allowed area for this class',
            details: geoCheck.distance ? `Distance: ${Math.round(geoCheck.distance)}m` : undefined,
            timestamp: Date.now()
          }
        }
      };
    }

    // Create or check attendance record
    const attendanceTable = getTableClient(TableNames.ATTENDANCE);
    
    try {
      // Check if already enrolled
      await attendanceTable.getEntity(sessionId, studentId);
      
      if (locationWarning) {
        await attendanceTable.updateEntity({
          partitionKey: sessionId,
          rowKey: studentId,
          locationWarning,
          locationDistance: geoCheck.distance
        }, 'Merge');
      }

      return {
        status: 200,
        jsonBody: {
          success: true,
          sessionId,
          studentId,
          message: 'Already enrolled in session',
          locationWarning
        }
      };
    } catch (error: any) {
      if (error.statusCode === 404) {
        // Create new enrollment with join timestamp and location data
        const joinTimestamp = Math.floor(Date.now() / 1000);
        const entity: any = {
          partitionKey: sessionId,
          rowKey: studentId,
          exitVerified: false,
          joinedAt: joinTimestamp,
          entryStatus: 'PRESENT_ENTRY', // Set entry status for quiz system
          isOnline: true,
          lastSeen: joinTimestamp
        };

        // Save location data if provided
        if (studentLocation) {
          entity.joinLocation = JSON.stringify(studentLocation);
        }

        // Add warning flag if out of geofence (but not blocked)
        if (locationWarning) {
          entity.locationWarning = locationWarning;
          entity.locationDistance = geoCheck.distance;
        }
        
        await attendanceTable.createEntity(entity);
        
        return {
          status: 201,
          jsonBody: {
            success: true,
            sessionId,
            studentId,
            message: 'Successfully enrolled in session',
            locationWarning
          }
        };
      }
      throw error;
    }

  } catch (error: any) {
    context.error('Error joining session:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to join session',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('joinSession', {
  methods: ['POST'],
  route: 'sessions/{sessionId}/join',
  authLevel: 'anonymous',
  handler: joinSession
});
