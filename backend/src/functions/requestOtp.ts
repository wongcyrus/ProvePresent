/**
 * Request OTP Function
 * POST /api/auth/request-otp
 * Generates and sends an OTP code to the user's email
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { 
  generateOtp, 
  isValidEmail, 
  isAllowedEmailDomain, 
  checkRateLimit, 
  storeOtp 
} from '../utils/otp';
import { sendOtpEmail } from '../utils/email';
import { isExternalTeacher } from '../utils/auth';

interface RequestOtpBody {
  email: string;
}

export async function requestOtp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/auth/request-otp request');

  try {
    // Parse request body
    const body = await request.json() as RequestOtpBody;
    const email = body.email?.trim();

    // Validate email
    if (!email) {
      return {
        status: 400,
        jsonBody: {
          error: {
            code: 'MISSING_EMAIL',
            message: 'Email is required',
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

    // Check if email is from allowed domain or is an external teacher
    const isAllowedDomain = isAllowedEmailDomain(email);
    const isExternal = await isExternalTeacher(email);

    if (!isAllowedDomain && !isExternal) {
      return {
        status: 403,
        jsonBody: {
          error: {
            code: 'UNAUTHORIZED_DOMAIN',
            message: 'Email domain not authorized',
            timestamp: Date.now()
          }
        }
      };
    }

    // Check rate limiting
    const rateLimitCheck = await checkRateLimit(email);
    if (!rateLimitCheck.allowed) {
      return {
        status: 429,
        jsonBody: {
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many OTP requests. Please try again later.',
            retryAfter: rateLimitCheck.retryAfter,
            timestamp: Date.now()
          }
        }
      };
    }

    // Generate OTP
    const otpCode = generateOtp();
    context.log(`Generated OTP for ${email}`);

    // Store OTP
    await storeOtp(email, otpCode);
    context.log(`Stored OTP for ${email}`);

    // Send OTP email
    const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES || '5', 10);
    const emailResult = await sendOtpEmail(email, otpCode, expiryMinutes);

    if (!emailResult.success) {
      context.error(`Failed to send OTP email: ${emailResult.error}`);
      return {
        status: 500,
        jsonBody: {
          error: {
            code: 'EMAIL_SEND_FAILED',
            message: 'Failed to send verification code',
            timestamp: Date.now()
          }
        }
      };
    }

    context.log(`OTP email sent successfully to ${email}`);

    return {
      status: 200,
      jsonBody: {
        success: true,
        message: 'Verification code sent to your email',
        expiresIn: expiryMinutes * 60
      }
    };

  } catch (error: any) {
    context.error('Error in requestOtp:', error);
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to process OTP request',
          timestamp: Date.now()
        }
      }
    };
  }
}

app.http('requestOtp', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/request-otp',
  handler: requestOtp
});
