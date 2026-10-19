import { Controller, Patch, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Messages')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('messages')
export class MessagesController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Patch(':id/read')
  @ApiOperation({
    summary: 'Mark message as read',
    description:
      'Marks a message as read. Only the recipient (not sender) can mark a message as read. Idempotent — safe to call multiple times.',
  })
  @ApiParam({ name: 'id', description: 'Message UUID' })
  @ApiResponse({ status: 200, description: 'Message marked as read' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Sender cannot mark their own message as read' })
  @ApiResponse({ status: 404, description: 'Message not found' })
  markAsRead(@Param('id') messageId: string, @CurrentUser('id') userId: string) {
    return this.conversationsService.markMessageAsRead(messageId, userId);
  }
}
