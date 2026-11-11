/**
 * Checks the Eskiz SMS setup using the same code as the API (SmsService).
 * Prints no credentials, tokens or codes.
 *
 *   npm run sms:check                                  # config + Eskiz login only, no SMS (free)
 *   npm run sms:check -- --send +998901234567          # sends ONE SMS:
 *        SMS_MODE=test → the Eskiz test text (ESKIZ_TEST_MESSAGE)
 *        SMS_MODE=live → OTP_MESSAGE_TEMPLATE with a random code (checks the template is approved)
 */
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';
import { SmsService } from '../src/auth/sms/sms.service';
import { generateOtpCode } from '../src/auth/registration/otp-crypto';
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
  console.log('NODE_ENV             :', config.get('NODE_ENV') || '(unset)');
  console.log('SMS_MODE             :', sms.mode);
  console.log('ESKIZ_EMAIL          :', set('ESKIZ_EMAIL'));
  console.log('ESKIZ_PASSWORD       :', set('ESKIZ_PASSWORD'));
  console.log('ESKIZ_FROM           :', config.get('ESKIZ_FROM') || '4546 (default)');
  console.log('ESKIZ_BASE_URL       :', config.get('ESKIZ_BASE_URL') || '(default)');
  if (sms.mode === 'test') console.log('ESKIZ_TEST_MESSAGE   :', JSON.stringify(sms.testMessage));
  if (sms.mode === 'live') {
    try {
      console.log('SMS will look like   :', JSON.stringify(sms.otpMessage('123456')));
    } catch {
      // reported below as a config problem
    }
  }

  const problems = sms.configProblems();
  if (problems.length) {
    problems.forEach((p) => console.log('PROBLEM:', p));
    process.exit(1);
  }
  if (sms.mode === 'off') {
    console.log('SMS_MODE=off — set SMS_MODE=test or live to check Eskiz.');
    return;
  }

  await sms.checkCredentials();
  console.log('Eskiz login          : OK (credentials accepted)');

  const to = arg('--send');
  if (!to) {
    console.log('No SMS sent. Add --send +998XXXXXXXXX to send one SMS.');
    return;
  }
  const phone = normalizePhone(to);
  if (!phone) throw new Error('Invalid phone number for --send');

  const delivery = await sms.sendOtp(phone, generateOtpCode());
  const masked = `${phone.slice(0, 6)}*****${phone.slice(-2)}`;
  console.log(
    delivery === 'test'
      ? `Eskiz accepted the TEST text to ${masked}. It contains no code. Check the phone and Eskiz cabinet (SMS history).`
      : `Eskiz accepted the OTP SMS to ${masked}. Check the phone and Eskiz cabinet (status "delivered").`,
  );
}

main().catch((e) => {
  const status = typeof e?.getStatus === 'function' ? ` (HTTP ${e.getStatus()} in the API)` : '';
  console.error(`FAILED: ${e?.message ?? e}${status}`);
  process.exit(1);
});
