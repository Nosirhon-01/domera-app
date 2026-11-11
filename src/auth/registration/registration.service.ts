import { BadRequestException, ConflictException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth.service';
import { RegisterCompleteDto, RegisterRequestCodeDto, RegisterVerifyCodeDto } from '../dto/registration.dto';
import { SmsService } from '../sms/sms.service';
import { DEFAULT_USER_NAME, OtpChallengeService } from '../otp/otp-challenge.service';
import { generateVerificationToken, hashToken } from './otp-crypto';

export const TOKEN_TTL_SECONDS = 600;

/**
 * Phone registration with a password:
 *   1. request-code  → 6-digit code (SMS when SMS_MODE=live; devCode only with OTP_DEV_MODE outside production)
 *   2. verify-code   → one-time verificationToken
 *   3. complete      → user is created with a bcrypt password, JWT pair returned
 * Code limits and delivery: OtpChallengeService. Only hashes are stored; nothing secret is logged.
 */
@Injectable()
export class RegistrationService implements OnModuleInit {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly challenges: OtpChallengeService,
    private readonly sms: SmsService,
  ) {}

  onModuleInit() {
    if (this.challenges.devMode) {
      this.logger.warn('OTP_DEV_MODE=true: OTP codes are returned in API responses (development/test only)');
    }
    if (!this.challenges.devMode && this.sms.mode !== 'live') {
      this.logger.warn(
        `SMS_MODE=${this.sms.mode} and OTP_DEV_MODE off: phone codes cannot be delivered (only the review number works)`,
      );
    }
  }

  get devMode(): boolean {
    return this.challenges.devMode;
  }

  async requestCode(dto: RegisterRequestCodeDto) {
    const phone = this.challenges.requirePhone(dto.phone);
    await this.ensurePhoneFree(phone);
    const issued = await this.challenges.issue(phone, 'register');
    return this.challenges.toResponse(issued);
  }

  async verifyCode(dto: RegisterVerifyCodeDto) {
    const phone = this.challenges.requirePhone(dto.phone);
    const verificationToken = generateVerificationToken();
    await this.challenges.check(phone, 'register', dto.code, {
      verifiedAt: new Date(),
      tokenHash: hashToken(verificationToken),
      tokenExpiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000),
    });
    return { message: 'Phone number verified', phone, verificationToken, expiresIn: TOKEN_TTL_SECONDS };
  }

  async complete(dto: RegisterCompleteDto) {
    if (dto.password !== dto.passwordConfirmation) {
      throw new BadRequestException('Passwords do not match');
    }

    const invalidToken = () => new BadRequestException('Verification token is invalid, expired or already used');
    const challenge = await this.prisma.registrationChallenge.findUnique({
      where: { tokenHash: hashToken(dto.verificationToken) },
    });
    if (
      !challenge ||
      challenge.purpose !== 'register' ||
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

        const taken = await tx.user.findFirst({
          where: { phone: { in: this.challenges.phoneVariants(challenge.phone) } },
        });
        if (taken) throw new ConflictException('This phone number is already registered');

        return tx.user.create({
          data: {
            name: dto.name?.trim() || DEFAULT_USER_NAME,
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
    const existing = await this.prisma.user.findFirst({
      where: { phone: { in: this.challenges.phoneVariants(phone) } },
    });
    if (existing) {
      throw new ConflictException('This phone number is already registered. Please log in');
    }
  }
}
