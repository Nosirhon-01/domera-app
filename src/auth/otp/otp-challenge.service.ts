import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, RegistrationChallenge } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizePhone } from '../../common/utils/phone';
import { SmsService, UZ_PHONE } from '../sms/sms.service';
import { generateOtpCode, hashOtpCode, hexEqual } from '../registration/otp-crypto';

export const DEFAULT_OTP_EXPIRY_MINUTES = 3;
export const DEFAULT_OTP_MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_SECONDS = 60;
export const MAX_CODES_PER_HOUR = 5;
/** Name given to accounts created without one; the app asks for the real name (needsName). */
export const DEFAULT_USER_NAME = 'Foydalanuvchi';
const KEEP_RECORDS_MS = 24 * 3600_000;

export type OtpPurpose = 'register' | 'login';
/** Where the code went: real SMS, Eskiz test text only (no code), or nowhere (dev mode / review code). */
export type CodeDelivery = 'sms' | 'test' | 'none';

export interface IssuedCode {
  phone: string;
  code: string;
  expiresIn: number;
  delivery: CodeDelivery;
}

/**
 * One-time 6-digit phone codes shared by phone registration and OTP login.
 *  - Delivery: SMS_MODE=live sends the code by Eskiz; otherwise only OTP_DEV_MODE (never production)
 *    can show it (devCode). Without either, issuing fails with 503 instead of pretending.
 *  - Limits per phone (all purposes together): 60 s cooldown, 5 codes per hour.
 *  - Per code: OTP_EXPIRY_MINUTES validity, OTP_MAX_ATTEMPTS wrong attempts, newest code only, single use.
 * Only an HMAC of the code is stored; codes are never logged.
 */
