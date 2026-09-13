import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, IsUrl, Min } from 'class-validator';

export class CreatePropertyImageDto {
  @ApiProperty({ example: '/uploads/property-123.jpg', description: 'URL or path of the property image' })
  @IsString()
  url: string;

  @ApiPropertyOptional({ example: 0, default: 0, description: 'Sorting order position' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number = 0;

  @ApiPropertyOptional({ example: false, default: false, description: 'Set as primary display image' })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean = false;
}
