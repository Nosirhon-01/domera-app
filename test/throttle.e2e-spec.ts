// Separate file: AUTH_RATE_LIMIT is read when the auth controller module loads,
// and jest isolates modules per test file.
process.env.AUTH_RATE_LIMIT = '3';

import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, Http, resetDb } from './utils';

describe('Auth rate limiting (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Http;

  beforeAll(async () => {
    ({ app, prisma, http } = await createTestApp());
    await resetDb(prisma);
  });
  afterAll(() => app.close());

  it('blocks brute-force login attempts with 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await http().post('/api/auth/login').send({ email: 'x@test.uz', password: 'WrongPass1' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });

  it('does not throttle normal API routes', async () => {
    for (let i = 0; i < 10; i++) {
      await http().get('/api/properties').expect(200);
    }
  });
});
