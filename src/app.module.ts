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

function throttleTtlMs(value?: string): number {
  const n = Number(value);
  if (!n) return 60_000;
  return n < 1000 ? n * 1000 : n;
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate,
    }),
    ThrottlerModule.forRoot([
      {
        // @nestjs/throttler v5 expects milliseconds; .env.example gives seconds (60)
        ttl: throttleTtlMs(process.env.THROTTLE_TTL),
        limit: Number(process.env.THROTTLE_LIMIT) || 100,
      },
    ]),
    PrismaModule,
    AuthModule,
    UsersModule,
    // Listed before PropertiesModule to make it explicit that DELETE /properties/images/:imageId
    // must be registered before DELETE /properties/:id (PropertiesModule also imports it).
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
