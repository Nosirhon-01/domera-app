import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SendOtpDto {
  @ApiProperty({ example: '+998901234567', description: 'Phone number (spaces/dashes allowed)' })
  @IsString()
  @MaxLength(32)
  phone: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: '+998901234567' })
  @IsString()
  @MaxLength(32)
  phone: string;

  @ApiProperty({ example: '123456', description: '6-digit code from the SMS' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;

  @ApiPropertyOptional({ example: 'Ali Valiyev', description: 'Name for a new account (ignored if the user exists)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;
}
