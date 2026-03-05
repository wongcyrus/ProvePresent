import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import nodemailer from 'nodemailer';

interface OnOtpSendRequestBody {
  data?: {
    otpContext?: {
      identifier?: string;
      oneTimeCode?: string;
      onetimecode?: string;
    };
    authenticationContext?: {
      correlationId?: string;
      requestType?: string;
      client?: {
        locale?: string;
        market?: string;
      };
    };
  };
}

function getOtpSendResponse(): HttpResponseInit {
  return {
    status: 200,
    jsonBody: {
      data: {
        '@odata.type': 'microsoft.graph.OnOtpSendResponseData',
        actions: [
          {
            '@odata.type': 'microsoft.graph.OtpSend.continueWithDefaultBehavior'
          }
        ]
      }
    }
  };
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function buildEmailHtml(otpCode: string, appName: string): string {
  return `
  <html>
    <body style="font-family: Arial, Helvetica, sans-serif; color: #1f2937; line-height: 1.6;">
      <h2 style="margin: 0 0 12px 0;">Your verification code</h2>
      <p style="margin: 0 0 12px 0;">Use this code to continue signing in to ${appName}:</p>
      <p style="font-size: 28px; font-weight: 700; letter-spacing: 3px; margin: 8px 0 16px 0;">${otpCode}</p>
      <p style="margin: 0 0 8px 0;">This code is time-limited. If you did not request it, you can ignore this email.</p>
    </body>
  </html>`;
}

export async function onOtpSendEmail(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const body = (await request.json()) as OnOtpSendRequestBody;

    const recipientEmail = body?.data?.otpContext?.identifier;
    const otpCode = body?.data?.otpContext?.oneTimeCode || body?.data?.otpContext?.onetimecode;
    const correlationId = body?.data?.authenticationContext?.correlationId || 'n/a';

    if (!recipientEmail || !otpCode) {
      context.error(`[onOtpSendEmail] Invalid payload. correlationId=${correlationId}`);
      return {
        status: 400,
        jsonBody: {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Missing otpContext.identifier or otpContext.oneTimeCode'
          }
        }
      };
    }

    const smtpHost = process.env.OTP_SMTP_HOST || 'smtp.gmail.com';
    const smtpPort = Number(process.env.OTP_SMTP_PORT || 465);
    const smtpSecure = parseBoolean(process.env.OTP_SMTP_SECURE, true);
    const smtpUser = process.env.OTP_SMTP_USERNAME;
    const smtpPass = process.env.OTP_SMTP_PASSWORD;
    const fromEmail = process.env.OTP_FROM_EMAIL || smtpUser;
    const fromName = process.env.OTP_FROM_NAME || 'QR Chain Attend';
    const subject = process.env.OTP_EMAIL_SUBJECT || 'Your verification code';
    const appName = process.env.OTP_APP_NAME || 'QR Chain Attend';

    if (!smtpUser || !smtpPass || !fromEmail) {
      context.error('[onOtpSendEmail] Missing SMTP environment variables');
      return {
        status: 500,
        jsonBody: {
          error: {
            code: 'CONFIG_ERROR',
            message: 'Missing OTP SMTP configuration'
          }
        }
      };
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    });

    await transporter.sendMail({
      from: `${fromName} <${fromEmail}>`,
      to: recipientEmail,
      subject,
      text: `Your verification code for ${appName} is: ${otpCode}`,
      html: buildEmailHtml(otpCode, appName)
    });

    context.log(`[onOtpSendEmail] OTP sent. correlationId=${correlationId} recipient=${recipientEmail}`);
    return getOtpSendResponse();
  } catch (error: any) {
    context.error(`[onOtpSendEmail] Failed to send OTP: ${error?.message || 'unknown error'}`);
    return {
      status: 500,
      jsonBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to send OTP email'
        }
      }
    };
  }
}

app.http('onOtpSendEmail', {
  methods: ['POST'],
  route: 'auth/on-otp-send-email',
  authLevel: 'function',
  handler: onOtpSendEmail
});
