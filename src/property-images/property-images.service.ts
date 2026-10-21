import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePropertyImageDto } from './dto/create-property-image.dto';
import { Role } from '@prisma/client';

@Injectable()
export class PropertyImagesService {
  constructor(private readonly prisma: PrismaService) {}

  async addImage(propertyId: string, userId: string, userRole: Role, dto: CreatePropertyImageDto) {
    const property = await this.prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) {
      throw new NotFoundException(`Property '${propertyId}' not found`);
    }

    if (property.ownerId !== userId && userRole !== Role.ADMIN && userRole !== Role.MANAGER) {
      throw new ForbiddenException('You do not have permission to manage images for this property');
    }

    // If marked primary, unmark other images
    if (dto.isPrimary) {
      await this.prisma.propertyImage.updateMany({
        where: { propertyId },
        data: { isPrimary: false },
      });
    }

    return this.prisma.propertyImage.create({
      data: {
        propertyId,
        url: dto.url,
        sortOrder: dto.sortOrder ?? 0,
        isPrimary: dto.isPrimary ?? false,
      },
    });
  }

  async removeImage(imageId: string, userId: string, userRole: Role, propertyId?: string) {
    const image = await this.prisma.propertyImage.findUnique({
      where: { id: imageId },
      include: { property: true },
    });

    if (!image || (propertyId && image.propertyId !== propertyId)) {
      throw new NotFoundException(`Property image '${imageId}' not found`);
    }

    if (image.property.ownerId !== userId && userRole !== Role.ADMIN && userRole !== Role.MANAGER) {
      throw new ForbiddenException('You do not have permission to delete this image');
    }

    await this.prisma.propertyImage.delete({ where: { id: imageId } });
    return { message: 'Image deleted successfully' };
  }

  async findByPropertyId(propertyId: string) {
    return this.prisma.propertyImage.findMany({
      where: { propertyId },
      orderBy: { sortOrder: 'asc' },
    });
  }
}
