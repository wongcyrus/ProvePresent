/**
 * SignalR Broadcast Utility
 * Provides functions to broadcast attendance and chain updates via SignalR
 */
import { InvocationContext } from '@azure/functions';

export async function broadcastAttendanceUpdate(
  sessionId: string,
  update: {
    studentId: string;
    entryStatus?: string;
    exitVerified?: boolean;
    earlyLeaveAt?: number;
    isOnline?: boolean;
    locationWarning?: string;
  },
  context: InvocationContext
): Promise<void> {
  try {
    const signalRConnectionString = process.env.SIGNALR_CONNECTION_STRING;
    if (!signalRConnectionString || signalRConnectionString.includes('dummy')) {
      context.log('SignalR not configured, skipping attendance broadcast');
      return;
    }

    // Parse connection string
    const endpointMatch = signalRConnectionString.match(/Endpoint=([^;]+)/);
    const accessKeyMatch = signalRConnectionString.match(/AccessKey=([^;]+)/);
    
    if (!endpointMatch || !accessKeyMatch) {
      context.log('Invalid SignalR connection string format');
      return;
    }

    const endpoint = endpointMatch[1];
    const accessKey = accessKeyMatch[1];
    const hubName = `dashboard${sessionId.replace(/-/g, '')}`;
    
    // Create JWT token for SignalR
    const crypto = require('crypto');
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600;
    
    const payload = {
      aud: `${endpoint}/api/v1/hubs/${hubName}`,
      iat: now,
      exp: expiry
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

    // Send attendance update to SignalR
    const signalRUrl = `${endpoint}/api/v1/hubs/${hubName}`;
    context.log(`Broadcasting attendance update to: ${signalRUrl}`);
    
    const response = await fetch(signalRUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        target: 'attendanceUpdate',
        arguments: [update]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      context.log(`Attendance broadcast failed: ${response.status} - ${errorText}`);
    } else {
      context.log('Attendance broadcast successful');
    }
  } catch (error: any) {
    context.log(`Attendance broadcast error: ${error.message}`);
  }
}

export async function broadcastChainUpdate(
  sessionId: string,
  update: {
    chainId: string;
    phase: string;
    lastHolder: string;
    lastSeq: number;
    state: string;
  },
  context: InvocationContext
): Promise<void> {
  try {
    const signalRConnectionString = process.env.SIGNALR_CONNECTION_STRING;
    if (!signalRConnectionString || signalRConnectionString.includes('dummy')) {
      context.log('SignalR not configured, skipping chain broadcast');
      return;
    }

    // Parse connection string
    const endpointMatch = signalRConnectionString.match(/Endpoint=([^;]+)/);
    const accessKeyMatch = signalRConnectionString.match(/AccessKey=([^;]+)/);
    
    if (!endpointMatch || !accessKeyMatch) {
      context.log('Invalid SignalR connection string format');
      return;
    }

    const endpoint = endpointMatch[1];
    const accessKey = accessKeyMatch[1];
    const hubName = `dashboard${sessionId.replace(/-/g, '')}`;
    
    // Create JWT token for SignalR
    const crypto = require('crypto');
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600;
    
    const payload = {
      aud: `${endpoint}/api/v1/hubs/${hubName}`,
      iat: now,
      exp: expiry
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

    // Send chain update to SignalR
    const signalRUrl = `${endpoint}/api/v1/hubs/${hubName}`;
    context.log(`Broadcasting chain update to: ${signalRUrl}`);
    
    const response = await fetch(signalRUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        target: 'chainUpdate',
        arguments: [update]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      context.log(`Chain broadcast failed: ${response.status} - ${errorText}`);
    } else {
      context.log('Chain broadcast successful');
    }
  } catch (error: any) {
    context.log(`Chain broadcast error: ${error.message}`);
  }
}

export async function broadcastStallAlert(
  sessionId: string,
  chainIds: string[],
  context: InvocationContext
): Promise<void> {
  try {
    const signalRConnectionString = process.env.SIGNALR_CONNECTION_STRING;
    if (!signalRConnectionString || signalRConnectionString.includes('dummy')) {
      context.log('SignalR not configured, skipping stall alert broadcast');
      return;
    }

    // Parse connection string
    const endpointMatch = signalRConnectionString.match(/Endpoint=([^;]+)/);
    const accessKeyMatch = signalRConnectionString.match(/AccessKey=([^;]+)/);
    
    if (!endpointMatch || !accessKeyMatch) {
      context.log('Invalid SignalR connection string format');
      return;
    }

    const endpoint = endpointMatch[1];
    const accessKey = accessKeyMatch[1];
    const hubName = `dashboard${sessionId.replace(/-/g, '')}`;
    
    // Create JWT token for SignalR
    const crypto = require('crypto');
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600;
    
    const payload = {
      aud: `${endpoint}/api/v1/hubs/${hubName}`,
      iat: now,
      exp: expiry
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

    // Send stall alert to SignalR
    const signalRUrl = `${endpoint}/api/v1/hubs/${hubName}`;
    context.log(`Broadcasting stall alert to: ${signalRUrl}`);
    
    const response = await fetch(signalRUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        target: 'stallAlert',
        arguments: [chainIds]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      context.log(`Stall alert broadcast failed: ${response.status} - ${errorText}`);
    } else {
      context.log('Stall alert broadcast successful');
    }
  } catch (error: any) {
    context.log(`Stall alert broadcast error: ${error.message}`);
  }
}

export async function broadcastQuizQuestion(
  sessionId: string,
  question: {
    responseId: string;
    questionId: string;
    studentId: string;
    question: string;
    questionType: string;
    options: string[] | null;
    timeLimit: number;
    expiresAt: number;
  },
  context: InvocationContext
): Promise<void> {
  try {
    const signalRConnectionString = process.env.SIGNALR_CONNECTION_STRING;
    if (!signalRConnectionString || signalRConnectionString.includes('dummy')) {
      context.log('SignalR not configured, skipping quiz question broadcast');
      return;
    }

    const endpointMatch = signalRConnectionString.match(/Endpoint=([^;]+)/);
    const accessKeyMatch = signalRConnectionString.match(/AccessKey=([^;]+)/);
    
    if (!endpointMatch || !accessKeyMatch) {
      context.log('Invalid SignalR connection string format');
      return;
    }

    const endpoint = endpointMatch[1];
    const accessKey = accessKeyMatch[1];
    const hubName = `dashboard${sessionId.replace(/-/g, '')}`;
    
    const crypto = require('crypto');
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600;
    
    const payload = {
      aud: `${endpoint}/api/v1/hubs/${hubName}`,
      iat: now,
      exp: expiry
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

    const signalRUrl = `${endpoint}/api/v1/hubs/${hubName}`;
    context.log(`Broadcasting quiz question to: ${signalRUrl}`);
    
    const response = await fetch(signalRUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        target: 'quizQuestion',
        arguments: [question]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      context.log(`Quiz question broadcast failed: ${response.status} - ${errorText}`);
    } else {
      context.log('Quiz question broadcast successful');
    }
  } catch (error: any) {
    context.log(`Quiz question broadcast error: ${error.message}`);
  }
}

export async function broadcastQuizResult(
  sessionId: string,
  result: {
    responseId: string;
    studentId: string;
    isCorrect: boolean;
    score: number;
    responseTime: number;
  },
  context: InvocationContext
): Promise<void> {
  try {
    const signalRConnectionString = process.env.SIGNALR_CONNECTION_STRING;
    if (!signalRConnectionString || signalRConnectionString.includes('dummy')) {
      context.log('SignalR not configured, skipping quiz result broadcast');
      return;
    }

    const endpointMatch = signalRConnectionString.match(/Endpoint=([^;]+)/);
    const accessKeyMatch = signalRConnectionString.match(/AccessKey=([^;]+)/);
    
    if (!endpointMatch || !accessKeyMatch) {
      context.log('Invalid SignalR connection string format');
      return;
    }

    const endpoint = endpointMatch[1];
    const accessKey = accessKeyMatch[1];
    const hubName = `dashboard${sessionId.replace(/-/g, '')}`;
    
    const crypto = require('crypto');
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600;
    
    const payload = {
      aud: `${endpoint}/api/v1/hubs/${hubName}`,
      iat: now,
      exp: expiry
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

    const signalRUrl = `${endpoint}/api/v1/hubs/${hubName}`;
    context.log(`Broadcasting quiz result to: ${signalRUrl}`);
    
    const response = await fetch(signalRUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        target: 'quizResult',
        arguments: [result]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      context.log(`Quiz result broadcast failed: ${response.status} - ${errorText}`);
    } else {
      context.log('Quiz result broadcast successful');
    }
  } catch (error: any) {
    context.log(`Quiz result broadcast error: ${error.message}`);
  }
}

/**
 * Broadcast a message to a specific user in a session hub
 * 
 * @param sessionId - The session ID for the hub
 * @param userId - The user ID to send the message to
 * @param eventName - The SignalR event name (target)
 * @param payload - The event payload
 * @param context - Azure Functions invocation context
 */
export async function broadcastToUser(
  sessionId: string,
  userId: string,
  eventName: string,
  payload: any,
  context: InvocationContext
): Promise<void> {
  try {
    const signalRConnectionString = process.env.SIGNALR_CONNECTION_STRING;
    if (!signalRConnectionString || signalRConnectionString.includes('dummy')) {
      context.log('SignalR not configured, skipping broadcast to user');
      return;
    }

    const endpointMatch = signalRConnectionString.match(/Endpoint=([^;]+)/);
    const accessKeyMatch = signalRConnectionString.match(/AccessKey=([^;]+)/);
    
    if (!endpointMatch || !accessKeyMatch) {
      context.log('Invalid SignalR connection string format');
      return;
    }

    const endpoint = endpointMatch[1];
    const accessKey = accessKeyMatch[1];
    const hubName = `dashboard${sessionId.replace(/-/g, '')}`;
    
    // URL encode the user ID for the SignalR API
    const encodedUserId = encodeURIComponent(userId);
    
    // Build the user-specific endpoint URL
    const signalRUrl = `${endpoint}/api/v1/hubs/${hubName}/users/${encodedUserId}`;
    
    context.log(`SignalR endpoint: ${endpoint}`);
    context.log(`Hub name: ${hubName}`);
    context.log(`Broadcasting ${eventName} to user ${userId} (encoded: ${encodedUserId}) at: ${signalRUrl}`);
    
    const crypto = require('crypto');
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600;
    
    // CRITICAL: The aud claim must match the exact URL being called
    // Per Microsoft docs: https://learn.microsoft.com/azure/azure-signalr/signalr-reference-data-plane-rest-api
    // "aud: Needs to be the same as your HTTP request URL, not including the trailing slash and query parameters"
    const jwtPayload = {
      aud: signalRUrl,
      iat: now,
      exp: expiry
    };
    
    context.log(`JWT payload: ${JSON.stringify(jwtPayload)}`);
    
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
    
    const token = `${encodedHeader}.${encodedPayload}.${signature}`;

    const response = await fetch(signalRUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        target: eventName,
        arguments: [payload]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      context.log(`Broadcast to user failed: ${response.status} - ${errorText}`);
    } else {
      context.log(`Broadcast to user ${userId} successful`);
    }
  } catch (error: any) {
    context.log(`Broadcast to user error: ${error.message}`);
  }
}

/**
 * Broadcast a message to all users in a session hub
 * Generic function for any event type
 * 
 * @param sessionId - The session ID for the hub
 * @param eventName - The SignalR event name (target)
 * @param payload - The event payload
 * @param context - Azure Functions invocation context
 */
export async function broadcastToHub(
  sessionId: string,
  eventName: string,
  payload: any,
  context: InvocationContext
): Promise<void> {
  try {
    const signalRConnectionString = process.env.SIGNALR_CONNECTION_STRING;
    if (!signalRConnectionString || signalRConnectionString.includes('dummy')) {
      context.log('SignalR not configured, skipping broadcast to hub');
      return;
    }

    const endpointMatch = signalRConnectionString.match(/Endpoint=([^;]+)/);
    const accessKeyMatch = signalRConnectionString.match(/AccessKey=([^;]+)/);
    
    if (!endpointMatch || !accessKeyMatch) {
      context.log('Invalid SignalR connection string format');
      return;
    }

    const endpoint = endpointMatch[1];
    const accessKey = accessKeyMatch[1];
    const hubName = `dashboard${sessionId.replace(/-/g, '')}`;
    
    const crypto = require('crypto');
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600;
    
    const jwtPayload = {
      aud: `${endpoint}/api/v1/hubs/${hubName}`,
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
    
    const token = `${encodedHeader}.${encodedPayload}.${signature}`;

    const signalRUrl = `${endpoint}/api/v1/hubs/${hubName}`;
    context.log(`Broadcasting ${eventName} to hub: ${signalRUrl}`);
    
    const response = await fetch(signalRUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        target: eventName,
        arguments: [payload]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      context.log(`Broadcast to hub failed: ${response.status} - ${errorText}`);
    } else {
      context.log(`Broadcast to hub successful`);
    }
  } catch (error: any) {
    context.log(`Broadcast to hub error: ${error.message}`);
  }
}
