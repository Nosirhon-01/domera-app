import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertyFilterDto } from './dto/property-filter.dto';
import { Prisma, Role, PropertyStatus } from '@prisma/client';

@Injectable()
export class PropertiesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerId: string, createPropertyDto: CreatePropertyDto) {
    return this.prisma.property.create({
      data: {
        ...createPropertyDto,
        ownerId,
      },
      include: {
        images: true,
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: true,
          },
        },
      },
    });
  }

  async findAll(filter: PropertyFilterDto, userRole?: Role) {
    const {
      page = 1,
      limit = 20,
      propertyType,
      purpose,
      status,
      minPrice,
      maxPrice,
      minArea,
      maxArea,
      search,
      minLat,
      maxLat,
      minLng,
      maxLng,
      hasLocation,
    } = filter;

    const where: Prisma.PropertyWhereInput = {};

    // Public users can only view AVAILABLE properties by default unless status is specified or user is admin/manager
    if (status) {
      where.status = status;
    } else if (!userRole || (userRole !== Role.ADMIN && userRole !== Role.MANAGER)) {
      where.status = PropertyStatus.AVAILABLE;
    }

    if (propertyType) {
      where.propertyType = propertyType;
    }

    if (purpose) {
      where.purpose = purpose;
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};
      if (minPrice !== undefined) where.price.gte = minPrice;
      if (maxPrice !== undefined) where.price.lte = maxPrice;
    }

    if (minArea !== undefined || maxArea !== undefined) {
      where.area = {};
      if (minArea !== undefined) where.area.gte = minArea;
      if (maxArea !== undefined) where.area.lte = maxArea;
    }

    // Map viewport filter (bounding box)
    const hasLatBounds = minLat !== undefined || maxLat !== undefined;
    const hasLngBounds = minLng !== undefined || maxLng !== undefined;

    if (hasLocation || hasLatBounds || hasLngBounds) {
      const latitude: Prisma.FloatNullableFilter = { not: null };
      const longitude: Prisma.FloatNullableFilter = { not: null };
      if (minLat !== undefined) latitude.gte = minLat;
      if (maxLat !== undefined) latitude.lte = maxLat;
      if (minLng !== undefined) longitude.gte = minLng;
      if (maxLng !== undefined) longitude.lte = maxLng;
      where.latitude = latitude;
      where.longitude = longitude;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { address: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (page - 1) * limit;

    const [total, properties] = await Promise.all([
      this.prisma.property.count({ where }),
      this.prisma.property.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          images: {
            orderBy: { sortOrder: 'asc' },
          },
          owner: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              role: true,
            },
          },
        },
      }),
    ]);

    return {
      items: properties,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const property = await this.prisma.property.findUnique({
      where: { id },
      include: {
        images: {
          orderBy: { sortOrder: 'asc' },
        },
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: true,
          },
        },
      },
    });

    if (!property) {
      throw new NotFoundException(`Property with ID '${id}' not found`);
    }

    return property;
  }

  async update(id: string, userId: string, userRole: Role, updatePropertyDto: UpdatePropertyDto) {
    const property = await this.findOne(id);

    if (property.ownerId !== userId && userRole !== Role.ADMIN && userRole !== Role.MANAGER) {
      throw new ForbiddenException('You do not have permission to modify this property');
    }

    return this.prisma.property.update({
      where: { id },
      data: updatePropertyDto,
      include: {
        images: true,
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
    });
  }

  async remove(id: string, userId: string, userRole: Role) {
    const property = await this.findOne(id);

    if (property.ownerId !== userId && userRole !== Role.ADMIN && userRole !== Role.MANAGER) {
      throw new ForbiddenException('You do not have permission to delete this property');
    }

    await this.prisma.property.delete({ where: { id } });
    return { message: 'Property deleted successfully' };
  }
}
