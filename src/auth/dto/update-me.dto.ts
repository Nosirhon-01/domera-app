import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateMeDto {
  @ApiPropertyOptional({ example: 'John Doe', description: 'Full name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: '+998901234567', description: 'Phone number' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'user@example.com', description: 'Email address' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'NewPassword123', description: 'New password (min 6 characters)' })
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @ApiPropertyOptional({ example: 'https://...', description: 'Avatar URL' })
  @IsOptional()
  @IsString()
  avatar?: string;

  @ApiPropertyOptional({ example: 'Real estate professional', description: 'Short bio' })
  @IsOptional()
  @IsString()
  bio?: string;
}
