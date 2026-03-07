/**
 * JWT (JSON Web Token) Utilities
 * Handles token generation and validation for authentication
 */

import * as jwt from 'jsonwebtoken';
import { createHash } from 'crypto';

// Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRY_HOURS = parseInt(process.env.JWT_EXPIRY_HOURS || '24', 10);
const JWT_ALGORITHM = 'HS256';

export interface JWTPayload {
  sub: string;          // User email (subject)
  userId: string;       // Unique user ID (email-based hash)
  email: string;        // User email
  roles: string[];      // ['teacher'] or ['student']
  iat: number;          // Issued at timestamp
  exp: number;          // Expiration timestamp
}

export interface ClientPrincipal {
  userId: string;
  userDetails: string;
  identityProvider: string;
  userRoles: string[];
}

/**
 * Generate a deterministic user ID from email
 */
export function generateUserId(email: string): string {
  return createHash('sha256').update(email.toLowerCase()).digest('hex').substring(0, 32);
}

/**
 * Get roles from email address
 */
export function getRolesFromEmail(email: string): string[] {
  const emailLower = email.toLowerCase();
  const roles: string[] = ['authenticated'];
  
  // Teacher: @vtc.edu.hk (excluding @stu.vtc.edu.hk)
  if (emailLower.endsWith('@vtc.edu.hk') && !emailLower.endsWith('@stu.vtc.edu.hk')) {
    roles.push('teacher');
  }
  // Student: @stu.vtc.edu.hk
  else if (emailLower.endsWith('@stu.vtc.edu.hk')) {
    roles.push('student');
  }
  
  return roles;
}

/**
 * Sign a JWT token for a user
 */
export function signToken(email: string, roles?: string[]): string {
  const userId = generateUserId(email);
  const userRoles = roles || getRolesFromEmail(email);
  
  const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
    sub: email.toLowerCase(),
    userId,
    email: email.toLowerCase(),
    roles: userRoles
  };
  
  return jwt.sign(payload, JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: `${JWT_EXPIRY_HOURS}h`
  });
}

/**
 * Verify and decode a JWT token
 * Returns payload if valid, null if invalid
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: [JWT_ALGORITHM]
    }) as JWTPayload;
    
    return decoded;
  } catch (error) {
    return null;
  }
}

/**
 * Convert JWT payload to ClientPrincipal format (for backward compatibility)
 */
export function jwtToClientPrincipal(payload: JWTPayload): ClientPrincipal {
  return {
    userId: payload.userId,
    userDetails: payload.email,
    identityProvider: 'email-otp',
    userRoles: payload.roles
  };
}

/**
 * Parse JWT from Authorization header or cookie
 */
export function extractTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }
  
  // Support "Bearer <token>" format
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Support raw token
  return authHeader;
}

/**
 * Parse JWT from cookie string
 */
export function extractTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) {
    return null;
  }
  
  const cookies = cookieHeader.split(';').map(c => c.trim());
  const authCookie = cookies.find(c => c.startsWith('auth-token='));
  
  if (!authCookie) {
    return null;
  }
  
  return authCookie.substring('auth-token='.length);
}

/**
 * Validate JWT secret is properly configured
 */
export function validateJwtConfig(): { valid: boolean; error?: string } {
  if (!JWT_SECRET || JWT_SECRET === 'dev-secret-change-in-production') {
    if (process.env.NODE_ENV === 'production') {
      return { valid: false, error: 'JWT_SECRET must be configured in production' };
    }
  }
  
  if (JWT_SECRET.length < 32) {
    return { valid: false, error: 'JWT_SECRET must be at least 32 characters' };
  }
  
  return { valid: true };
}
