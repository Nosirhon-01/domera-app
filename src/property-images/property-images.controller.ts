import { Controller, Post, Delete, Get, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PropertyImagesService } from './property-images.service';
import { CreatePropertyImageDto } from './dto/create-property-image.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('Property Images')
@Controller('properties')
export class PropertyImagesController {
  constructor(private readonly propertyImagesService: PropertyImagesService) {}

  @Post(':propertyId/images')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add an image to a property listing' })
  @ApiResponse({ status: 201, description: 'Image added successfully' })
  addImage(
    @Param('propertyId') propertyId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: Role,
    @Body() dto: CreatePropertyImageDto,
  ) {
    return this.propertyImagesService.addImage(propertyId, userId, userRole, dto);
  }

  @Get(':propertyId/images')
  @ApiOperation({ summary: 'Get all images for a property listing' })
  getImages(@Param('propertyId') propertyId: string) {
    return this.propertyImagesService.findByPropertyId(propertyId);
  }

  @Delete(':propertyId/images/:imageId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete an image of a property listing' })
  @ApiResponse({ status: 200, description: 'Image deleted successfully' })
  @ApiResponse({ status: 404, description: 'Image not found on this property' })
  removePropertyImage(
    @Param('propertyId') propertyId: string,
    @Param('imageId') imageId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: Role,
  ) {
    return this.propertyImagesService.removeImage(imageId, userId, userRole, propertyId);
  }

  @Delete('images/:imageId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a property image' })
  removeImage(
    @Param('imageId') imageId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: Role,
  ) {
    return this.propertyImagesService.removeImage(imageId, userId, userRole);
  }
}
