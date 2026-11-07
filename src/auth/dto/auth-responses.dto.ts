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

export class OtpVerifyResponseDto extends AuthSessionResponseDto {
  @ApiProperty({ example: true, description: 'true if this phone had no account and a USER account was just created' })
  isNewUser: boolean;
}

export class OtpSendResponseDto {
  @ApiProperty({ example: 'Code sent' }) message: string;
  @ApiProperty({ example: '+998901234567', description: 'Normalized phone the code was sent to' }) phone: string;
  @ApiProperty({ example: 120, description: 'Seconds the code stays valid' }) expiresIn: number;
  @ApiProperty({ example: 60, description: 'Seconds before another code can be requested' }) retryAfter: number;
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
