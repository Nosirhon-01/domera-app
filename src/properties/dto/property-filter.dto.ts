import { ApiPropertyOptional } from '@nestjs/swagger';
import { PropertyPurpose, PropertyStatus, PropertyType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class PropertyFilterDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PropertyType, description: 'Filter by property type' })
  @IsOptional()
  @IsEnum(PropertyType)
  propertyType?: PropertyType;

  @ApiPropertyOptional({ enum: PropertyPurpose, description: 'Filter by purpose (SALE, RENT, SALE_AND_RENT)' })
  @IsOptional()
  @IsEnum(PropertyPurpose)
  purpose?: PropertyPurpose;

  @ApiPropertyOptional({ enum: PropertyStatus, description: 'Filter by status' })
  @IsOptional()
  @IsEnum(PropertyStatus)
  status?: PropertyStatus;

  @ApiPropertyOptional({ description: 'Filter by minimum price' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ description: 'Filter by maximum price' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ description: 'Filter by minimum area' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minArea?: number;

  @ApiPropertyOptional({ description: 'Filter by maximum area' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxArea?: number;

  @ApiPropertyOptional({ description: 'Map bounds: minimum latitude (south)', example: 41.2 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  minLat?: number;

  @ApiPropertyOptional({ description: 'Map bounds: maximum latitude (north)', example: 41.4 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  maxLat?: number;

  @ApiPropertyOptional({ description: 'Map bounds: minimum longitude (west)', example: 69.1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  minLng?: number;

  @ApiPropertyOptional({ description: 'Map bounds: maximum longitude (east)', example: 69.4 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  maxLng?: number;

  @ApiPropertyOptional({ description: 'Only return properties that have map coordinates' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  hasLocation?: boolean;

  @ApiPropertyOptional({ description: 'Search term in title, description, or address' })
  @IsOptional()
  @IsString()
  search?: string;
}
