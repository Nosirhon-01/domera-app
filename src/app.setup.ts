import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import * as path from 'path';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

/**
 * Global HTTP configuration shared by main.ts and the e2e tests,
 * so tests exercise exactly what runs in production.
 */
export function configureApp(app: NestExpressApplication) {
  const configService = app.get(ConfigService);
  const apiPrefix = configService.get<string>('API_PREFIX') || 'api';
  const corsOrigins = configService.get<string[]>('cors.origins') || ['*'];

  // Behind a reverse proxy (Caddy/nginx) — use X-Forwarded-* for client IP and protocol
  if (configService.get<string>('TRUST_PROXY') === 'true') {
    app.set('trust proxy', 1);
  }

  // Global Prefix
  app.setGlobalPrefix(apiPrefix);

  // Security Middleware
  app.use(
    helmet({
      hsts: false,
      contentSecurityPolicy: false,
    }),
  );
  app.enableCors({
    origin: corsOrigins.includes('*') ? true : corsOrigins,
    credentials: true,
  });

  // Serve static uploads
  app.useStaticAssets(path.join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });

  // Global Validation Pipe & Interceptors
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // Close Prisma connections cleanly on SIGTERM/SIGINT (PM2 restart, docker stop)
  app.enableShutdownHooks();

  return { apiPrefix };
}
