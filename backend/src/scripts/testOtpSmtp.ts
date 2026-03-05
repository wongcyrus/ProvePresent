import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';

type KeyValueMap = Record<string, string>;

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseArgs(): { configPath?: string; to?: string; send: boolean } {
  const args = process.argv.slice(2);
  let configPath: string | undefined;
  let to: string | undefined;
  let send = false;

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === '--config' && args[index + 1]) {
      configPath = args[index + 1];
      index += 1;
      continue;
    }
    if (current === '--to' && args[index + 1]) {
      to = args[index + 1];
      index += 1;
      continue;
    }
    if (current === '--send') {
      send = true;
    }
  }

  return { configPath, to, send };
}

function normalizeValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readKeyValueFile(filePath: string): KeyValueMap {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const output: KeyValueMap = {};
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = normalizeValue(line.slice(separatorIndex + 1));
    if (key) {
      output[key] = value;
    }
  }

  return output;
}

function resolveConfigPath(providedPath?: string): string | undefined {
  if (providedPath) {
    return path.isAbsolute(providedPath) ? providedPath : path.resolve(process.cwd(), providedPath);
  }

  const candidates = [
    path.resolve(process.cwd(), '.otp-email-credentials'),
    path.resolve(process.cwd(), '../.otp-email-credentials')
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function main(): Promise<void> {
  const { configPath, to, send } = parseArgs();
  const resolvedConfigPath = resolveConfigPath(configPath);
  const fileValues = resolvedConfigPath ? readKeyValueFile(resolvedConfigPath) : {};

  const getValue = (key: string, defaultValue = ''): string => process.env[key] || fileValues[key] || defaultValue;

  const smtpHost = getValue('OTP_SMTP_HOST', 'smtp.gmail.com');
  const smtpPort = Number(getValue('OTP_SMTP_PORT', '465'));
  const smtpSecure = parseBoolean(getValue('OTP_SMTP_SECURE', 'true'), true);
  const smtpUser = getValue('OTP_SMTP_USERNAME');
  const smtpPass = getValue('OTP_SMTP_PASSWORD');
  const fromEmail = getValue('OTP_FROM_EMAIL', smtpUser);
  const fromName = getValue('OTP_FROM_NAME', 'QR Chain Attend');

  if (!smtpUser || !smtpPass || !fromEmail) {
    console.error('Missing required SMTP settings. Need OTP_SMTP_USERNAME, OTP_SMTP_PASSWORD, OTP_FROM_EMAIL.');
    process.exitCode = 1;
    return;
  }

  console.log('SMTP config source:', resolvedConfigPath || 'process.env');
  console.log('SMTP host/port:', `${smtpHost}:${smtpPort}`, 'secure=', smtpSecure);
  console.log('SMTP username:', smtpUser);

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });

  await transporter.verify();
  console.log('✅ SMTP verify passed');

  if (send) {
    if (!to) {
      console.error('Missing recipient. Use --to <email> together with --send.');
      process.exitCode = 1;
      return;
    }

    await transporter.sendMail({
      from: `${fromName} <${fromEmail}>`,
      to,
      subject: 'SMTP test from QR Chain Attend',
      text: 'SMTP settings are valid. This is a test email.'
    });
    console.log(`✅ Test email sent to ${to}`);
  }
}

main().catch((error: any) => {
  console.error('❌ SMTP test failed:', error?.message || error);
  process.exitCode = 1;
});