@Injectable()
export class OtpChallengeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly sms: SmsService,
  ) {}

  /** Code is exposed in responses only when explicitly enabled and never in production. */
  get devMode(): boolean {
    return this.config.get<string>('OTP_DEV_MODE') === 'true' && this.config.get<string>('NODE_ENV') !== 'production';
  }

  get codeTtlSeconds(): number {
    return this.positiveInt('OTP_EXPIRY_MINUTES', DEFAULT_OTP_EXPIRY_MINUTES) * 60;
  }

  get maxAttempts(): number {
    return this.positiveInt('OTP_MAX_ATTEMPTS', DEFAULT_OTP_MAX_ATTEMPTS);
  }

  /** "+998901234567" or 400. Uzbek numbers must be exactly +998 + 9 digits. */
  requirePhone(raw: string): string {
    const phone = normalizePhone(raw);
    if (!phone || (phone.startsWith('+998') && phone.length !== 13)) {
      throw new BadRequestException('Invalid phone number');
    }
    return phone;
  }

  /** Older rows may hold the phone without "+". */
  phoneVariants(phone: string): string[] {
    return [phone, phone.slice(1)];
  }

  /**
   * Creates a new code for the phone and delivers it.
   * fixedCode (App Store / Play review number only): that code is used, no SMS is sent and no limits apply.
   */
  async issue(phone: string, purpose: OtpPurpose, fixedCode?: string): Promise<IssuedCode> {
    const smsMode = this.sms.mode;
    const usesSms = !fixedCode && smsMode !== 'off';

    // The code must reach the user somehow. Eskiz test mode sends only its fixed test text,
    // so without dev mode there is no way to deliver the code: refuse instead of pretending.
    if (!fixedCode && smsMode !== 'live' && !this.devMode) {
      throw new ServiceUnavailableException('SMS verification is temporarily unavailable. Please try again later');
    }
    if (usesSms && !UZ_PHONE.test(phone)) {
      throw new BadRequestException('SMS codes can only be sent to Uzbekistan numbers (+998XXXXXXXXX)');
    }

    const code = fixedCode ?? generateOtpCode();
    const expiresIn = this.codeTtlSeconds;
    // Build the SMS text first: a broken template must fail before anything is stored
    if (usesSms && smsMode === 'live') this.sms.otpMessage(code);

    const challenge = await this.prisma.$transaction(async (tx) => {
      // Serialize requests for the same phone so parallel calls cannot bypass the limits
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'otp:' + phone}))`;
      const now = Date.now();
      if (!fixedCode) await this.enforceLimits(tx, phone, now);

      await tx.registrationChallenge.deleteMany({ where: { createdAt: { lt: new Date(now - KEEP_RECORDS_MS) } } });
      return tx.registrationChallenge.create({
        data: { phone, purpose, codeHash: this.hashCode(phone, code), expiresAt: new Date(now + expiresIn * 1000) },
      });
    });

    let delivery: CodeDelivery = 'none';
    if (usesSms) {
      try {
        delivery = await this.sms.sendOtp(phone, code);
      } catch (e) {
        // Nothing reached the phone: forget this code so it does not start the cooldown
        await this.prisma.registrationChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);
        throw e;
      }
    }

    // Only the newest code of a phone (for this purpose) is usable
    await this.prisma.registrationChallenge.updateMany({
      where: { phone, purpose, consumedAt: null, id: { not: challenge.id } },
      data: { consumedAt: new Date() },
    });

    return { phone, code, expiresIn, delivery };
  }

  /** API body for a issued code. devCode only in dev mode. */
  toResponse(issued: IssuedCode) {
    return {
      message: issued.delivery === 'sms' ? 'Verification code sent by SMS' : 'Verification code created',
      phone: issued.phone,
      expiresIn: issued.expiresIn,
      retryAfter: RESEND_COOLDOWN_SECONDS,
      delivery: issued.delivery,
      ...(this.devMode ? { devCode: issued.code } : {}),
    };
  }

  /**
   * Checks the newest open code of this purpose. On success the challenge is updated with
   * `onSuccess` atomically (only one request can win). Throws 400 otherwise.
   */
  async check(
    phone: string,
    purpose: OtpPurpose,
    code: string,
    onSuccess: Prisma.RegistrationChallengeUpdateManyMutationInput,
  ): Promise<RegistrationChallenge> {
    const maxAttempts = this.maxAttempts;
    const challenge = await this.prisma.registrationChallenge.findFirst({
      where: { phone, purpose, consumedAt: null, verifiedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) {
      throw new BadRequestException('Code expired or not requested. Request a new code');
    }

    // Count the attempt atomically before comparing, so parallel guesses cannot exceed the limit
    const counted = await this.prisma.registrationChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, verifiedAt: null, attempts: { lt: maxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0) {
      throw new BadRequestException('Too many wrong attempts. Request a new code');
    }

    if (!hexEqual(challenge.codeHash, this.hashCode(phone, code))) {
      const attemptsLeft = Math.max(0, maxAttempts - challenge.attempts - 1);
      if (attemptsLeft === 0) {
        throw new BadRequestException('Too many wrong attempts. Request a new code');
      }
      throw new BadRequestException(`Invalid code. Attempts left: ${attemptsLeft}`);
    }

    const won = await this.prisma.registrationChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, verifiedAt: null, expiresAt: { gt: new Date() } },
      data: onSuccess,
    });
    if (won.count === 0) {
      throw new BadRequestException('Code already used or expired. Request a new code');
    }
    return challenge;
  }

  private async enforceLimits(tx: Prisma.TransactionClient, phone: string, now: number) {
    const last = await tx.registrationChallenge.findFirst({ where: { phone }, orderBy: { createdAt: 'desc' } });
    if (last) {
      const waited = (now - last.createdAt.getTime()) / 1000;
      if (waited < RESEND_COOLDOWN_SECONDS) {
        const retryAfter = Math.ceil(RESEND_COOLDOWN_SECONDS - waited);
        throw new HttpException(
          { message: `Please wait ${retryAfter}s before requesting a new code`, retryAfter },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    const lastHour = await tx.registrationChallenge.findMany({
      where: { phone, createdAt: { gt: new Date(now - 3600_000) } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    if (lastHour.length >= MAX_CODES_PER_HOUR) {
      const retryAfter = Math.max(1, Math.ceil((lastHour[0].createdAt.getTime() + 3600_000 - now) / 1000));
      throw new HttpException(
        { message: 'Too many codes requested for this number, try again later', retryAfter },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private hashCode(phone: string, code: string): string {
    const secret = this.config.get<string>('JWT_ACCESS_SECRET') || 'domera_default_access_secret';
    return hashOtpCode(secret, phone, code);
  }

  private positiveInt(key: string, fallback: number): number {
    const n = Number(this.config.get(key));
    return Number.isInteger(n) && n > 0 ? n : fallback;
  }
}
