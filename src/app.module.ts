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
    PropertiesModule,
    PropertyImagesModule,
    FavoritesModule,
    UploadsModule,
    HealthModule,
    AgentsModule,
    ConversationsModule,
  ],
})
export class AppModule {}
