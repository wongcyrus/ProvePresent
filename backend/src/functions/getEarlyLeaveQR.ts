/**
 * Get Early Leave QR Code - Generate token for early leave QR code
 * Generates encrypted token for early leave QR code (database-backed, rotating)
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseUserPrincipal, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import * as crypto from 'crypto';

function encryptToken(data: any): string {
  const secret = process.env.QR_ENCRYPTION_KEY || 'default-secret-key-change-in-production';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(secret.padEnd(32, '0').slice(0, 32)), iv);
  
  let encrypted = cipher.update(JSON.stringify(data));
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

async function getEarlyLeaveQR(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const principalHeader = request.headers.get('x-ms-client-principal') || request.headers.get('x-client-principal');
    if (!principalHeader) {
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Missing authentication header', timestamp: Date.now() } }
      };
    }

    const principal = parseUserPrincipal(principalHeader);
    if (!hasRole(principal, 'teacher')) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Teacher role required', timestamp: Date.now() } }
      };
    }

    const sessionId = request.params.sessionId;
    
    if (!sessionId) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing sessionId' } }
      };
    }

    // Verify session exists
    const sessionsTable = getTableClient(TableNames.SESSIONS);
    try {
      await sessionsTable.getEntity('session', sessionId);
    } catch (error: any) {
      if (error.code === 'ResourceNotFound') {
        return {
          status: 404,
          jsonBody: { error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } }
        };
      }
      throw error;
    }

    // Check if early leave is active for this session
    const tokensTable = getTableClient(TableNames.TOKENS);
    let earlyLeaveToken: any = null;
    
    try {
      earlyLeaveToken = await tokensTable.getEntity('early-leave', sessionId);
    } catch (error: any) {
      if (error.code !== 'ResourceNotFound') {
        throw error;
      }
      // Early leave not active yet - create a new one
    }

    // If no active early leave token, create one
    if (!earlyLeaveToken) {
      const now = Math.floor(Date.now() / 1000);
      const token = {
        partitionKey: 'early-leave',
        rowKey: sessionId,
        sessionId,
        type: 'EARLY_LEAVE',
        token: crypto.randomBytes(32).toString('hex'),
        createdAt: now,
        expiresAt: now + 3600, // 1 hour TTL for early leave (longer than entry/exit)
        active: true,
        timestamp: new Date()
      };
      
      await tokensTable.upsertEntity(token);
      earlyLeaveToken = token;
    }

    const now = Math.floor(Date.now() / 1000);
    
    // Check if token is expired
    if (earlyLeaveToken.expiresAt < now) {
      // Token expired, create new one
      const newToken = {
        partitionKey: 'early-leave',
        rowKey: sessionId,
        sessionId,
        type: 'EARLY_LEAVE',
        token: crypto.randomBytes(32).toString('hex'),
        createdAt: now,
        expiresAt: now + 3600,
        active: true,
        timestamp: new Date()
      };
      
      await tokensTable.upsertEntity(newToken);
      earlyLeaveToken = newToken;
    }

    // Create encrypted token data
    const tokenData = {
      sessionId,
      type: 'EARLY_LEAVE',
      token: earlyLeaveToken.token,
      createdAt: earlyLeaveToken.createdAt,
      expiresAt: earlyLeaveToken.expiresAt
    };
    
    const encryptedToken = encryptToken(tokenData);

    return {
      status: 200,
      jsonBody: {
        sessionId,
        type: 'EARLY_LEAVE',
        token: encryptedToken,
        expiresAt: earlyLeaveToken.expiresAt,
        refreshInterval: 5000 // Refresh more frequently since early leave is time-sensitive
      }
    };

  } catch (error: any) {
    context.error('Error generating early leave QR:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to generate early leave QR',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('getEarlyLeaveQR', {
  methods: ['GET'],
  route: 'sessions/{sessionId}/early-leave-qr',
  authLevel: 'anonymous',
  handler: getEarlyLeaveQR
});
