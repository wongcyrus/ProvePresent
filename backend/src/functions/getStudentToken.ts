/**
 * Get Student Token API Endpoint
 * Returns the active chain token for a student if they are a holder
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
export async function getStudentToken(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing GET /api/sessions/{sessionId}/tokens/{studentId} request');

  try {
    // Parse authentication
    const principal = parseAuthFromRequest(request);
    if (!principal) {
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Missing authentication header', timestamp: Date.now() } }
      };
    }    const principalId = principal.userDetails || principal.userId;

    const sessionId = request.params.sessionId;
    const studentId = request.params.studentId;
    context.log(`[getStudentToken] request: sessionId=${sessionId || 'missing'}, studentId=${studentId || 'missing'}, principalId=${principalId || 'missing'}`);
    
    if (!sessionId || !studentId) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing sessionId or studentId', timestamp: Date.now() } }
      };
    }

    const hasStudentRole = hasRole(principal, 'Student') || hasRole(principal, 'student');
    const isSelfRequest = !!principalId && principalId === studentId;
    context.log(`[getStudentToken] auth: hasStudentRole=${hasStudentRole}, isSelfRequest=${isSelfRequest}`);
    if (!hasStudentRole && !isSelfRequest) {
      context.warn(`[getStudentToken] forbidden: principalId=${principalId || 'missing'} requested studentId=${studentId}`);
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Student role required', timestamp: Date.now() } }
      };
    }

    const now = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
    const tokensTable = getTableClient(TableNames.TOKENS);
    const chainsTable = getTableClient(TableNames.CHAINS);

    // Find active token for this student
    const tokens = tokensTable.listEntities({
      queryOptions: { 
        filter: `PartitionKey eq '${sessionId}' and holderId eq '${studentId}'` 
      }
    });

    let activeToken = null;
    let expiredToken = null;
    let scannedTokenCount = 0;

    for await (const token of tokens) {
      scannedTokenCount += 1;
      // Check if token is still valid (not expired)
      if (token.expiresAt && (token.expiresAt as number) > now) {
        activeToken = {
          token: token.rowKey,
          chainId: token.chainId,
          seq: token.seq,
          expiresAt: token.expiresAt
        };
        break;
      } else if (token.expiresAt) {
        // Keep track of most recent expired token
        if (!expiredToken || (token.expiresAt as number) > (expiredToken.expiresAt as number)) {
          expiredToken = token;
        }
      }
    }

    // If we have an active token, return it
    if (activeToken) {
      context.log(`[getStudentToken] active token found: session=${sessionId}, student=${studentId}, tokenCount=${scannedTokenCount}`);
      return {
        status: 200,
        jsonBody: {
          isHolder: true,
          ...activeToken
        }
      };
    }

    // If we have an expired token, create a new one on-demand
    if (expiredToken) {
      const chainId = expiredToken.chainId as string;
      context.log(`[getStudentToken] no active token; attempting regen from expired token: session=${sessionId}, student=${studentId}, chainId=${chainId}`);
      
      // Verify the chain is still active
      try {
        const chain = await chainsTable.getEntity(sessionId, chainId);
        
        if (chain.state === 'ACTIVE' && chain.lastHolder === studentId) {
          // Create new token on-demand
          const tokenTTL = parseInt(process.env.CHAIN_TOKEN_TTL_SECONDS || '25');
          const newTokenId = generateTokenId();
          const newExpiresAt = now + tokenTTL;

          await tokensTable.createEntity({
            partitionKey: sessionId,
            rowKey: newTokenId,
            chainId,
            holderId: studentId,
            seq: expiredToken.seq,
            expiresAt: newExpiresAt,
            createdAt: now
          });

          context.log(`Created new token on-demand for student ${studentId}, chain ${chainId}`);

          return {
            status: 200,
            jsonBody: {
              isHolder: true,
              token: newTokenId,
              chainId,
              seq: expiredToken.seq,
              expiresAt: newExpiresAt
            }
          };
        }
      } catch (error: any) {
        // Chain not found or error - student is no longer holder
        context.log(`[getStudentToken] chain not found/inactive during regen: chain=${chainId}, student=${studentId}, error=${error.message}`);
      }
    }

    // No active or expired token - student is not a holder
    context.log(`[getStudentToken] no holder token: session=${sessionId}, student=${studentId}, scannedTokenCount=${scannedTokenCount}`);
    return {
      status: 200,
      jsonBody: {
        isHolder: false,
        token: null,
        chainId: null
      }
    };

  } catch (error: any) {
    context.error('[getStudentToken] Error getting student token:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get student token',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

// Generate random token ID
function generateTokenId(): string {
  const crypto = require('crypto');
  const bytes = crypto.randomBytes(32);
  return bytes.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

app.http('getStudentToken', {
  methods: ['GET'],
  route: 'sessions/{sessionId}/tokens/{studentId}',
  authLevel: 'anonymous',
  handler: getStudentToken
});
