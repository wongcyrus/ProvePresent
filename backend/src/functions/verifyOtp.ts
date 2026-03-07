/**
 * Verify OTP Function
 * POST /api/auth/verify-otp
 * Validates OTP code and issues JWT token
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { verifyOtp, isValidEmail } from '../utils/otp';
import { signToken, getRolesFromEmail } from '../utils/jwt';
import { isExternalTeacher } from '../utils/auth';

interface VerifyOtpBody {
  email: string;
  otp: string;
}

export async function verifyOtpHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/auth/verify-otp request');

  try {
    // Parse request body
    const body = await request.json() as VerifyOtpBody;
    const email = body.email?.trim();
    const otp = body.otp?.trim();

    // Validate inputs
    if (!email || !otp) {
      return {
        status: 400,
        jsonBody: {
          error: {
            code: 'MISSING_FIELDS',
            message: 'Email and OTP are required',
            timestamp: Date.now()
          }
        }
      };
    }

    if (!isValidEmail(email)) {
      return {
        status: 400,
        jsonBody: {
          error: {
            code: 'INVALID_EMAIL',
            message: 'Invalid email format',
            timestamp: Date.now()
          }
        }
      };
    }

    if (!/^\d{6}$/.test(otp)) {
      return {
        status: 400,
        jsonBody: {
          error: {
            code: 'INVALID_OTP_FORMAT',
            message: 'OTP must be 6 digits',
            timestamp: Date.now()
          }
        }
      };
    }

    // Verify OTP
    const verification = await verifyOtp(email, otp);

    if (!verification.valid) {
      const errorMessages: Record<string, string> = {
        'OTP_EXPIRED': 'Verification code has expired',
        'MAX_ATTEMPTS_EXCEEDED': 'Too many failed attempts',
        'INVALID_OTP': 'Invalid verification code',
        'OTP_NOT_FOUND': 'No verification code found for this email'
      };

      return {
        status: 401,
        jsonBody: {
          error: {
            code: verification.error || 'INVALID_OTP',
            message: errorMessages[verification.error || 'INVALID_OTP'] || 'Invalid verification code',
            attemptsRemaining: verification.attemptsRemaining,
            timestamp: Date.now()
          }
        }
      };
    }

    // Get user roles (check external teachers for non-VTC domains)
    let roles = getRolesFromEmail(email);
    if (roles.length === 1 && roles[0] === 'authenticated') {
      // Not a VTC domain, check if external teacher
      const isExternal = await isExternalTeacher(email);
      if (isExternal) {
        roles = ['authenticated', 'teacher'];
      }
    }

    // Generate JWT token
    const token = signToken(email, roles);
    context.log(`Generated JWT token for ${email} with roles: ${roles.join(', ')}`);

    // Set token as HttpOnly cookie
    const isProduction = process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Production';
    const cookieOptions = [
      'auth-token=' + token,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=86400' // 24 hours
    ];

    if (isProduction) {
      cookieOptions.push('Secure');
    }

    const setCookieHeader = cookieOptions.join('; ');

    // Return user info (compatible with clientPrincipal format)
    return {
      status: 200,
      headers: {
        'Set-Cookie': setCookieHeader
      },
      jsonBody: {
        success: true,
        user: {
          userId: email.toLowerCase(),
          userDetails: email.toLowerCase(),
          userRoles: roles
        }
      }
    };

  } catch (error: any) {
    context.error('Error in verifyOtp:', error);
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to verify OTP',
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('verifyOtp', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/verify-otp',
  handler: verifyOtpHandler
});
