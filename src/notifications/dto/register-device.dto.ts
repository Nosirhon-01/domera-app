import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DevicePlatform } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class RegisterDeviceDto {
  @ApiProperty({ description: 'FCM registration token from firebase_messaging getToken()' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  token: string;

  @ApiPropertyOptional({ enum: DevicePlatform, default: DevicePlatform.ANDROID })
  @IsOptional()
  @IsEnum(DevicePlatform)
  platform?: DevicePlatform = DevicePlatform.ANDROID;
}

export class UnregisterDeviceDto {
  @ApiProperty({ description: 'FCM registration token to remove (call on logout)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  token: string;
}
