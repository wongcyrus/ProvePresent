/**
 * Scan Chain API Endpoint
 * Handles when a student scans another student's QR code to pass the chain
 */
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { randomUUID } from 'crypto';
import { broadcastAttendanceUpdate, broadcastChainUpdate } from '../utils/signalrBroadcast';
import { validateGeolocation } from '../utils/geolocation';
import { parseUserPrincipal, hasRole, getUserId } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';

export async function scanChain(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/sessions/{sessionId}/chains/{chainId}/scan request');

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
    const studentEmail = principal.userDetails || principal.userId;
    if (!studentEmail) {
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Invalid authentication principal', timestamp: Date.now() } }
      };
    }

    const sessionId = request.params.sessionId;
    const chainId = request.params.chainId;
    const body = await request.json() as any;
    const tokenId = body.tokenId;
    const scannerLocation = body.location || body.metadata?.gps; // Student's GPS location
    context.log(`[scanChain] request: sessionId=${sessionId || 'missing'}, chainId=${chainId || 'missing'}, tokenId=${tokenId || 'missing'}, scannerId=${studentEmail}`);
    
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
    const sessionsTable = getTableClient(TableNames.SESSIONS);

    const hasStudentRole = hasRole(principal, 'Student') || hasRole(principal, 'student');
    context.log(`[scanChain] auth: hasStudentRole=${hasStudentRole}, scannerId=${studentEmail}`);
    if (!hasStudentRole) {
      try {
        await attendanceTable.getEntity(sessionId, studentEmail);
        context.log(`[scanChain] role fallback: scanner found in attendance for session ${sessionId}`);
      } catch (error: any) {
        if (error.statusCode === 404) {
          context.warn(`[scanChain] forbidden: scanner not in attendance and no student role. session=${sessionId}, scannerId=${studentEmail}`);
          return {
            status: 403,
            jsonBody: { error: { code: 'FORBIDDEN', message: 'Student role required', timestamp: Date.now() } }
          };
        }
        throw error;
      }
    }

    // Verify session exists and is active
    let session;
    try {
      session = await sessionsTable.getEntity('SESSION', sessionId);
      if (session.status !== 'ACTIVE') {
        context.warn(`[scanChain] session not active: session=${sessionId}, status=${session.status}`);
        return {
          status: 400,
          jsonBody: { error: { code: 'SESSION_ENDED', message: 'Session has ended', timestamp: now } }
        };
      }
    } catch (error: any) {
      if (error.statusCode === 404) {
        return {
          status: 404,
          jsonBody: { error: { code: 'NOT_FOUND', message: 'Session not found', timestamp: now } }
        };
      }
      throw error;
    }

    // Parse and validate geolocation
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

    const geoCheck = validateGeolocation(
      sessionLocation,
      geofenceRadius,
      enforceGeofence,
      scannerLocation
    );

    const missingLocationWarning = !scannerLocation ? 'Location not provided' : undefined;
    if (missingLocationWarning) {
      context.warn(`Scan without location: student=${studentEmail}, session=${sessionId}, chain=${chainId}`);
    }
    const locationWarning = geoCheck.warning || missingLocationWarning;

    // Block scan if geofence is enforced and student is out of bounds
    if (geoCheck.shouldBlock) {
      context.warn(`[scanChain] geofence blocked: session=${sessionId}, chain=${chainId}, scannerId=${studentEmail}, distance=${geoCheck.distance ?? 'n/a'}`);
      return {
        status: 403,
        jsonBody: {
          error: {
            code: 'GEOFENCE_VIOLATION',
            message: geoCheck.warning || 'You are outside the allowed area for this class',
            details: geoCheck.distance ? `Distance: ${Math.round(geoCheck.distance)}m` : undefined,
            timestamp: now
          }
        }
      };
    }

    // Verify token exists and is valid
    let token;
    let chainData;
    try {
      token = await tokensTable.getEntity(sessionId, tokenId);
      chainData = await chainsTable.getEntity(sessionId, chainId);
      
      // Check if token has expired
      if (token.expiresAt && (token.expiresAt as number) < now) {
        context.warn(`[scanChain] token expired: tokenId=${tokenId}, expiresAt=${token.expiresAt}, now=${now}`);
        return {
          status: 400,
          jsonBody: { error: { code: 'TOKEN_EXPIRED', message: 'Token has expired', timestamp: now } }
        };
      }
      
      // Verify token belongs to the correct chain
      if (token.chainId !== chainId) {
        context.warn(`[scanChain] token-chain mismatch: tokenId=${tokenId}, token.chainId=${token.chainId}, request.chainId=${chainId}`);
        return {
          status: 400,
          jsonBody: { error: { code: 'INVALID_TOKEN', message: 'Token does not belong to this chain', timestamp: now } }
        };
      }
    } catch (error: any) {
      if (error.statusCode === 404) {
        return {
          status: 404,
          jsonBody: { error: { code: 'TOKEN_NOT_FOUND', message: 'Token not found or already used', timestamp: now } }
        };
      }
      throw error;
    }

    // Get the previous holder and the scanner
    const previousHolder = token.holderId as string;
    const scannerId = studentEmail; // Scanner is the one calling this endpoint
    context.log(`[scanChain] token validated: previousHolder=${previousHolder}, scannerId=${scannerId}, chainState=${(chainData as any).state || 'unknown'}`);
    
    // Scanner should become the new holder
    
    // Mark previous holder's attendance if not already marked
    try {
      const prevAttendance = await attendanceTable.getEntity(sessionId, previousHolder);
      
      if (!prevAttendance.entryStatus) {
        // Determine if late or present based on session start time
        const sessionStartTime = session.startTime as number;
        const lateCutoffMinutes = 15; // Default
        const lateCutoffTime = sessionStartTime + (lateCutoffMinutes * 60);
        
        const entryStatus = now > lateCutoffTime ? 'LATE_ENTRY' : 'PRESENT_ENTRY';
        
        const updateData: any = {
          partitionKey: sessionId,
          rowKey: previousHolder,
          entryStatus,
          entryMethod: 'CHAIN',
          entryAt: now
        };

        // Save scanner location if provided
        if (scannerLocation) {
          updateData.scanLocation = JSON.stringify(scannerLocation);
        }
        
        await attendanceTable.updateEntity(updateData, 'Merge');
        
        context.log(`Marked ${previousHolder} as ${entryStatus} via CHAIN`);
        
        // Broadcast attendance update for previous holder
        await broadcastAttendanceUpdate(sessionId, {
          studentId: previousHolder,
          entryStatus: entryStatus,
        }, context);
      }
    } catch (error: any) {
      context.log(`Warning: Could not update attendance for previous holder: ${error.message}`);
    }

    // Record location warning for the scanner
    if (locationWarning || scannerLocation) {
      try {
        const scannerUpdate: any = {
          partitionKey: sessionId,
          rowKey: scannerId  // Update scanner, not holder
        };
        if (scannerLocation) {
          scannerUpdate.scanLocation = JSON.stringify(scannerLocation);
        }
        if (locationWarning) {
          scannerUpdate.locationWarning = locationWarning;
          scannerUpdate.locationDistance = geoCheck.distance;
        }
        await attendanceTable.updateEntity(scannerUpdate, 'Merge');

        if (locationWarning) {
          await broadcastAttendanceUpdate(sessionId, {
            studentId: scannerId,
            locationWarning
          }, context);
        }
      } catch (error: any) {
        context.log(`Warning: Could not update attendance for scanner: ${error.message}`);
      }
    }

    // Delete the old token
    await tokensTable.deleteEntity(sessionId, tokenId);

    // Create new token for scanner (who becomes new holder)
    const newTokenId = randomUUID();
    const newSeq = (token.seq as number) + 1;
    const tokenTTL = parseInt(process.env.CHAIN_TOKEN_TTL_SECONDS || '10');
    const newExpiresAt = now + tokenTTL; // now is already in seconds

    const newTokenEntity = {
      partitionKey: sessionId,
      rowKey: newTokenId,
      chainId,
      holderId: scannerId,  // Scanner becomes new holder
      seq: newSeq,
      expiresAt: newExpiresAt,
      createdAt: now
    };
    await tokensTable.createEntity(newTokenEntity);

    // Update chain
    await chainsTable.updateEntity({
      partitionKey: sessionId,
      rowKey: chainId,
      lastHolder: scannerId,  // Scanner is new holder
      lastSeq: newSeq,
      lastAt: now
    }, 'Merge');

    // Record chain history for tracking
    const chainHistoryTable = getTableClient(TableNames.CHAIN_HISTORY);
    try {
      await chainHistoryTable.createEntity({
        partitionKey: chainId,  // Group by chain
        rowKey: `${newSeq.toString().padStart(10, '0')}_${now}`,  // Sortable by sequence
        sessionId,
        chainId,
        sequence: newSeq,
        fromHolder: previousHolder,
        toHolder: scannerId,
        scannedAt: now,
        phase: chainData.phase
      });
      context.log(`Recorded chain history: ${previousHolder} -> ${scannerId} (seq ${newSeq})`);
    } catch (historyError: any) {
      // Don't fail the scan if history recording fails
      context.log(`Warning: Failed to record chain history: ${historyError.message}`);
    }

    context.log(`Chain ${chainId} passed from ${previousHolder} to ${scannerId}, seq ${newSeq}`);

    // Broadcast chain update
    await broadcastChainUpdate(sessionId, {
      chainId,
      phase: chainData.phase,
      lastHolder: scannerId,  // Scanner is new holder
      lastSeq: newSeq,
      state: chainData.state
    }, context);

    return {
      status: 200,
      jsonBody: {
        success: true,
        newHolder: scannerId,  // Scanner is new holder
        seq: newSeq,
        previousHolder,
        token: newTokenId,
        expiresAt: newExpiresAt,
        locationWarning
      }
    };

  } catch (error: any) {
    context.error('[scanChain] Error scanning chain:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to scan chain',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('scanChain', {
  methods: ['POST'],
  route: 'sessions/{sessionId}/chains/{chainId}/scan',
  authLevel: 'anonymous',
  handler: scanChain
});
