import { Controller, Post, Delete, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { FavoritesService } from './favorites.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Favorites')
@Controller('favorites')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Post(':propertyId')
  @ApiOperation({ summary: 'Add property to favorites' })
  @ApiResponse({ status: 201, description: 'Property favorited successfully' })
  addFavorite(@CurrentUser('id') userId: string, @Param('propertyId') propertyId: string) {
    return this.favoritesService.addFavorite(userId, propertyId);
  }

  @Delete(':propertyId')
  @ApiOperation({ summary: 'Remove property from favorites' })
  @ApiResponse({ status: 200, description: 'Property removed from favorites' })
  removeFavorite(@CurrentUser('id') userId: string, @Param('propertyId') propertyId: string) {
    return this.favoritesService.removeFavorite(userId, propertyId);
  }

  @Get()
  @ApiOperation({ summary: 'Get current user saved favorite properties' })
  @ApiResponse({ status: 200, description: 'User favorite properties list' })
  getUserFavorites(@CurrentUser('id') userId: string, @Query() query: PaginationQueryDto) {
    return this.favoritesService.getUserFavorites(userId, query);
  }
}
