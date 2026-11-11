import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhone } from '../common/utils/phone';

/**
 * Keeps the App Store / Google Play review account in sync with .env on every start:
 *   REVIEW_EMAIL + REVIEW_PASSWORD  → login with POST /auth/login
 *   REVIEW_PHONE + REVIEW_PASSWORD   → login with POST /auth/login (phone + password)
 *   REVIEW_PHONE + REVIEW_OTP_CODE   → app sign-in (/auth/otp/send + verify) with a fixed code, no SMS is sent
 * Role: REVIEW_ROLE (AGENT by default, or USER). Never ADMIN/MANAGER: such an account is not touched.
 * Runs when REVIEW_PASSWORD is set, or when REVIEW_PHONE + REVIEW_OTP_CODE are set.
 */
export const REVIEW_ROLES: Role[] = [Role.USER, Role.AGENT];

export function reviewRole(config: ConfigService): Role {
  const value = config.get<string>('REVIEW_ROLE')?.trim().toUpperCase();
  return value === Role.USER ? Role.USER : Role.AGENT;
}

@Injectable()
export class ReviewAccountService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReviewAccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    try {
      await this.sync();
    } catch (e) {
      // Never block startup because of the review account
      this.logger.error(`Review account sync failed: ${(e as Error).message}`);
    }
  }

  async sync() {
    const password = this.config.get<string>('REVIEW_PASSWORD') || null;
    const email = this.config.get<string>('REVIEW_EMAIL')?.toLowerCase().trim() || null;
    const phone = normalizePhone(this.config.get<string>('REVIEW_PHONE'));
    const otpCode = this.config.get<string>('REVIEW_OTP_CODE')?.trim();
    if (!email && !phone) return;
    if (!password && !(phone && otpCode)) return;
    const role = reviewRole(this.config);

    if (password && password.length < 8) {
      this.logger.warn('REVIEW_PASSWORD is shorter than 8 characters');
    }

    const matches = await this.prisma.user.findMany({
      where: { OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] },
    });
    if (matches.length > 1) {
      this.logger.error('REVIEW_EMAIL and REVIEW_PHONE belong to two different users — review account not updated');
      return;
    }
    const existing = matches[0];
    if (existing && !REVIEW_ROLES.includes(existing.role)) {
      this.logger.error(`Review account ${email ?? phone} is a ${existing.role} — not touched, use another number`);
      return;
    }

    if (existing) {
      const data: { password?: string; isActive?: boolean; role?: Role } = {};
      if (password && !(await bcrypt.compare(password, existing.password))) data.password = await bcrypt.hash(password, 10);
      if (!existing.isActive) data.isActive = true;
      if (existing.role !== role) data.role = role;
      if (Object.keys(data).length) await this.prisma.user.update({ where: { id: existing.id }, data });
      this.logger.log(`Review account ready: ${email ?? phone} (${role})`);
      return;
    }

    await this.prisma.user.create({
      data: {
        name: this.config.get<string>('REVIEW_NAME') || 'App Review',
        email,
        phone,
        // Without REVIEW_PASSWORD the reviewer signs in with the fixed code only
        password: await bcrypt.hash(password ?? randomBytes(24).toString('base64url'), 10),
        role,
        isActive: true,
      },
    });
    this.logger.log(`Review account created: ${email ?? phone} (${role})`);
  }
}
