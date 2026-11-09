import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class UserResponseDto {
  @ApiProperty({ example: '7f3c2a9e-1b2d-4c5e-8f90-123456789abc' }) id: string;
  @ApiProperty({ example: 'Ali Valiyev' }) name: string;
  @ApiProperty({ example: '+998901234567', nullable: true, type: String }) phone: string | null;
  @ApiProperty({ example: 'ali@example.com', nullable: true, type: String }) email: string | null;
  @ApiProperty({ enum: Role, example: Role.USER }) role: Role;
  @ApiProperty({ example: null, nullable: true, type: String }) avatar: string | null;
  @ApiProperty({ example: null, nullable: true, type: String }) bio: string | null;
  @ApiProperty({ example: true }) isActive: boolean;
  @ApiProperty({ example: '2026-11-07T12:00:00.000Z' }) createdAt: string;
  @ApiProperty({ example: '2026-11-07T12:00:00.000Z' }) updatedAt: string;
}

export class AuthSessionResponseDto {
  @ApiProperty({ example: 'Login successful' }) message: string;
  @ApiProperty({ type: UserResponseDto }) user: UserResponseDto;
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIs...', description: 'JWT, send as Authorization: Bearer <token>' })
  accessToken: string;
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIs...', description: 'Use with POST /auth/refresh' })
  refreshToken: string;
}

export class RegisterCodeResponseDto {
  @ApiProperty({ example: 'Verification code created' }) message: string;
  @ApiProperty({ example: '+998901234567', description: 'Normalized phone number' }) phone: string;
  @ApiProperty({ example: 180, description: 'Seconds the code stays valid' }) expiresIn: number;
  @ApiProperty({ example: 60, description: 'Seconds before another code can be requested' }) retryAfter: number;
  @ApiPropertyOptional({
    example: '482915',
    description: 'The code itself. Present ONLY when OTP_DEV_MODE=true and NODE_ENV is not production',
  })
  devCode?: string;
}

export class RegisterVerifyResponseDto {
  @ApiProperty({ example: 'Phone number verified' }) message: string;
  @ApiProperty({ example: '+998901234567' }) phone: string;
  @ApiProperty({ example: 'q2Jx...43 chars', description: 'One-time token for POST /auth/register/complete' })
  verificationToken: string;
  @ApiProperty({ example: 600, description: 'Seconds the verification token stays valid' }) expiresIn: number;
}

export class ProfileUpdateResponseDto {
  @ApiProperty({ example: 'Profile updated successfully' }) message: string;
  @ApiProperty({ type: UserResponseDto }) user: UserResponseDto;
}

export class PropertyOwnerDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'Ali Valiyev' }) name: string;
  @ApiProperty({ nullable: true, type: String }) email: string | null;
  @ApiProperty({ nullable: true, type: String, example: '+998901234567' }) phone: string | null;
  @ApiPropertyOptional({ enum: Role }) role?: Role;
}
