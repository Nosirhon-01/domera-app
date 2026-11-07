import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors } from '../common/swagger/api-responses';
import { PropertyResponseDto } from './dto/property-response.dto';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertyFilterDto } from './dto/property-filter.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role, User } from '@prisma/client';

@ApiTags('Properties')
@Controller('properties')
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @Post()
  // Any signed-in, active user can post a listing (USER, AGENT, MANAGER, ADMIN)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a property listing (any signed-in user)',
    description: 'Free for every role (USER, AGENT, MANAGER, ADMIN): no payment, subscription or premium. ' +
      'ownerId is taken from the access token.',
  })
  @ApiEnvelope(201, 'Property created', PropertyResponseDto)
  @ApiErrors([400, 'Validation error'], [401, 'Not signed in or account deactivated'])
  create(@CurrentUser('id') userId: string, @Body() createPropertyDto: CreatePropertyDto) {
    return this.propertiesService.create(userId, createPropertyDto);
  }

  @Get()
  @ApiOperation({ summary: 'List commercial properties with filters & pagination (Public)' })
  @ApiEnvelope(200, 'Paginated list', PropertyResponseDto, { paginated: true })
  findAll(@Query() query: PropertyFilterDto, @CurrentUser() user?: User) {
    return this.propertiesService.findAll(query, user?.role);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get property details by ID (Public)' })
  @ApiEnvelope(200, 'Property', PropertyResponseDto)
  @ApiErrors([404, 'Property not found'])
  findOne(@Param('id') id: string) {
    return this.propertiesService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update property details (Owner, Manager, Admin)' })
  @ApiEnvelope(200, 'Property updated', PropertyResponseDto)
  @ApiErrors([400, 'Validation error'], [401, 'Unauthorized'], [403, 'Not the owner'], [404, 'Property not found'])
  update(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: Role,
    @Body() updatePropertyDto: UpdatePropertyDto,
  ) {
    return this.propertiesService.update(id, userId, userRole, updatePropertyDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete property listing (Owner, Manager, Admin)' })
  @ApiEnvelope(200, 'Property deleted', null)
  @ApiErrors([401, 'Unauthorized'], [403, 'Not the owner'], [404, 'Property not found'])
  remove(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: Role,
  ) {
    return this.propertiesService.remove(id, userId, userRole);
  }
}
