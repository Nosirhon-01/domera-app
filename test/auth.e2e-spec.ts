import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, createTestApp, createUser, login, PASSWORD, resetDb } from './utils';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Awaited<ReturnType<typeof createTestApp>>['http'];

  beforeAll(async () => {
    ({ app, prisma, http } = await createTestApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  describe('register', () => {
    it('creates a user, returns tokens and never the password hash', async () => {
      const res = await http()
        .post('/api/auth/register')
        .send({ name: 'Ali', email: 'Ali@Test.uz', password: PASSWORD })
        .expect(201);

      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();
      expect(res.body.data.user.email).toBe('ali@test.uz');
      expect(res.body.data.user.role).toBe(Role.USER);
      expect(JSON.stringify(res.body)).not.toContain('password');
    });

    it('rejects duplicate email case-insensitively with 409', async () => {
      await http().post('/api/auth/register').send({ name: 'A', email: 'dup@test.uz', password: PASSWORD }).expect(201);
      const res = await http()
        .post('/api/auth/register')
        .send({ name: 'B', email: 'DUP@test.uz', password: PASSWORD })
        .expect(409);
      expect(res.body.success).toBe(false);
    });

    it('rejects duplicate phone with 409', async () => {
      await http().post('/api/auth/register').send({ name: 'A', phone: '+998901112233', password: PASSWORD }).expect(201);
      await http().post('/api/auth/register').send({ name: 'B', phone: '+998901112233', password: PASSWORD }).expect(409);
    });

    it('does not allow choosing a role at registration (privilege escalation)', async () => {
      await http()
        .post('/api/auth/register')
        .send({ name: 'Evil', email: 'evil@test.uz', password: PASSWORD, role: 'ADMIN' })
        .expect(400);
      expect(await prisma.user.count()).toBe(0);
    });

    it('requires email or phone', async () => {
      await http().post('/api/auth/register').send({ name: 'A', password: PASSWORD }).expect(400);
    });
  });

  describe('login', () => {
    it('logs in with email and with phone', async () => {
      const user = await createUser(prisma);
      await prisma.user.update({ where: { id: user.id }, data: { phone: '+998905556677' } });

      const byEmail = await login(http, user.email!);
      expect(byEmail.user.id).toBe(user.id);
      expect(byEmail.user.password).toBeUndefined();

      const byPhone = await http().post('/api/auth/login').send({ phone: '+998905556677', password: PASSWORD }).expect(200);
      expect(byPhone.body.data.user.id).toBe(user.id);
    });

    it('returns 401 with a generic message for a wrong password and unknown user', async () => {
      const user = await createUser(prisma);
      const wrong = await http().post('/api/auth/login').send({ email: user.email, password: 'WrongPass1' }).expect(401);
      const unknown = await http().post('/api/auth/login').send({ email: 'nobody@test.uz', password: PASSWORD }).expect(401);
      expect(wrong.body.message).toBe('Invalid credentials');
      expect(unknown.body.message).toBe('Invalid credentials');
    });

    it('rejects inactive users', async () => {
      const user = await createUser(prisma, { isActive: false });
      await http().post('/api/auth/login').send({ email: user.email, password: PASSWORD }).expect(401);
    });
  });

  describe('protected routes', () => {
    it('GET /auth/me works with a valid token and hides the password', async () => {
      const user = await createUser(prisma);
      const { accessToken } = await login(http, user.email!);
      const res = await http().get('/api/auth/me').set(bearer(accessToken)).expect(200);
      expect(res.body.data.id).toBe(user.id);
      expect(res.body.data.password).toBeUndefined();
    });

    it('rejects missing, malformed, wrongly signed and expired tokens', async () => {
      const user = await createUser(prisma);
      await http().get('/api/auth/me').expect(401);
      await http().get('/api/auth/me').set(bearer('not-a-jwt')).expect(401);

      const forged = jwt.sign({ sub: user.id, role: 'ADMIN' }, 'some-other-secret');
      await http().get('/api/auth/me').set(bearer(forged)).expect(401);

      const expired = jwt.sign(
        { sub: user.id, role: user.role, exp: Math.floor(Date.now() / 1000) - 60 },
        process.env.JWT_ACCESS_SECRET!,
      );
      await http().get('/api/auth/me').set(bearer(expired)).expect(401);
    });

    it('rejects a valid token once the user is deactivated', async () => {
      const user = await createUser(prisma);
      const { accessToken } = await login(http, user.email!);
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      await http().get('/api/auth/me').set(bearer(accessToken)).expect(401);
    });

    it('uses the role from the database, not from the token payload', async () => {
      const user = await createUser(prisma, { role: Role.USER });
      const tokenClaimingAdmin = jwt.sign({ sub: user.id, role: 'ADMIN' }, process.env.JWT_ACCESS_SECRET!, {
        expiresIn: '5m',
      });
      await http().get('/api/users').set(bearer(tokenClaimingAdmin)).expect(403);
    });
  });

  describe('refresh tokens', () => {
    it('rotates: the new token works, the old one is revoked', async () => {
      const user = await createUser(prisma);
      const first = await login(http, user.email!);

      const rotated = await http().post('/api/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200);
      expect(rotated.body.data.refreshToken).not.toBe(first.refreshToken);
      expect(rotated.body.data.user.password).toBeUndefined();

      await http().post('/api/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
      await http().post('/api/auth/refresh').send({ refreshToken: rotated.body.data.refreshToken }).expect(200);
    });

    it('stores the refresh-token expiry from JWT_REFRESH_EXPIRES_IN', async () => {
      const user = await createUser(prisma);
      const { refreshToken } = await login(http, user.email!);
      const { tokenId, exp } = jwt.decode(refreshToken) as any;
      const record = await prisma.refreshToken.findUnique({ where: { id: tokenId } });
      expect(record!.expiresAt.getTime()).toBe(exp * 1000);
      expect(record!.tokenHash).not.toBe(refreshToken);
    });

    it('lets only one of two concurrent refreshes with the same token succeed', async () => {
      const user = await createUser(prisma);
      const { refreshToken } = await login(http, user.email!);
      const results = await Promise.all([
        http().post('/api/auth/refresh').send({ refreshToken }),
        http().post('/api/auth/refresh').send({ refreshToken }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    });

    it('rejects refresh for an inactive user', async () => {
      const user = await createUser(prisma);
      const { refreshToken } = await login(http, user.email!);
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      await http().post('/api/auth/refresh').send({ refreshToken }).expect(401);
    });

    it('rejects an access token used as a refresh token', async () => {
      const user = await createUser(prisma);
      const { accessToken } = await login(http, user.email!);
      await http().post('/api/auth/refresh').send({ refreshToken: accessToken }).expect(401);
    });
  });

  describe('logout', () => {
    it('revokes only the given device session', async () => {
      const user = await createUser(prisma);
      const phone = await login(http, user.email!);
      const tablet = await login(http, user.email!);

      await http().post('/api/auth/logout').set(bearer(phone.accessToken)).send({ refreshToken: phone.refreshToken }).expect(200);

      await http().post('/api/auth/refresh').send({ refreshToken: phone.refreshToken }).expect(401);
      await http().post('/api/auth/refresh').send({ refreshToken: tablet.refreshToken }).expect(200);
    });

    it('works without a body and revokes all sessions', async () => {
      const user = await createUser(prisma);
      const a = await login(http, user.email!);
      const b = await login(http, user.email!);

      await http().post('/api/auth/logout').set(bearer(a.accessToken)).expect(200);

      await http().post('/api/auth/refresh').send({ refreshToken: a.refreshToken }).expect(401);
      await http().post('/api/auth/refresh').send({ refreshToken: b.refreshToken }).expect(401);
    });

    it("cannot revoke another user's session", async () => {
      const alice = await createUser(prisma);
      const bob = await createUser(prisma);
      const aliceSession = await login(http, alice.email!);
      const bobSession = await login(http, bob.email!);

      await http()
        .post('/api/auth/logout')
        .set(bearer(bobSession.accessToken))
        .send({ refreshToken: aliceSession.refreshToken })
        .expect(200);

      await http().post('/api/auth/refresh').send({ refreshToken: aliceSession.refreshToken }).expect(200);
    });
  });

  describe('PATCH /auth/me', () => {
    it('updates profile fields including avatar and bio', async () => {
      const user = await createUser(prisma);
      const { accessToken } = await login(http, user.email!);
      const res = await http()
        .patch('/api/auth/me')
        .set(bearer(accessToken))
        .send({ name: 'New Name', avatar: '/uploads/a.jpg', bio: 'Hi' })
        .expect(200);
      expect(res.body.data.user).toMatchObject({ name: 'New Name', avatar: '/uploads/a.jpg', bio: 'Hi' });
      expect(res.body.data.user.password).toBeUndefined();
    });

    it("returns 409 when taking another user's email", async () => {
      const alice = await createUser(prisma);
      const bob = await createUser(prisma);
      const { accessToken } = await login(http, bob.email!);
      await http().patch('/api/auth/me').set(bearer(accessToken)).send({ email: alice.email!.toUpperCase() }).expect(409);
    });

    it('cannot change own role or active flag', async () => {
      const user = await createUser(prisma);
      const { accessToken } = await login(http, user.email!);
      await http().patch('/api/auth/me').set(bearer(accessToken)).send({ role: 'ADMIN' }).expect(400);
      await http().patch('/api/auth/me').set(bearer(accessToken)).send({ isActive: false }).expect(400);
    });
  });

  describe('DELETE /auth/me', () => {
    it('deletes only the current account', async () => {
      const alice = await createUser(prisma);
      const bob = await createUser(prisma);
      const { accessToken } = await login(http, alice.email!);
      await http().delete('/api/auth/me').set(bearer(accessToken)).expect(200);
      expect(await prisma.user.findUnique({ where: { id: alice.id } })).toBeNull();
      expect(await prisma.user.findUnique({ where: { id: bob.id } })).not.toBeNull();
    });
  });

  describe('RBAC', () => {
    it('only ADMIN/MANAGER can list users, only ADMIN can change them', async () => {
      const user = await createUser(prisma, { role: Role.USER });
      const agent = await createUser(prisma, { role: Role.AGENT });
      const manager = await createUser(prisma, { role: Role.MANAGER });
      const admin = await createUser(prisma, { role: Role.ADMIN });

      for (const u of [user, agent]) {
        const { accessToken } = await login(http, u.email!);
        await http().get('/api/users').set(bearer(accessToken)).expect(403);
      }
      const managerToken = (await login(http, manager.email!)).accessToken;
      const adminToken = (await login(http, admin.email!)).accessToken;

      const list = await http().get('/api/users').set(bearer(managerToken)).expect(200);
      expect(JSON.stringify(list.body)).not.toContain('password');

      await http().patch(`/api/users/${user.id}`).set(bearer(managerToken)).send({ role: 'ADMIN' }).expect(403);
      await http().patch(`/api/users/${user.id}`).set(bearer(adminToken)).send({ role: 'AGENT' }).expect(200);
    });
  });

  describe('health', () => {
    it('reports the database as up', async () => {
      const res = await http().get('/api/health').expect(200);
      expect(res.body.data.services.database.status).toBe('UP');
    });
  });
});
