/**
 * Request Challenge API Endpoint
 * Generates a unique one-time challenge code for a specific scanner
 */
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseUserPrincipal, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';
import * as crypto from 'crypto';

function generateChallengeCode(tokenId: string, scannerId: string, timestamp: number): string {
  const hash = crypto.createHash('sha256')
    .update(`${tokenId}:${scannerId}:${timestamp}`)
    .digest('hex');
  
  // Convert to 6-digit code
  const code = parseInt(hash.substring(0, 8), 16) % 1000000;
  return code.toString().padStart(6, '0');
}

export async function requestChallenge(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/sessions/{sessionId}/chains/{chainId}/request-challenge');

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
    const scannerId = principal.userDetails || principal.userId; // Scanner identity
    if (!scannerId) {
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Invalid authentication principal', timestamp: Date.now() } }
      };
    }

    const sessionId = request.params.sessionId;
    const chainId = request.params.chainId;
    const body = await request.json() as any;
    const tokenId = body.tokenId;
    context.log(`[requestChallenge] request: sessionId=${sessionId || 'missing'}, chainId=${chainId || 'missing'}, tokenId=${tokenId || 'missing'}, scannerId=${scannerId}`);
    
    if (!sessionId || !chainId || !tokenId) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing sessionId, chainId, or tokenId', timestamp: Date.now() } }
      };
    }

    const now = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
    const tokensTable = getTableClient(TableNames.TOKENS);
    const chainsTable = getTableClient(TableNames.CHAINS);
    const attendanceTable = getTableClient(TableNames.ATTENDANCE);

    const hasStudentRole = hasRole(principal, 'Student') || hasRole(principal, 'student');
    context.log(`[requestChallenge] auth: hasStudentRole=${hasStudentRole}, scannerId=${scannerId}`);
    if (!hasStudentRole) {
      try {
        await attendanceTable.getEntity(sessionId, scannerId);
        context.log(`[requestChallenge] role fallback: scanner found in attendance for session ${sessionId}`);
      } catch (error: any) {
        if (error.statusCode === 404) {
          context.warn(`[requestChallenge] forbidden: scanner not in attendance and no student role. session=${sessionId}, scannerId=${scannerId}`);
          return {
            status: 403,
            jsonBody: { error: { code: 'FORBIDDEN', message: 'Student role required', timestamp: Date.now() } }
          };
        }
        throw error;
      }
    }

    // Verify token exists and is valid
    let token;
    let chainData;
    try {
      token = await tokensTable.getEntity(sessionId, tokenId);
      chainData = await chainsTable.getEntity(sessionId, chainId);
      
      // Check if token expired
      if (token.expiresAt && (token.expiresAt as number) < now) {
        context.warn(`[requestChallenge] token expired: tokenId=${tokenId}, expiresAt=${token.expiresAt}, now=${now}`);
        return {
          status: 400,
          jsonBody: { error: { code: 'TOKEN_EXPIRED', message: 'Token has expired', timestamp: now } }
        };
      }
      
      // Verify token belongs to this chain
      if (token.chainId !== chainId) {
        context.warn(`[requestChallenge] token-chain mismatch: tokenId=${tokenId}, token.chainId=${token.chainId}, request.chainId=${chainId}`);
        return {
          status: 400,
          jsonBody: { error: { code: 'INVALID_TOKEN', message: 'Token does not belong to this chain', timestamp: now } }
        };
      }
    } catch (error: any) {
      if (error.statusCode === 404) {
        return {
          status: 404,
          jsonBody: { error: { code: 'NOT_FOUND', message: 'Token or chain not found', timestamp: now } }
        };
      }
      throw error;
    }

    const holderId = token.holderId as string;
    
    // Cannot scan your own QR code
    if (holderId === scannerId) {
      context.warn(`[requestChallenge] self-scan blocked: holderId=${holderId}, scannerId=${scannerId}, tokenId=${tokenId}`);
      return {
        status: 400,
        jsonBody: { error: { code: 'SELF_SCAN', message: 'Cannot scan your own QR code', timestamp: now } }
      };
    }

    // Generate unique challenge code for this scanner
    const challengeCode = generateChallengeCode(tokenId, scannerId, now);
    const challengeHash = crypto.createHash('sha256').update(challengeCode).digest('hex');
    
    // Store challenge in token (expires in 30 seconds)
    const challengeTTL = parseInt(process.env.CHALLENGE_TTL_SECONDS || '30');
    const challengeExpiresAt = now + challengeTTL;
    
    await tokensTable.updateEntity({
      partitionKey: sessionId,
      rowKey: tokenId,
      pendingChallenge: scannerId,
      challengeCode: challengeHash,
      challengeExpiresAt
    }, 'Merge');

    context.log(`[requestChallenge] generated: scannerId=${scannerId}, holderId=${holderId}, tokenId=${tokenId}, expiresAt=${challengeExpiresAt}`);

    return {
      status: 200,
      jsonBody: {
        challengeCode,
        holderId,
        holderName: holderId.split('@')[0], // Extract name from email
        expiresAt: challengeExpiresAt,
        expiresIn: challengeTTL
      }
    };

  } catch (error: any) {
    context.error('[requestChallenge] Error generating challenge:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to generate challenge',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('requestChallenge', {
  methods: ['POST'],
  route: 'sessions/{sessionId}/chains/{chainId}/request-challenge',
  authLevel: 'anonymous',
  handler: requestChallenge
});
