import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

export const PASSWORD = 'Secret123!';

export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });
  configureApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  const http: Http = () => request(app.getHttpServer());
  return { app, prisma, http };
}

/** Empty all tables. Guarded by test/setup-env.ts (DB name must end with _test). */
export async function resetDb(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "device_tokens", "messages", "conversation_participants", "conversations", ' +
      '"favorites", "property_images", "properties", "refresh_tokens", "users" CASCADE',
  );
}

let counter = 0;
export async function createUser(
  prisma: PrismaService,
  opts: { role?: Role; isActive?: boolean; name?: string } = {},
) {
  counter += 1;
  return prisma.user.create({
    data: {
      name: opts.name ?? `User ${counter}`,
      email: `user${counter}_${Date.now()}@test.uz`,
      password: await bcrypt.hash(PASSWORD, 4),
      role: opts.role ?? Role.USER,
      isActive: opts.isActive ?? true,
    },
  });
}

export type Http = () => ReturnType<typeof request>;

export async function login(http: Http, email: string) {
  const res = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
  return res.body.data as { accessToken: string; refreshToken: string; user: any };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
