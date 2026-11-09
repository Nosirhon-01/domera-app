import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** At least 8 characters, one letter and one digit. 72 = bcrypt input limit. */
export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d)\S{8,72}$/;
export const PASSWORD_RULE_MESSAGE =
  'password must be 8-72 characters without spaces and contain at least one letter and one digit';

export class RegisterRequestCodeDto {
  @ApiProperty({ example: '+998901234567', description: 'Phone number (spaces/dashes allowed, 901234567 = +998901234567)' })
  @IsString()
  @MaxLength(32)
  phone: string;
}

export class RegisterVerifyCodeDto {
  @ApiProperty({ example: '+998901234567' })
  @IsString()
  @MaxLength(32)
  phone: string;

  @ApiProperty({ example: '123456', description: '6-digit code from /auth/register/request-code' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;
}

export class RegisterCompleteDto {
  @ApiProperty({ description: 'verificationToken from /auth/register/verify-code (one-time, 10 minutes)' })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  verificationToken: string;

  @ApiProperty({ example: 'Secret123', description: PASSWORD_RULE_MESSAGE })
  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_RULE_MESSAGE })
  password: string;

  @ApiProperty({ example: 'Secret123', description: 'Must equal password' })
  @IsString()
  @MaxLength(72)
  passwordConfirmation: string;

  @ApiPropertyOptional({ example: 'Ali Valiyev', description: 'Display name. Default: "Foydalanuvchi"' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;
}
