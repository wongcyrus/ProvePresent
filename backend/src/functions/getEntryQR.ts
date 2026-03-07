/**
 * Get Entry QR Code Data - REFACTORED (Self-contained)
 * Generates encrypted token for entry QR code (no database storage)
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import { checkSessionAccess } from '../utils/sessionAccess';
import * as crypto from 'crypto';

function encryptToken(data: any): string {
  const secret = process.env.QR_ENCRYPTION_KEY || 'default-secret-key-change-in-production';
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(secret, 'salt', 32);
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // Return iv + encrypted data
  return iv.toString('hex') + ':' + encrypted;
}

export async function getEntryQR(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing GET /api/sessions/{sessionId}/entry-qr request');

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
    if (!hasRole(principal, 'Teacher')) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Teacher role required', timestamp: Date.now() } }
      };
    }

    const teacherId = getUserId(principal);
    const sessionId = request.params.sessionId;
    
    if (!sessionId) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing sessionId', timestamp: Date.now() } }
      };
    }

    // Verify session exists and teacher owns it
    const sessionsTable = getTableClient(TableNames.SESSIONS);
    let session: any;
    
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

    // Verify access (owner or co-teacher)
    const access = checkSessionAccess(session, teacherId);
    if (!access.hasAccess) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'You do not have access to this session', timestamp: Date.now() } }
      };
    }

    // Create encrypted token with configurable TTL
    const now = Math.floor(Date.now() / 1000);
    const tokenTTL = Math.max(5, parseInt(process.env.CHAIN_TOKEN_TTL_SECONDS || '25', 10) || 25);
    const tokenData = {
      sessionId,
      type: 'ENTRY',
      timestamp: now,
      expiresAt: now + tokenTTL
    };
    
    const encryptedToken = encryptToken(tokenData);

    return {
      status: 200,
      jsonBody: {
        sessionId,
        type: 'ENTRY',
        token: encryptedToken,
        expiresAt: tokenData.expiresAt,
        refreshInterval: tokenTTL * 1000
      }
    };

  } catch (error: any) {
    context.error('Error generating entry QR:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to generate entry QR',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('getEntryQR', {
  methods: ['GET'],
  route: 'sessions/{sessionId}/entry-qr',
  authLevel: 'anonymous',
  handler: getEntryQR
});
