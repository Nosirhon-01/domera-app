import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth.service';
import { RegisterCompleteDto, RegisterRequestCodeDto, RegisterVerifyCodeDto } from '../dto/registration.dto';
import { normalizePhone } from '../../common/utils/phone';

export const CODE_TTL_SECONDS = 180;
export const RESEND_COOLDOWN_SECONDS = 60;
export const MAX_CODES_PER_HOUR = 5;
export const MAX_VERIFY_ATTEMPTS = 5;
export const TOKEN_TTL_SECONDS = 600;
const KEEP_RECORDS_MS = 24 * 3600_000;
const DEFAULT_NAME = 'Foydalanuvchi';

/**
 * Phone registration without SMS:
 *   1. request-code  → random 6-digit code (returned as devCode only when OTP_DEV_MODE=true outside production)
 *   2. verify-code   → one-time verificationToken
 *   3. complete      → user is created with a bcrypt password, JWT pair returned
 * Only hashes of the code and of the token are stored. Neither is ever logged.
 */
@Injectable()
export class RegistrationService implements OnModuleInit {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly authService: AuthService,
  ) {}

  onModuleInit() {
    if (this.devMode) {
      this.logger.warn('OTP_DEV_MODE=true: registration codes are returned in API responses (development/test only)');
    }
  }

  /** Code is exposed in responses only when explicitly enabled and never in production. */
  get devMode(): boolean {
    return this.config.get<string>('OTP_DEV_MODE') === 'true' && this.config.get<string>('NODE_ENV') !== 'production';
  }

  async requestCode(dto: RegisterRequestCodeDto) {
    const phone = this.requirePhone(dto.phone);
    await this.ensurePhoneFree(phone);

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');

    await this.prisma.$transaction(async (tx) => {
      // Serialize requests for the same phone so parallel calls cannot bypass the limits
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'registration:' + phone}))`;

      const now = Date.now();
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

      // Only the newest challenge of a phone is usable
      await tx.registrationChallenge.updateMany({
        where: { phone, consumedAt: null },
        data: { consumedAt: new Date(now) },
      });
      await tx.registrationChallenge.deleteMany({ where: { createdAt: { lt: new Date(now - KEEP_RECORDS_MS) } } });
      await tx.registrationChallenge.create({
        data: {
          phone,
          codeHash: this.hashCode(phone, code),
          expiresAt: new Date(now + CODE_TTL_SECONDS * 1000),
        },
      });
    });

    return {
      message: 'Verification code created',
      phone,
      expiresIn: CODE_TTL_SECONDS,
      retryAfter: RESEND_COOLDOWN_SECONDS,
      ...(this.devMode ? { devCode: code } : {}),
    };
  }

  async verifyCode(dto: RegisterVerifyCodeDto) {
    const phone = this.requirePhone(dto.phone);

    const challenge = await this.prisma.registrationChallenge.findFirst({
      where: { phone, consumedAt: null, verifiedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) {
      throw new BadRequestException('Code expired or not requested. Request a new code');
    }

    // Count the attempt atomically before comparing, so parallel guesses cannot exceed the limit
    const counted = await this.prisma.registrationChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, verifiedAt: null, attempts: { lt: MAX_VERIFY_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0) {
      throw new BadRequestException('Too many wrong attempts. Request a new code');
    }

    if (!this.safeEqual(challenge.codeHash, this.hashCode(phone, dto.code))) {
      const attemptsLeft = Math.max(0, MAX_VERIFY_ATTEMPTS - challenge.attempts - 1);
      if (attemptsLeft === 0) {
        throw new BadRequestException('Too many wrong attempts. Request a new code');
      }
      throw new BadRequestException(`Invalid code. Attempts left: ${attemptsLeft}`);
    }

    const verificationToken = randomBytes(32).toString('base64url');
    const verified = await this.prisma.registrationChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, verifiedAt: null, expiresAt: { gt: new Date() } },
      data: {
        verifiedAt: new Date(),
        tokenHash: this.hashToken(verificationToken),
        tokenExpiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000),
      },
    });
    if (verified.count === 0) {
      throw new BadRequestException('Code already used or expired. Request a new code');
    }

    return { message: 'Phone number verified', phone, verificationToken, expiresIn: TOKEN_TTL_SECONDS };
  }

  async complete(dto: RegisterCompleteDto) {
    if (dto.password !== dto.passwordConfirmation) {
      throw new BadRequestException('Passwords do not match');
    }

    const invalidToken = () => new BadRequestException('Verification token is invalid, expired or already used');
    const challenge = await this.prisma.registrationChallenge.findUnique({
      where: { tokenHash: this.hashToken(dto.verificationToken) },
    });
    if (
      !challenge ||
      !challenge.verifiedAt ||
      challenge.consumedAt ||
      !challenge.tokenExpiresAt ||
      challenge.tokenExpiresAt <= new Date()
    ) {
      throw invalidToken();
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    let user;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        // One-time: only the first request consumes the token (rolled back if user creation fails)
        const consumed = await tx.registrationChallenge.updateMany({
          where: { id: challenge.id, consumedAt: null, tokenExpiresAt: { gt: new Date() } },
          data: { consumedAt: new Date() },
        });
        if (consumed.count === 0) throw invalidToken();

        const taken = await tx.user.findFirst({ where: { phone: { in: this.phoneVariants(challenge.phone) } } });
        if (taken) throw new ConflictException('This phone number is already registered');

        return tx.user.create({
          data: {
            name: dto.name?.trim() || DEFAULT_NAME,
            phone: challenge.phone,
            password: passwordHash,
            role: Role.USER,
            isActive: true,
          },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('This phone number is already registered');
      }
      throw e;
    }

    const session = await this.authService.issueSession(user);
    return { message: 'Registration successful', ...session };
  }

  private async ensurePhoneFree(phone: string) {
    const existing = await this.prisma.user.findFirst({ where: { phone: { in: this.phoneVariants(phone) } } });
    if (existing) {
      throw new ConflictException('This phone number is already registered. Please log in');
    }
  }

  /** Older rows may hold the phone without "+". */
  private phoneVariants(phone: string): string[] {
    return [phone, phone.slice(1)];
  }

  private requirePhone(raw: string): string {
    const phone = normalizePhone(raw);
    // Uzbek numbers are exactly +998 + 9 digits; other countries keep the generic 9-15 digit rule
    if (!phone || (phone.startsWith('+998') && phone.length !== 13)) {
      throw new BadRequestException('Invalid phone number');
    }
    return phone;
  }

  private hashCode(phone: string, code: string): string {
    const secret = this.config.get<string>('JWT_ACCESS_SECRET') || 'domera_default_access_secret';
    return createHmac('sha256', secret).update(`registration-otp:${phone}:${code}`).digest('hex');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
