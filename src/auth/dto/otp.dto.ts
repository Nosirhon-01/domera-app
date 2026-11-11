import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class OtpSendDto {
  @ApiProperty({ example: '+998901234567', description: 'Phone number (spaces/dashes allowed, 901234567 = +998901234567)' })
  @IsString()
  @MaxLength(32)
  phone: string;
}

export class OtpVerifyDto {
  @ApiProperty({ example: '+998901234567' })
  @IsString()
  @MaxLength(32)
  phone: string;

  @ApiProperty({ example: '123456', description: '6-digit code from the SMS' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;

  @ApiPropertyOptional({
    example: 'Ali Valiyev',
    description: 'First and last name for a new account. Usually omitted: the app asks after verify (needsName)',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;
}
