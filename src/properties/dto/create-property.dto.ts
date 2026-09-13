import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PropertyPurpose, PropertyStatus, PropertyType } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreatePropertyDto {
  @ApiProperty({ example: 'Modern Commercial Office Space', description: 'Title of property' })
  @IsString()
  title: string;

  @ApiProperty({ example: 'Spacious 200 sqm office located in central business district', description: 'Detailed description' })
  @IsString()
  description: string;

  @ApiProperty({ enum: PropertyType, example: PropertyType.OFFICE, description: 'Type of property' })
  @IsEnum(PropertyType)
  propertyType: PropertyType;

  @ApiProperty({ enum: PropertyPurpose, example: PropertyPurpose.RENT, description: 'Listing purpose' })
  @IsEnum(PropertyPurpose)
  purpose: PropertyPurpose;

  @ApiProperty({ example: 2500, description: 'Price in currency' })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: 'USD', default: 'USD', description: 'Currency code' })
  @IsOptional()
  @IsString()
  currency?: string = 'USD';

  @ApiProperty({ example: 200, description: 'Total area in square meters' })
  @IsNumber()
  @Min(0)
  area: number;

  @ApiProperty({ example: '10 Amir Temur Avenue, Tashkent', description: 'Physical address' })
  @IsString()
  address: string;

  @ApiPropertyOptional({ example: 41.311081, description: 'Latitude coordinates' })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({ example: 69.240562, description: 'Longitude coordinates' })
  @IsOptional()
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({ enum: PropertyStatus, default: PropertyStatus.AVAILABLE, description: 'Property status' })
  @IsOptional()
  @IsEnum(PropertyStatus)
  status?: PropertyStatus = PropertyStatus.AVAILABLE;
}
