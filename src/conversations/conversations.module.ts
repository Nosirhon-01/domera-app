import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { MessagesController } from './messages.controller';
import { ConversationsService } from './conversations.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ConversationsController, MessagesController],
  providers: [ConversationsService],
})
export class ConversationsModule {}
