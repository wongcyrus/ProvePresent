/**
 * Student SignalR Negotiate Endpoint
 * 
 * POST /api/sessions/{sessionId}/student/negotiate
 * 
 * Provides SignalR connection information for students to receive:
 * - Capture request events
 * - Real-time session updates
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, getUserId } from '../utils/auth';

export async function studentNegotiate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/sessions/{sessionId}/student/negotiate request');

  try {
    // Get SignalR connection string
    const signalRConnectionString = process.env.SIGNALR_CONNECTION_STRING;
    
    if (!signalRConnectionString || signalRConnectionString.includes('dummy')) {
      return {
        status: 503,
        jsonBody: {
          error: 'SignalR not configured'
        }
      };
    }

    // Parse connection string
    const endpointMatch = signalRConnectionString.match(/Endpoint=([^;]+)/);
    const accessKeyMatch = signalRConnectionString.match(/AccessKey=([^;]+)/);
    
    if (!endpointMatch || !accessKeyMatch) {
      return {
        status: 500,
        jsonBody: {
          error: 'Invalid SignalR connection string'
        }
      };
    }

    const endpoint = endpointMatch[1];
    const accessKey = accessKeyMatch[1];
    const sessionId = request.params.sessionId;
    
    if (!sessionId) {
      return {
        status: 400,
        jsonBody: {
          error: 'Missing sessionId'
        }
      };
    }

    // Get student ID from authentication
    const principal = parseAuthFromRequest(request);
    
    if (!principal) {
      return {
        status: 401,
        jsonBody: {
          error: 'Missing authentication'
        }
      };
    }    const studentId = getUserId(principal);

    // Generate hub name (same as dashboard)
    const hubName = `dashboard${sessionId.replace(/-/g, '')}`;
    
    // Generate access token for this student
    const crypto = require('crypto');
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600; // 1 hour
    
    const jwtPayload = {
      aud: `${endpoint}/client/?hub=${hubName}`,
      sub: studentId, // User ID for SignalR user groups
      iat: now,
      exp: expiry
    };
    
    const header = {
      typ: 'JWT',
      alg: 'HS256'
    };
    
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(jwtPayload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', accessKey)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');
    
    const accessToken = `${encodedHeader}.${encodedPayload}.${signature}`;

    // Return connection info
    const connectionInfo = {
      url: `${endpoint}/client/?hub=${hubName}`,
      accessToken
    };

    context.log(`Generated SignalR connection for student ${studentId} in session ${sessionId}`);

    return {
      status: 200,
      jsonBody: connectionInfo
    };

  } catch (error: any) {
    context.error('Failed to negotiate SignalR connection:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: 'Failed to negotiate connection',
        details: error.message
      }
    };
  }
}

// Register the Azure Function
app.http('studentNegotiate', {
  methods: ['POST'],
  route: 'sessions/{sessionId}/student/negotiate',
  authLevel: 'anonymous',
  handler: studentNegotiate
});
