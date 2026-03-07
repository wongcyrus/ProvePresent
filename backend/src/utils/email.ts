/**
 * Email Utilities
 * Handles sending emails via SMTP
 */

import nodemailer from 'nodemailer';

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
}

/**
 * Get email configuration from environment variables
 */
export function getEmailConfig(): EmailConfig {
  return {
    host: process.env.OTP_SMTP_HOST || '',
    port: parseInt(process.env.OTP_SMTP_PORT || '465', 10),
    secure: process.env.OTP_SMTP_SECURE !== 'false',
    username: process.env.OTP_SMTP_USERNAME || '',
    password: process.env.OTP_SMTP_PASSWORD || '',
    fromEmail: process.env.OTP_FROM_EMAIL || '',
    fromName: process.env.OTP_FROM_NAME || 'VTC Attendance'
  };
}

/**
 * Validate email configuration
 */
export function validateEmailConfig(config: EmailConfig): { valid: boolean; error?: string } {
  if (!config.host) {
    return { valid: false, error: 'OTP_SMTP_HOST not configured' };
  }
  if (!config.username) {
    return { valid: false, error: 'OTP_SMTP_USERNAME not configured' };
  }
  if (!config.password) {
    return { valid: false, error: 'OTP_SMTP_PASSWORD not configured' };
  }
  if (!config.fromEmail) {
    return { valid: false, error: 'OTP_FROM_EMAIL not configured' };
  }
  return { valid: true };
}

/**
 * Build OTP email HTML
 */
export function buildOtpEmailHtml(otpCode: string, appName: string, expiryMinutes: number): string {
  return `
  <html>
    <body style="font-family: Arial, Helvetica, sans-serif; color: #1f2937; line-height: 1.6;">
      <h2 style="margin: 0 0 12px 0;">Your verification code</h2>
      <p style="margin: 0 0 12px 0;">Use this code to sign in to ${appName}:</p>
      <p style="font-size: 28px; font-weight: 700; letter-spacing: 3px; margin: 8px 0 16px 0;">${otpCode}</p>
      <p style="margin: 0 0 8px 0;">This code will expire in ${expiryMinutes} minutes.</p>
      <p style="margin: 0 0 8px 0;">If you did not request this code, you can safely ignore this email.</p>
    </body>
  </html>`;
}

/**
 * Send OTP email
 */
export async function sendOtpEmail(
  toEmail: string,
  otpCode: string,
  expiryMinutes: number = 5
): Promise<{ success: boolean; error?: string }> {
  const config = getEmailConfig();
  
  // Validate configuration
  const validation = validateEmailConfig(config);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  
  const appName = process.env.OTP_APP_NAME || 'ProvePresent';
  const subject = process.env.OTP_EMAIL_SUBJECT || 'Your verification code';
  
  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.username,
        pass: config.password
      }
    });
    
    await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to: toEmail,
      subject: subject,
      html: buildOtpEmailHtml(otpCode, appName, expiryMinutes)
    });
    
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to send email' };
  }
}
