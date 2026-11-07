import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, User } from '@prisma/client';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../../users/users.service';
import { AuthService } from '../auth.service';
import { SendOtpDto, VerifyOtpDto } from '../dto/otp.dto';
import { normalizePhone } from '../../common/utils/phone';
import { SmsService } from './sms.service';

const CODE_TTL_SECONDS = 120;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_SENDS_PER_HOUR = 5;
const MAX_VERIFY_ATTEMPTS = 5;

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
    private readonly sms: SmsService,
  ) {}

  async send(dto: SendOtpDto) {
    const phone = this.requirePhone(dto.phone);
    const reviewCode = this.reviewCodeFor(phone);

    if (!reviewCode) {
      const now = Date.now();
      const last = await this.prisma.otpCode.findFirst({ where: { phone }, orderBy: { createdAt: 'desc' } });
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
      const sentLastHour = await this.prisma.otpCode.count({
        where: { phone, createdAt: { gt: new Date(now - 3600_000) } },
      });
      if (sentLastHour >= MAX_SENDS_PER_HOUR) {
        throw new HttpException('Too many codes requested for this number, try again later', HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    const code = reviewCode ?? randomInt(0, 1_000_000).toString().padStart(6, '0');

    // Invalidate older codes so only the newest one works
    await this.prisma.otpCode.updateMany({
      where: { phone, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    const record = await this.prisma.otpCode.create({
      data: {
        phone,
        codeHash: this.hash(phone, code),
        expiresAt: new Date(Date.now() + CODE_TTL_SECONDS * 1000),
      },
    });

    if (!reviewCode) {
      const template = this.config.get<string>('OTP_MESSAGE_TEMPLATE') || 'DOMERA: tasdiqlash kodingiz {code}';
      try {
        await this.sms.send(phone, template.replace('{code}', code));
      } catch (e) {
        // Do not let an unsent code count against the user's cooldown
        await this.prisma.otpCode.delete({ where: { id: record.id } }).catch(() => undefined);
        throw e;
      }
    }

    return {
      message: 'Code sent',
      phone,
      expiresIn: CODE_TTL_SECONDS,
      retryAfter: RESEND_COOLDOWN_SECONDS,
    };
  }

  async verify(dto: VerifyOtpDto) {
    const phone = this.requirePhone(dto.phone);

    const otp = await this.prisma.otpCode.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) {
      throw new BadRequestException('Code expired or not requested. Request a new code');
    }

    // Count the attempt atomically before checking, so parallel guesses cannot exceed the limit
    const counted = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, consumedAt: null, attempts: { lt: MAX_VERIFY_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0) {
      throw new BadRequestException('Too many wrong attempts. Request a new code');
    }

    if (!this.matches(otp.codeHash, this.hash(phone, dto.code))) {
      const left = Math.max(0, MAX_VERIFY_ATTEMPTS - otp.attempts - 1);
      throw new BadRequestException(`Invalid code. Attempts left: ${left}`);
    }

    const consumed = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) {
      throw new BadRequestException('Code already used. Request a new code');
    }

    let user: User | null = await this.prisma.user.findFirst({
      where: { phone: { in: [phone, phone.slice(1)] } },
    });
    let isNewUser = false;
    if (!user) {
      // New phone: create a regular USER account. The random password is never shown;
      // the user can set one later with PATCH /auth/me.
      const created = await this.usersService.create({
        name: dto.name?.trim() || 'Foydalanuvchi',
        phone,
        password: randomBytes(24).toString('base64url'),
        role: Role.USER,
      });
      user = await this.prisma.user.findUnique({ where: { id: created.id } });
      isNewUser = true;
    }
    if (!user!.isActive) {
      throw new UnauthorizedException('User account is deactivated');
    }

    const session = await this.authService.issueSession(user!);
    return { message: 'Login successful', isNewUser, ...session };
  }

  private requirePhone(raw: string): string {
    const phone = normalizePhone(raw);
    if (!phone) {
      throw new BadRequestException('Invalid phone number');
    }
    return phone;
  }

  /** App Store / Play review: a fixed code for one configured number, no SMS sent. */
  private reviewCodeFor(phone: string): string | null {
    const reviewPhone = normalizePhone(this.config.get<string>('REVIEW_PHONE'));
    const reviewCode = this.config.get<string>('REVIEW_OTP_CODE');
    if (reviewPhone && reviewCode && /^\d{6}$/.test(reviewCode) && reviewPhone === phone) {
      return reviewCode;
    }
    return null;
  }

  private hash(phone: string, code: string): string {
    const secret = this.config.get<string>('JWT_ACCESS_SECRET') || 'domera_default_access_secret';
    return createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex');
  }

  private matches(a: string, b: string): boolean {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
