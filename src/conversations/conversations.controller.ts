import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Conversations')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create or get existing conversation',
    description:
      'Creates a new conversation with the given participantId, or returns the existing one. Prevents duplicate conversations.',
  })
  @ApiResponse({
    status: 201,
    description: 'Conversation created or existing one returned',
  })
  @ApiResponse({ status: 400, description: 'Cannot start conversation with yourself' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Participant not found' })
  createOrGet(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateConversationDto,
  ) {
    return this.conversationsService.createOrGetConversation(userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get my conversations (paginated)',
    description: 'Returns only conversations where the authenticated user is a participant.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated conversations list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getMyConversations(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.conversationsService.getMyConversations(userId, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get single conversation',
    description:
      'Returns conversation details. Returns 404 if not found OR if current user is not a participant (IDOR safe).',
  })
  @ApiParam({ name: 'id', description: 'Conversation UUID' })
  @ApiResponse({ status: 200, description: 'Conversation details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found (or not a participant)' })
  getOne(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.conversationsService.getConversation(id, userId);
  }

  @Get(':id/messages')
  @ApiOperation({
    summary: 'Get messages in a conversation (paginated)',
    description:
      'Returns messages ordered oldest-first (suitable for Flutter chat UI). Only accessible by participants.',
  })
  @ApiParam({ name: 'id', description: 'Conversation UUID' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated messages list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found (or not a participant)' })
  getMessages(
    @Param('id') conversationId: string,
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.conversationsService.getMessages(conversationId, userId, query);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Send a message',
    description:
      'Sends a message in the conversation. senderId is always taken from the JWT token — client-supplied senderId is ignored.',
  })
  @ApiParam({ name: 'id', description: 'Conversation UUID' })
  @ApiResponse({ status: 201, description: 'Message sent' })
  @ApiResponse({ status: 400, description: 'Validation error (empty or too long message)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Conversation not found (or not a participant)' })
  sendMessage(
    @Param('id') conversationId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.conversationsService.sendMessage(conversationId, userId, dto);
  }
}
