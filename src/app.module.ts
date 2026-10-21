import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { validate } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PropertiesModule } from './properties/properties.module';
import { PropertyImagesModule } from './property-images/property-images.module';
import { FavoritesModule } from './favorites/favorites.module';
import { UploadsModule } from './uploads/uploads.module';
import { HealthModule } from './health/health.module';
import { AgentsModule } from './agents/agents.module';
import { ConversationsModule } from './conversations/conversations.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL) || 60000,
        limit: Number(process.env.THROTTLE_LIMIT) || 100,
      },
    ]),
    PrismaModule,
    AuthModule,
    UsersModule,
    // Must be registered before PropertiesModule so that
    // DELETE /properties/images/:imageId is not captured by DELETE /properties/:id
    PropertyImagesModule,
    PropertiesModule,
    FavoritesModule,
    UploadsModule,
    HealthModule,
    AgentsModule,
    ConversationsModule,
    NotificationsModule,
  ],
})
export class AppModule {}
