import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizePhone } from '../../common/utils/phone';
import { AuthService } from '../auth.service';
import { OtpSendDto, OtpVerifyDto } from '../dto/otp.dto';
import { DEFAULT_USER_NAME, OtpChallengeService } from './otp-challenge.service';
import { REVIEW_ROLES, reviewRole } from '../review-account.service';

/**
 * Phone + code sign-in used by the mobile app ("Kirish" screen):
 *   POST /auth/otp/send   → 6-digit code (Eskiz SMS / devCode / fixed review code)
 *   POST /auth/otp/verify → existing number: logs in. New number: creates a USER account.
 *                           needsName=true → the app asks for first/last name and saves it with PATCH /auth/me.
 *
 * App Store / Google Play review: REVIEW_PHONE always accepts REVIEW_OTP_CODE (no SMS, no limits),
 * The review account gets REVIEW_ROLE (AGENT by default). Never works for an admin/manager number.
 */
@Injectable()
export class OtpLoginService {
  private readonly logger = new Logger(OtpLoginService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly authService: AuthService,
    private readonly challenges: OtpChallengeService,
  ) {}

  async send(dto: OtpSendDto) {
    const phone = this.challenges.requirePhone(dto.phone);
    const reviewCode = await this.reviewCodeFor(phone);
    const issued = await this.challenges.issue(phone, 'login', reviewCode ?? undefined);
    return this.challenges.toResponse(issued);
  }

  async verify(dto: OtpVerifyDto) {
    const phone = this.challenges.requirePhone(dto.phone);
    const now = new Date();
    await this.challenges.check(phone, 'login', dto.code, { verifiedAt: now, consumedAt: now });

    const isReview = this.isReviewPhone(phone);
    let user = await this.findByPhone(phone);
    let isNewUser = false;
    if (!user) {
      user = await this.createUser(phone, dto.name, isReview ? reviewRole(this.config) : Role.USER);
      isNewUser = true;
    } else if (isReview && REVIEW_ROLES.includes(user.role) && user.role !== reviewRole(this.config)) {
      user = await this.prisma.user.update({ where: { id: user.id }, data: { role: reviewRole(this.config) } });
    } else if (dto.name?.trim() && user.name === DEFAULT_USER_NAME) {
      // Name sent together with the code for an account that never got one
      user = await this.prisma.user.update({ where: { id: user.id }, data: { name: dto.name.trim() } });
    }
    if (!user.isActive) {
      throw new UnauthorizedException('User account is deactivated');
    }

    const session = await this.authService.issueSession(user);
    return {
      message: 'Login successful',
      isNewUser,
      needsName: !user.name?.trim() || user.name === DEFAULT_USER_NAME,
      ...session,
    };
  }

  private findByPhone(phone: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { phone: { in: this.challenges.phoneVariants(phone) } } });
  }

  private isReviewPhone(phone: string): boolean {
    return normalizePhone(this.config.get<string>('REVIEW_PHONE')) === phone;
  }

  private async createUser(phone: string, name: string | undefined, role: Role): Promise<User> {
    try {
      return await this.prisma.user.create({
        data: {
          name: name?.trim() || DEFAULT_USER_NAME,
          phone,
          // Signs in with codes; the random password is never shown (can be set later with PATCH /auth/me)
          password: await bcrypt.hash(randomBytes(24).toString('base64url'), 10),
          role,
          isActive: true,
        },
      });
    } catch (e) {
      // Two verifies for a new number at once: the other one created the account
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.findByPhone(phone);
        if (existing) return existing;
      }
      throw e;
    }
  }

  /** Fixed review code for REVIEW_PHONE, or null. Never for privileged accounts. */
  private async reviewCodeFor(phone: string): Promise<string | null> {
    const reviewPhone = normalizePhone(this.config.get<string>('REVIEW_PHONE'));
    const reviewCode = this.config.get<string>('REVIEW_OTP_CODE')?.trim();
    if (!reviewPhone || reviewPhone !== phone || !reviewCode || !/^\d{6}$/.test(reviewCode)) {
      return null;
    }
    const owner = await this.findByPhone(phone);
    if (owner && !REVIEW_ROLES.includes(owner.role)) {
      this.logger.error(`REVIEW_PHONE belongs to a ${owner.role} account — review code disabled, use another number`);
      return null;
    }
    return reviewCode;
  }
}
