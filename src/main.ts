import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 3000;
  const { apiPrefix } = configureApp(app);

  // Swagger Documentation Setup (set SWAGGER_ENABLED=false to hide it)
  const swaggerEnabled = configService.get<string>('SWAGGER_ENABLED') !== 'false';
  if (swaggerEnabled) {
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
  }

  await app.listen(port);
  logger.log(`DOMERA Backend running on port ${port}`);
  if (swaggerEnabled) {
    logger.log(`Swagger documentation available at: http://localhost:${port}/${apiPrefix}/docs`);
  }
  logger.log(`Health check available at: http://localhost:${port}/${apiPrefix}/health`);
}

bootstrap();
