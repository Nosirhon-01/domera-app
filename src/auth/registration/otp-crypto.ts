import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';

/** Cryptographically secure 6-digit code (000000-999999, uniform). */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** HMAC so a leaked table cannot be brute-forced offline without the server secret. */
export function hashOtpCode(secret: string, phone: string, code: string): string {
  return createHmac('sha256', secret).update(`registration-otp:${phone}:${code}`).digest('hex');
}

/** 256-bit random one-time token, URL-safe. */
export function generateVerificationToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function hexEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length > 0 && ba.length === bb.length && timingSafeEqual(ba, bb);
}
