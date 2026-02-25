/**
 * SignalR Negotiate for Students
 * Provides SignalR connection info for student session views
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseUserPrincipal, hasRole, getUserId } from '../utils/auth';

export async function negotiateStudent(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing GET /api/sessions/{sessionId}/negotiate request');

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
    
    // Require Student role
    if (!hasRole(principal, 'Student') && !hasRole(principal, 'student')) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Student role required', timestamp: Date.now() } }
      };
    }

    const sessionId = request.params.sessionId;
    const userId = getUserId(principal);
    
    if (!sessionId) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Missing sessionId', timestamp: Date.now() } }
      };
    }

    // Get SignalR connection string
    const signalRConnectionString = process.env.SIGNALR_CONNECTION_STRING;
    
    if (!signalRConnectionString || signalRConnectionString.includes('dummy')) {
      // SignalR not configured - return empty response so client falls back to polling
      context.log('SignalR not configured, client will use polling');
      return {
        status: 200,
        jsonBody: {
          url: null,
          accessToken: null
        }
      };
    }

    // Parse connection string to get endpoint
    const endpointMatch = signalRConnectionString.match(/Endpoint=([^;]+)/);
    const accessKeyMatch = signalRConnectionString.match(/AccessKey=([^;]+)/);
    
    if (!endpointMatch || !accessKeyMatch) {
      context.log('Invalid SignalR connection string format');
      return {
        status: 200,
        jsonBody: {
          url: null,
          accessToken: null
        }
      };
    }

    const endpoint = endpointMatch[1];
    const accessKey = accessKeyMatch[1];
    
    // Generate JWT token for SignalR
    const crypto = require('crypto');
    const hubName = 'sessionhub';
    const audience = `${endpoint}/client/?hub=${hubName}`;
    
    const header = {
      typ: 'JWT',
      alg: 'HS256'
    };
    
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      aud: audience,
      iat: now,
      exp: now + 3600, // 1 hour
      userId: userId,
      role: 'student',
      sessionId: sessionId
    };
    
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', accessKey)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');
    
    const token = `${encodedHeader}.${encodedPayload}.${signature}`;
    
    return {
      status: 200,
      jsonBody: {
        url: `${endpoint}/client/?hub=${hubName}`,
        accessToken: token
      }
    };

  } catch (error: any) {
    context.error('Error in negotiate:', error);
    
    // Return empty response so client falls back to polling
    return {
      status: 200,
      jsonBody: {
        url: null,
        accessToken: null
      }
    };
  }
}

app.http('negotiateStudent', {
  methods: ['GET', 'POST'],
  route: 'sessions/{sessionId}/negotiate',
  authLevel: 'anonymous',
  handler: negotiateStudent
});
