import { Injectable, UnauthorizedException, BadRequestException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async register(registerDto: RegisterDto) {
    if (!registerDto.email && !registerDto.phone) {
      throw new BadRequestException('Provide at least email or phone number to register');
    }

    const user = await this.usersService.create({
      name: registerDto.name,
      email: registerDto.email,
      phone: registerDto.phone,
      password: registerDto.password,
    });

    const tokens = await this.generateTokens(user.id, user.role, user.email, user.phone);
    await this.saveRefreshToken(user.id, tokens.refreshToken);

    return {
      message: 'Registration successful',
      user,
      ...tokens,
    };
  }

  async login(loginDto: LoginDto) {
    const identifier = loginDto.email || loginDto.phone;
    if (!identifier) {
      throw new BadRequestException('Please provide an email or phone number to log in');
    }

    const user = await this.usersService.findByEmailOrPhone(identifier);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('User account is deactivated');
    }

    const { password: _, ...safeUser } = user;
    const tokens = await this.generateTokens(user.id, user.role, user.email, user.phone);
    await this.saveRefreshToken(user.id, tokens.refreshToken);

    return {
      message: 'Login successful',
      user: safeUser,
      ...tokens,
    };
  }

  async refreshTokens(refreshTokenDto: RefreshTokenDto) {
    const { refreshToken } = refreshTokenDto;
    let payload: any;

    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET') || 'domera_default_refresh_secret',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (!payload?.tokenId || !payload?.sub) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const storedToken = await this.prisma.refreshToken.findFirst({
      where: {
        id: payload.tokenId,
        userId: payload.sub,
        isRevoked: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Refresh token is invalid or revoked');
    }

    const isTokenMatching = await bcrypt.compare(refreshToken, storedToken.tokenHash);
    if (!isTokenMatching) {
      throw new UnauthorizedException('Refresh token does not match');
    }

    // Revoke old token (Token Rotation). Conditional update makes this atomic:
    // if two requests use the same refresh token concurrently, only one wins.
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: storedToken.id, isRevoked: false },
      data: { isRevoked: true },
    });
    if (revoked.count === 0) {
      throw new UnauthorizedException('Refresh token is invalid or revoked');
    }

    const fullUser = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!fullUser || !fullUser.isActive) {
      throw new UnauthorizedException('User is inactive or no longer exists');
    }
    const { password: _, ...user } = fullUser;
    const newTokens = await this.generateTokens(user.id, user.role, user.email, user.phone);
    await this.saveRefreshToken(user.id, newTokens.refreshToken);

    return {
      message: 'Tokens refreshed successfully',
      user,
      ...newTokens,
    };
  }

  async logout(userId: string, refreshToken?: string) {
    let tokenId: string | undefined;
    if (refreshToken) {
      try {
        const payload: any = this.jwtService.decode(refreshToken);
        tokenId = payload?.tokenId;
      } catch {
        tokenId = undefined;
      }
    }

    if (tokenId) {
      // Revoke only this device's session (scoped to the user — cannot revoke someone else's token)
      await this.prisma.refreshToken.updateMany({
        where: { id: tokenId, userId },
        data: { isRevoked: true },
      });
    } else {
      // No (parsable) refresh token: revoke all active sessions of this user
      await this.prisma.refreshToken.updateMany({
        where: { userId, isRevoked: false },
        data: { isRevoked: true },
      });
    }

    return { message: 'Logged out successfully' };
  }

  async getMe(userId: string) {
    return this.usersService.findById(userId);
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const { password, ...rest } = dto;
    const data: any = { ...rest };

    if (rest.email !== undefined) {
      data.email = rest.email.toLowerCase().trim();
      const taken = await this.prisma.user.findFirst({ where: { email: data.email, NOT: { id: userId } } });
      if (taken) {
        throw new ConflictException('User with this email already exists');
      }
    }
    if (rest.phone !== undefined) {
      data.phone = rest.phone.trim();
      const taken = await this.prisma.user.findFirst({ where: { phone: data.phone, NOT: { id: userId } } });
      if (taken) {
        throw new ConflictException('User with this phone number already exists');
      }
    }

    if (password) {
      data.password = await bcrypt.hash(password, 10);
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data,
    });

    const { password: _, ...result } = updatedUser;
    return { message: 'Profile updated successfully', user: result };
  }

  async deleteMe(userId: string) {
    // Revoke all refresh tokens first
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
    // Delete user account
    await this.prisma.user.delete({ where: { id: userId } });
    return { message: 'Account successfully deleted' };
  }

  private async generateTokens(userId: string, role: string, email?: string, phone?: string) {
    const tokenId = await this.createRefreshTokenRecord(userId);

    const accessPayload = { sub: userId, role, email, phone };
    const refreshPayload = { sub: userId, tokenId };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET') || 'domera_default_access_secret',
        expiresIn: (this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') || '15m') as any,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET') || 'domera_default_refresh_secret',
        expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d') as any,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async createRefreshTokenRecord(userId: string): Promise<string> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const record = await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: 'pending_hash',
        expiresAt,
      },
    });

    return record.id;
  }

  private async saveRefreshToken(userId: string, refreshToken: string) {
    const payload: any = this.jwtService.decode(refreshToken);
    if (payload?.tokenId) {
      const tokenHash = await bcrypt.hash(refreshToken, 10);
      await this.prisma.refreshToken.update({
        where: { id: payload.tokenId },
        // Keep DB expiry in sync with JWT_REFRESH_EXPIRES_IN (record is created with a 7-day placeholder)
        data: { tokenHash, ...(payload.exp ? { expiresAt: new Date(payload.exp * 1000) } : {}) },
      });
    }
  }
}
