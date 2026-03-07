/**
 * Mark Exit - REFACTORED (Self-contained)
 * Validates encrypted exit token and marks student as exited
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import * as crypto from 'crypto';
import { broadcastAttendanceUpdate } from '../utils/signalrBroadcast';

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

export async function markExit(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/sessions/{sessionId}/exit request');

  try {
    // Parse authentication
    const principal = parseAuthFromRequest(request);
    if (!principal) {
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Missing authentication header', timestamp: Date.now() } }
      };
    }    
    // Require Student role
    if (!hasRole(principal, 'Student') && !hasRole(principal, 'student')) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Student role required', timestamp: Date.now() } }
      };
    }

    const studentId = getUserId(principal);
    const sessionId = request.params.sessionId;
    
    if (!sessionId) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing sessionId', timestamp: Date.now() } }
      };
    }

    // Parse request body for token
    let token: string | undefined;
    try {
      const body = await request.json() as any;
      token = body?.token;
    } catch {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing token in request body', timestamp: Date.now() } }
      };
    }

    if (!token) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Exit token is required', timestamp: Date.now() } }
      };
    }

    // Decrypt and validate exit token
    try {
      const tokenData = decryptToken(token);
      
      // Verify token type
      if (tokenData.type !== 'EXIT') {
        return {
          status: 403,
          jsonBody: { error: { code: 'INVALID_TOKEN_TYPE', message: 'Token is not an exit token', timestamp: Date.now() } }
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
          jsonBody: { error: { code: 'TOKEN_EXPIRED', message: 'Exit token has expired', timestamp: Date.now() } }
        };
      }
    } catch (error: any) {
      return {
        status: 403,
        jsonBody: { error: { code: 'INVALID_TOKEN', message: 'Invalid or corrupted exit token', timestamp: Date.now() } }
      };
    }

    // Verify session exists
    const sessionsTable = getTableClient(TableNames.SESSIONS);
    try {
      await sessionsTable.getEntity('SESSION', sessionId);
    } catch (error: any) {
      if (error.statusCode === 404) {
        return {
          status: 404,
          jsonBody: { error: { code: 'NOT_FOUND', message: 'Session not found', timestamp: Date.now() } }
        };
      }
      throw error;
    }

    // Update attendance record to mark exit
    const attendanceTable = getTableClient(TableNames.ATTENDANCE);
    
    try {
      const attendanceRecord = await attendanceTable.getEntity(sessionId, studentId);
      
      // Update with exit verification (Direct QR method)
      const updatedEntity = {
        partitionKey: attendanceRecord.partitionKey,
        rowKey: attendanceRecord.rowKey,
        exitVerified: true,
        exitMethod: 'DIRECT_QR',
        exitedAt: Math.floor(Date.now() / 1000) // Unix timestamp in seconds
      };
      
      await attendanceTable.updateEntity(updatedEntity, 'Merge');
      
      // Broadcast exit verification update
      await broadcastAttendanceUpdate(sessionId, {
        studentId: studentId,
        exitVerified: true
      }, context);
      
      return {
        status: 200,
        jsonBody: {
          success: true,
          sessionId,
          studentId,
          message: 'Exit marked successfully'
        }
      };
    } catch (error: any) {
      if (error.statusCode === 404) {
        return {
          status: 404,
          jsonBody: { error: { code: 'NOT_ENROLLED', message: 'Student not enrolled in this session', timestamp: Date.now() } }
        };
      }
      throw error;
    }

  } catch (error: any) {
    context.error('Error marking exit:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to mark exit',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('markExit', {
  methods: ['POST'],
  route: 'sessions/{sessionId}/exit',
  authLevel: 'anonymous',
  handler: markExit
});
