import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new conversation between the current user and a participant,
   * or return the existing one (prevents duplicate conversations).
   */
  async createOrGetConversation(currentUserId: string, dto: CreateConversationDto) {
    const { participantId } = dto;

    if (participantId === currentUserId) {
      throw new BadRequestException('Cannot start a conversation with yourself');
    }

    // Verify the other participant exists
    const otherUser = await this.prisma.user.findUnique({
      where: { id: participantId },
    });
    if (!otherUser) {
      throw new NotFoundException(`User with ID '${participantId}' not found`);
    }

    // Check if a conversation already exists between exactly these two users
    const existing = await this.prisma.conversation.findFirst({
      where: {
        AND: [
          {
            participants: {
              some: { userId: currentUserId },
            },
          },
          {
            participants: {
              some: { userId: participantId },
            },
          },
        ],
      },
      include: this.conversationInclude(currentUserId),
    });

    if (existing) {
      return this.formatConversation(existing, currentUserId);
    }

    // Create new conversation with both participants
    const conversation = await this.prisma.conversation.create({
      data: {
        participants: {
          create: [{ userId: currentUserId }, { userId: participantId }],
        },
      },
      include: this.conversationInclude(currentUserId),
    });

    return this.formatConversation(conversation, currentUserId);
  }

  /**
   * Get all conversations for the current user.
   */
  async getMyConversations(currentUserId: string, query: PaginationQueryDto) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const conversationWhere: Prisma.ConversationWhereInput = {
      participants: { some: { userId: currentUserId } },
    };

    const [total, conversations] = await Promise.all([
      this.prisma.conversation.count({ where: conversationWhere }),
      this.prisma.conversation.findMany({
        where: conversationWhere,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        include: this.conversationInclude(currentUserId),
      }),
    ]);

    // Fetch unread counts for all conversations in one query
    const conversationIds = conversations.map((c) => c.id);
    const unreadCounts = await this.prisma.message.groupBy({
      by: ['conversationId'],
      where: {
        conversationId: { in: conversationIds },
        senderId: { not: currentUserId },
        readAt: null,
      },
      _count: { id: true },
    });

    const unreadMap = new Map(unreadCounts.map((u) => [u.conversationId, u._count.id]));

    return {
      items: conversations.map((c) =>
        this.formatConversation(c, currentUserId, unreadMap.get(c.id) ?? 0),
      ),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a single conversation — only accessible by participants.
   */
  async getConversation(conversationId: string, currentUserId: string) {
    const conversation = await this.findConversationForUser(conversationId, currentUserId);

    const unreadCount = await this.prisma.message.count({
      where: {
        conversationId,
        senderId: { not: currentUserId },
        readAt: null,
      },
    });

    return this.formatConversation(conversation, currentUserId, unreadCount);
  }

  /**
   * Mark ALL unread messages in a conversation as read.
   * Only marks messages where the current user is NOT the sender.
   */
  async markConversationAsRead(conversationId: string, currentUserId: string) {
    // Ensure user is a participant (IDOR safe — throws 404 if not)
    await this.findConversationForUser(conversationId, currentUserId);

    const result = await this.prisma.message.updateMany({
      where: {
        conversationId,
        senderId: { not: currentUserId },
        readAt: null,
      },
      data: { readAt: new Date() },
    });

    return {
      message: `${result.count} message(s) marked as read`,
      updatedCount: result.count,
    };
  }

  /**
   * Get messages in a conversation — paginated, oldest first for Flutter chat UI.
   */
  async getMessages(conversationId: string, currentUserId: string, query: PaginationQueryDto) {
    // Ensure user is participant
    await this.findConversationForUser(conversationId, currentUserId);

    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const [total, messages] = await Promise.all([
      this.prisma.message.count({ where: { conversationId } }),
      this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' }, // oldest first — Flutter renders bottom-up
        skip,
        take: limit,
        include: {
          sender: {
            select: {
              id: true,
              name: true,
              avatar: true,
              role: true,
            },
          },
        },
      }),
    ]);

    return {
      items: messages,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Send a message — senderId is ALWAYS taken from the authenticated user.
   */
  async sendMessage(
    conversationId: string,
    currentUserId: string,
    dto: SendMessageDto,
  ) {
    // Ensure user is participant (throws 403 if not)
    await this.findConversationForUser(conversationId, currentUserId);

    // Trim and validate content (whitespace-only check)
    const trimmed = dto.content.trim();
    if (!trimmed) {
      throw new BadRequestException('Message content cannot be empty or whitespace only');
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId: currentUserId, // NEVER from client
        content: trimmed,
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            avatar: true,
            role: true,
          },
        },
      },
    });

    // Update conversation updatedAt for sorting
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return message;
  }

  /**
   * Mark a message as read — only the recipient (not sender) can mark as read.
   */
  async markMessageAsRead(messageId: string, currentUserId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: {
          include: {
            participants: true,
          },
        },
      },
    });

    if (!message) {
      throw new NotFoundException(`Message with ID '${messageId}' not found`);
    }

    // Verify user is a participant
    const isParticipant = message.conversation.participants.some(
      (p) => p.userId === currentUserId,
    );
    if (!isParticipant) {
      throw new ForbiddenException('You are not a participant of this conversation');
    }

    // Sender cannot mark their own message as read
    if (message.senderId === currentUserId) {
      throw new ForbiddenException('Sender cannot mark their own message as read');
    }

    if (message.readAt) {
      return message; // already read, idempotent
    }

    return this.prisma.message.update({
      where: { id: messageId },
      data: { readAt: new Date() },
      include: {
        sender: {
          select: { id: true, name: true, avatar: true, role: true },
        },
      },
    });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /** Fetch conversation and assert the currentUser is a participant. Throws 404 to avoid IDOR. */
  private async findConversationForUser(conversationId: string, currentUserId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        participants: { some: { userId: currentUserId } },
      },
      include: this.conversationInclude(currentUserId),
    });

    if (!conversation) {
      // Return 404 (not 403) to avoid leaking conversation existence — IDOR safe
      throw new NotFoundException(`Conversation with ID '${conversationId}' not found`);
    }

    return conversation;
  }

  private conversationInclude(currentUserId: string) {
    return {
      participants: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              avatar: true,
              email: true,
              phone: true,
              role: true,
            },
          },
        },
      },
      messages: {
        orderBy: { createdAt: 'desc' as const },
        take: 1, // last message preview
        include: {
          sender: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
        },
      },
    };
  }

  private formatConversation(conversation: any, currentUserId: string, unreadCount = 0) {
    const otherParticipants = conversation.participants
      .filter((p: any) => p.userId !== currentUserId)
      .map((p: any) => p.user);

    const lastMessage = conversation.messages?.[0] || null;

    return {
      id: conversation.id,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      participants: conversation.participants.map((p: any) => p.user),
      otherParticipants,
      lastMessage,
      unreadCount,
    };
  }
}
