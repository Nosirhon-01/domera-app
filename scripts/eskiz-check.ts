/**
 * Checks the Eskiz SMS setup using the same code path as the API (SmsService).
 * Prints no credentials, tokens or codes.
 *
 *   npm run sms:check                               # config + Eskiz login only, no SMS (free)
 *   npm run sms:check -- --send +998901234567       # also sends one OTP-template SMS
 *   npm run sms:check -- --send +998901234567 --text "Bu Eskiz dan test"   # exact text (Eskiz test mode)
 */
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomInt } from 'crypto';
import * as dotenv from 'dotenv';
import { SmsService } from '../src/auth/otp/sms.service';
import { normalizePhone } from '../src/common/utils/phone';

dotenv.config();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  Logger.overrideLogger(['error', 'warn']);
  const config = new ConfigService();
  const sms = new SmsService(config);

  const set = (k: string) => (config.get<string>(k) ? 'set' : 'NOT SET');
  console.log('NODE_ENV               :', config.get('NODE_ENV') || '(unset)');
  console.log('SMS_PROVIDER           :', sms.provider);
  console.log('ESKIZ_EMAIL            :', set('ESKIZ_EMAIL'));
  console.log('ESKIZ_PASSWORD         :', set('ESKIZ_PASSWORD'));
  console.log('ESKIZ_FROM             :', config.get('ESKIZ_FROM') || '4546 (default)');
  const problems = sms.configProblems();
  const template = config.get<string>('OTP_MESSAGE_TEMPLATE');
  console.log('OTP_MESSAGE_TEMPLATE   :', template ? JSON.stringify(template) : '(unset, default used)');
  if (!problems.some((p) => p.includes('{code}'))) {
    console.log('  SMS will look like   :', JSON.stringify(sms.otpMessage('123456')));
  }

  if (problems.length) {
    problems.forEach((p) => console.log('PROBLEM:', p));
    process.exit(1);
  }
  if (sms.provider !== 'eskiz') {
    console.log('SMS_PROVIDER is not eskiz — nothing to check against Eskiz.');
    return;
  }

  await sms.checkEskizCredentials();
  console.log('Eskiz login            : OK (credentials accepted)');

  const to = arg('--send');
  if (!to) {
    console.log('No SMS sent. Add --send +998XXXXXXXXX to send one test SMS.');
    return;
  }
  const phone = normalizePhone(to);
  if (!phone) throw new Error('Invalid phone number for --send');

  const text = arg('--text') ?? sms.otpMessage(randomInt(0, 1_000_000).toString().padStart(6, '0'));
  await sms.send(phone, text);
  console.log(`Eskiz accepted the SMS to ${phone.slice(0, 6)}*****${phone.slice(-2)}. Check the phone and the Eskiz cabinet (SMS history).`);
}

main().catch((e) => {
  const status = typeof e?.getStatus === 'function' ? ` (HTTP ${e.getStatus()} in the API)` : '';
  console.error(`FAILED: ${e?.message ?? e}${status}`);
  process.exit(1);
});
