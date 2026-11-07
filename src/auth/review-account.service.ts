import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhone } from '../common/utils/phone';

/**
 * Keeps the App Store / Google Play review account in sync with .env on every start:
 *   REVIEW_EMAIL + REVIEW_PASSWORD  → login with POST /auth/login
 *   REVIEW_PHONE (+ REVIEW_OTP_CODE) → login with OTP, fixed code, no SMS is sent
 * The account is a regular USER. Nothing happens if REVIEW_PASSWORD is unset.
 */
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
    const password = this.config.get<string>('REVIEW_PASSWORD');
    const email = this.config.get<string>('REVIEW_EMAIL')?.toLowerCase().trim() || null;
    const phone = normalizePhone(this.config.get<string>('REVIEW_PHONE'));
    if (!password || (!email && !phone)) return;

    if (password.length < 8) {
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
    if (existing && existing.role !== Role.USER) {
      this.logger.error(`Review account ${email ?? phone} is a ${existing.role}, not a USER — not touched`);
      return;
    }

    const hashed = await bcrypt.hash(password, 10);
    if (existing) {
      if (!(await bcrypt.compare(password, existing.password)) || !existing.isActive) {
        await this.prisma.user.update({
          where: { id: existing.id },
          data: { password: hashed, isActive: true },
        });
      }
      this.logger.log(`Review account ready: ${email ?? phone}`);
      return;
    }

    await this.prisma.user.create({
      data: {
        name: this.config.get<string>('REVIEW_NAME') || 'App Review',
        email,
        phone,
        password: hashed,
        role: Role.USER,
        isActive: true,
      },
    });
    this.logger.log(`Review account created: ${email ?? phone}`);
  }
}
