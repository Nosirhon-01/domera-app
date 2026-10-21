import { Body, Controller, Delete, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { RegisterDeviceDto, UnregisterDeviceDto } from './dto/register-device.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Notifications')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('devices')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register device FCM token',
    description: 'Call after login and whenever firebase_messaging reports a new token. Idempotent.',
  })
  @ApiResponse({ status: 200, description: 'Device registered' })
  register(@CurrentUser('id') userId: string, @Body() dto: RegisterDeviceDto) {
    return this.notificationsService.registerDevice(userId, dto.token, dto.platform);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unregister device FCM token (call on logout)' })
  @ApiResponse({ status: 200, description: 'Device unregistered' })
  unregister(@CurrentUser('id') userId: string, @Body() dto: UnregisterDeviceDto) {
    return this.notificationsService.unregisterDevice(userId, dto.token);
  }
}
