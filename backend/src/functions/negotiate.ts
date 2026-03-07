/**
 * SignalR Negotiate Function
 * Provides SignalR connection information to clients
 */
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, hasRole, getUserId } from '../utils/auth';

export async function negotiate(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('SignalR negotiate called');
  
  try {
    const principal = parseAuthFromRequest(request);
    if (!principal) {
      return {
        status: 401,
        jsonBody: {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Missing authentication header',
            timestamp: Date.now()
          }
        }
      };
    }    if (!hasRole(principal, 'authenticated')) {
      return {
        status: 403,
        jsonBody: {
          error: {
            code: 'FORBIDDEN',
            message: 'Authenticated role required',
            timestamp: Date.now()
          }
        }
      };
    }

    // Get SignalR connection string from environment
    const connectionString = process.env.SIGNALR_CONNECTION_STRING;
    
    if (!connectionString) {
      context.error('SIGNALR_CONNECTION_STRING not configured');
      return {
        status: 500,
        jsonBody: {
          error: {
            code: 'CONFIGURATION_ERROR',
            message: 'SignalR connection string not configured',
            timestamp: Date.now()
          }
        }
      };
    }
    
    // Parse connection string to get endpoint and access key
    const endpointMatch = connectionString.match(/Endpoint=([^;]+)/);
    const keyMatch = connectionString.match(/AccessKey=([^;]+)/);
    
    if (!endpointMatch || !keyMatch) {
      context.error('Invalid SIGNALR_CONNECTION_STRING format');
      return {
        status: 500,
        jsonBody: {
          error: {
            code: 'CONFIGURATION_ERROR',
            message: 'Invalid SignalR connection string format',
            timestamp: Date.now()
          }
        }
      };
    }
    
    const endpoint = endpointMatch[1];
    const accessKey = keyMatch[1];
    
    // Generate access token for the client
    const hubName = 'attendance'; // Hub name for attendance updates
    const userId = principal.userId || principal.userDetails || 'unknown';
    
    // Create JWT token for SignalR
    const crypto = require('crypto');
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600; // Token valid for 1 hour
    
    const payload = {
      aud: `${endpoint}/client/?hub=${hubName}`,
      iat: now,
      exp: expiry,
      nameid: userId
    };
    
    const header = {
      typ: 'JWT',
      alg: 'HS256'
    };
    
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', accessKey)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');
    
    const token = `${encodedHeader}.${encodedPayload}.${signature}`;
    
    // Return connection info
    return {
      status: 200,
      jsonBody: {
        url: `${endpoint}/client/?hub=${hubName}`,
        accessToken: token
      }
    };
    
  } catch (error: any) {
    context.error('Error in negotiate function:', error);
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to negotiate SignalR connection',
          details: error.message,
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('negotiate', {
  methods: ['GET', 'POST'],
  route: 'negotiate',
  authLevel: 'anonymous',
  handler: negotiate
});
