import { ApiProperty } from '@nestjs/swagger';
import { PropertyPurpose, PropertyStatus, PropertyType } from '@prisma/client';
import { PropertyOwnerDto } from '../../auth/dto/auth-responses.dto';

export class PropertyImageResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() propertyId: string;
  @ApiProperty({ example: '/uploads/3f2a.jpg', description: 'Relative to the server origin' }) url: string;
  @ApiProperty({ example: 0 }) sortOrder: number;
  @ApiProperty({ example: true }) isPrimary: boolean;
  @ApiProperty() createdAt: string;
}

export class PropertyResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'Modern Commercial Office Space' }) title: string;
  @ApiProperty() description: string;
  @ApiProperty({ enum: PropertyType }) propertyType: PropertyType;
  @ApiProperty({ enum: PropertyPurpose }) purpose: PropertyPurpose;
  @ApiProperty({ example: 2500 }) price: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({ example: 200 }) area: number;
  @ApiProperty() address: string;
  @ApiProperty({ nullable: true, type: Number, example: 41.311081 }) latitude: number | null;
  @ApiProperty({ nullable: true, type: Number, example: 69.240562 }) longitude: number | null;
  @ApiProperty({ enum: PropertyStatus }) status: PropertyStatus;
  @ApiProperty({ description: 'Always the signed-in user who created it' }) ownerId: string;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
  @ApiProperty({ type: [PropertyImageResponseDto] }) images: PropertyImageResponseDto[];
  @ApiProperty({ type: PropertyOwnerDto }) owner: PropertyOwnerDto;
}
