/**
 * OTP (One-Time Password) Utilities
 * Handles OTP generation, validation, and storage
 */

import { createHash } from 'crypto';
import { getTableClient, TableNames } from './database';

// Configuration
const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES || '5', 10);
const OTP_MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS || '3', 10);
const OTP_RATE_LIMIT_MINUTES = parseInt(process.env.OTP_RATE_LIMIT_MINUTES || '15', 10);
const OTP_RATE_LIMIT_COUNT = parseInt(process.env.OTP_RATE_LIMIT_COUNT || '3', 10);

interface OtpEntity {
  partitionKey: string;
  rowKey: string;
  codeHash: string;
  expiresAt: string;
  attempts: number;
  createdAt: string;
  requestCount?: number;
  firstRequestAt?: string;
}

/**
 * Generate a random 6-digit OTP
 */
export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Hash an OTP code using SHA-256
 */
export function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Check if email is from allowed domains
 * Returns true for VTC domains and external teachers (checked separately)
 */
export function isAllowedEmailDomain(email: string): boolean {
  const emailLower = email.toLowerCase();
  return emailLower.endsWith('@vtc.edu.hk') || emailLower.endsWith('@stu.vtc.edu.hk');
}

/**
 * Check rate limiting for OTP requests
 * Returns { allowed: boolean, retryAfter?: number }
 */
export async function checkRateLimit(email: string): Promise<{ allowed: boolean; retryAfter?: number }> {
  const emailLower = email.toLowerCase();
  const table = getTableClient(TableNames.OTP_CODES);
  
  try {
    const entity = await table.getEntity<OtpEntity>('OTP', emailLower);
    
    const now = Date.now();
    const firstRequestAt = entity.firstRequestAt ? new Date(entity.firstRequestAt).getTime() : now;
    const requestCount = entity.requestCount || 0;
    const timeSinceFirstRequest = now - firstRequestAt;
    const rateLimitWindow = OTP_RATE_LIMIT_MINUTES * 60 * 1000;
    
    // If we're outside the rate limit window, reset
    if (timeSinceFirstRequest > rateLimitWindow) {
      return { allowed: true };
    }
    
    // Check if we've exceeded the rate limit
    if (requestCount >= OTP_RATE_LIMIT_COUNT) {
      const retryAfter = Math.ceil((rateLimitWindow - timeSinceFirstRequest) / 1000);
      return { allowed: false, retryAfter };
    }
    
    return { allowed: true };
  } catch (error: any) {
    // Entity doesn't exist, allow the request
    if (error.statusCode === 404) {
      return { allowed: true };
    }
    throw error;
  }
}

/**
 * Store OTP in table storage
 */
export async function storeOtp(email: string, otpCode: string): Promise<void> {
  const emailLower = email.toLowerCase();
  const table = getTableClient(TableNames.OTP_CODES);
  
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000);
  
  // Get existing entity to preserve rate limit data
  let existingEntity: OtpEntity | null = null;
  try {
    existingEntity = await table.getEntity<OtpEntity>('OTP', emailLower);
  } catch (error: any) {
    if (error.statusCode !== 404) {
      throw error;
    }
  }
  
  const timeSinceFirstRequest = existingEntity?.firstRequestAt 
    ? now.getTime() - new Date(existingEntity.firstRequestAt).getTime()
    : 0;
  const rateLimitWindow = OTP_RATE_LIMIT_MINUTES * 60 * 1000;
  
  // Reset rate limit counters if outside window
  const shouldResetRateLimit = !existingEntity || timeSinceFirstRequest > rateLimitWindow;
  
  const entity: OtpEntity = {
    partitionKey: 'OTP',
    rowKey: emailLower,
    codeHash: hashOtp(otpCode),
    expiresAt: expiresAt.toISOString(),
    attempts: 0,
    createdAt: now.toISOString(),
    requestCount: shouldResetRateLimit ? 1 : (existingEntity?.requestCount || 0) + 1,
    firstRequestAt: shouldResetRateLimit ? now.toISOString() : (existingEntity?.firstRequestAt || now.toISOString())
  };
  
  await table.upsertEntity(entity, 'Replace');
}

/**
 * Verify OTP code
 * Returns { valid: boolean, attemptsRemaining?: number, error?: string }
 */
export async function verifyOtp(
  email: string, 
  otpCode: string
): Promise<{ valid: boolean; attemptsRemaining?: number; error?: string }> {
  const emailLower = email.toLowerCase();
  const table = getTableClient(TableNames.OTP_CODES);
  
  try {
    const entity = await table.getEntity<OtpEntity>('OTP', emailLower);
    
    // Check expiry
    const now = new Date();
    const expiresAt = new Date(entity.expiresAt);
    if (now > expiresAt) {
      return { valid: false, error: 'OTP_EXPIRED' };
    }
    
    // Check attempts
    if (entity.attempts >= OTP_MAX_ATTEMPTS) {
      return { valid: false, error: 'MAX_ATTEMPTS_EXCEEDED' };
    }
    
    // Verify OTP
    const codeHash = hashOtp(otpCode);
    if (codeHash !== entity.codeHash) {
      // Increment attempts
      entity.attempts += 1;
      await table.updateEntity(entity, 'Merge');
      
      const attemptsRemaining = OTP_MAX_ATTEMPTS - entity.attempts;
      return { valid: false, attemptsRemaining, error: 'INVALID_OTP' };
    }
    
    // Valid OTP - delete the entity
    await table.deleteEntity('OTP', emailLower);
    
    return { valid: true };
  } catch (error: any) {
    if (error.statusCode === 404) {
      return { valid: false, error: 'OTP_NOT_FOUND' };
    }
    throw error;
  }
}

/**
 * Clean up expired OTP codes (can be called periodically)
 */
export async function cleanupExpiredOtps(): Promise<number> {
  const table = getTableClient(TableNames.OTP_CODES);
  const now = new Date();
  let deletedCount = 0;
  
  try {
    for await (const entity of table.listEntities<OtpEntity>()) {
      const expiresAt = new Date(entity.expiresAt);
      if (now > expiresAt) {
        await table.deleteEntity(entity.partitionKey, entity.rowKey);
        deletedCount++;
      }
    }
  } catch (error: any) {
    // Table might not exist yet
    if (error.statusCode === 404) {
      return 0;
    }
    throw error;
  }
  
  return deletedCount;
}
