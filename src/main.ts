import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import * as path from 'path';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 3000;
  const apiPrefix = configService.get<string>('API_PREFIX') || 'api';
  const corsOrigins = configService.get<string[]>('cors.origins') || ['*'];

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

  // Swagger Documentation Setup
  const swaggerConfig = new DocumentBuilder()
    .setTitle('DOMERA Real Estate API')
    .setDescription(
      'Centralized REST API for DOMERA Commercial Real Estate Platform serving Flutter Mobile App, Web Application, Admin Panel, and Telegram Bot.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT access token',
        in: 'header',
      },
      'bearer',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document);

  await app.listen(port);
  logger.log(`DOMERA Backend running on port ${port}`);
  logger.log(`Swagger documentation available at: http://localhost:${port}/${apiPrefix}/docs`);
  logger.log(`Health check available at: http://localhost:${port}/${apiPrefix}/health`);
}

bootstrap();
