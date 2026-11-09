import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../src/prisma/prisma.service';
import { RegistrationService } from '../src/auth/registration/registration.service';
import { bearer, createTestApp, Http, resetDb } from './utils';

const PHONE = '+998901112233';
const PASSWORD = 'Secret123';

describe('Phone registration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Http;

  const requestCode = (phone = PHONE) => http().post('/api/auth/register/request-code').send({ phone });
  const verify = (code: string, phone = PHONE) => http().post('/api/auth/register/verify-code').send({ phone, code });
  const complete = (verificationToken: string, password = PASSWORD, passwordConfirmation = password) =>
    http().post('/api/auth/register/complete').send({ verificationToken, password, passwordConfirmation });
  const wrongOf = (code: string) => (code === '000000' ? '111111' : '000000');
  /** Lets the next request-code pass the 60 s cooldown. */
  const skipCooldown = () =>
    prisma.registrationChallenge.updateMany({ data: { createdAt: new Date(Date.now() - 61_000) } });

  async function verifiedToken(phone = PHONE) {
    const code = (await requestCode(phone).expect(200)).body.data.devCode;
    return (await verify(code, phone).expect(200)).body.data.verificationToken as string;
  }

  beforeAll(async () => {
    ({ app, prisma, http } = await createTestApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  it('1/4/10/11: new phone → code → token → password creates a USER with working JWT tokens', async () => {
    const step1 = await requestCode('+998 90 111-22-33').expect(200);
    expect(step1.body).toMatchObject({
      success: true,
      data: { phone: PHONE, expiresIn: 180, retryAfter: 60, devCode: expect.stringMatching(/^\d{6}$/) },
    });

    const step2 = await verify(step1.body.data.devCode, '901112233').expect(200);
    const { verificationToken } = step2.body.data;
    expect(step2.body.data).toMatchObject({ phone: PHONE, expiresIn: 600 });
    expect(verificationToken.length).toBeGreaterThanOrEqual(40);

    const res = await http()
      .post('/api/auth/register/complete')
      .send({ verificationToken, password: PASSWORD, passwordConfirmation: PASSWORD, name: 'Ali' })
      .expect(201);
    const data = res.body.data;
    expect(data.user).toMatchObject({ phone: PHONE, name: 'Ali', role: Role.USER, isActive: true });
    expect(JSON.stringify(res.body)).not.toContain('password');

    // Password stored only as bcrypt hash
    const stored = await prisma.user.findUniqueOrThrow({ where: { phone: PHONE } });
    expect(stored.password).not.toBe(PASSWORD);
    expect(await bcrypt.compare(PASSWORD, stored.password)).toBe(true);

    // Access token works, refresh token rotates, phone+password login works
    const me = await http().get('/api/auth/me').set(bearer(data.accessToken)).expect(200);
    expect(me.body.data.id).toBe(data.user.id);
    const refreshed = await http().post('/api/auth/refresh').send({ refreshToken: data.refreshToken }).expect(200);
    expect(refreshed.body.data.accessToken).toBeDefined();
    await http().post('/api/auth/refresh').send({ refreshToken: data.refreshToken }).expect(401);
    await http().post('/api/auth/login').send({ phone: '901112233', password: PASSWORD }).expect(200);
  });

  it('2: every request creates a new random code and invalidates the previous one', async () => {
    const codes = new Set<string>();
    let previous: string | undefined;
    for (let i = 0; i < 5; i++) {
      const code = (await requestCode().expect(200)).body.data.devCode;
      codes.add(code);
      if (previous && previous !== code) {
        await verify(previous).expect(400); // old code no longer works
      }
      previous = code;
      await skipCooldown();
    }
    expect(codes.size).toBeGreaterThan(1);
    // Only hashes are stored
    const rows = await prisma.registrationChallenge.findMany();
    for (const row of rows) {
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect([...codes].some((c) => row.codeHash.includes(c))).toBe(false);
    }
    expect(rows.filter((r) => r.consumedAt === null)).toHaveLength(1);
  });

  it('5: wrong code returns 400 with attempts left and creates nothing', async () => {
    const code = (await requestCode().expect(200)).body.data.devCode;
    const res = await verify(wrongOf(code)).expect(400);
    expect(res.body).toMatchObject({ success: false, message: 'Invalid code. Attempts left: 4' });
    expect(res.body.data).toBeUndefined();
    expect(await prisma.user.count()).toBe(0);
    // Still usable with the right code
    await verify(code).expect(200);
  });

  it('6: expired code is rejected', async () => {
    const code = (await requestCode().expect(200)).body.data.devCode;
    await prisma.registrationChallenge.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await verify(code).expect(400);
    expect(res.body.message).toMatch(/expired/i);
  });

  it('7: 5 wrong attempts lock the code, even the right one is refused afterwards', async () => {
    const code = (await requestCode().expect(200)).body.data.devCode;
    for (const left of [4, 3, 2, 1]) {
      const res = await verify(wrongOf(code)).expect(400);
      expect(res.body.message).toBe(`Invalid code. Attempts left: ${left}`);
    }
    const fifth = await verify(wrongOf(code)).expect(400);
    expect(fifth.body.message).toMatch(/too many wrong attempts/i);
    const locked = await verify(code).expect(400);
    expect(locked.body.message).toMatch(/too many wrong attempts/i);
    expect(await prisma.user.count()).toBe(0);
  });

  it('code and verification token are one-time; complete without verification is impossible', async () => {
    const code = (await requestCode().expect(200)).body.data.devCode;
    const token = (await verify(code).expect(200)).body.data.verificationToken;
    await verify(code).expect(400); // code reuse

    await complete('x'.repeat(43)).expect(400); // forged token
    await complete(token).expect(201);
    const reuse = await complete(token).expect(400); // token reuse
    expect(reuse.body.message).toMatch(/invalid, expired or already used/);
    expect(await prisma.user.count()).toBe(1);
  });

  it('expired verification token is rejected', async () => {
    const token = await verifiedToken();
    await prisma.registrationChallenge.updateMany({ data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
    await complete(token).expect(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it('8: an already registered phone cannot register again', async () => {
    await complete(await verifiedToken()).expect(201);
    const res = await requestCode('901112233').expect(409);
    expect(res.body.success).toBe(false);

    // Legacy rows stored without "+" are also detected
    await prisma.user.create({ data: { name: 'Old', phone: '998907776655', password: 'x' } });
    await requestCode('+998907776655').expect(409);
  });

  it('8: phone taken between verify and complete → 409, token stays unused', async () => {
    const token = await verifiedToken();
    await prisma.user.create({ data: { name: 'Race', phone: PHONE, password: 'x' } });
    await complete(token).expect(409);
    expect(await prisma.user.count()).toBe(1);
    const challenge = await prisma.registrationChallenge.findFirstOrThrow({ where: { verifiedAt: { not: null } } });
    expect(challenge.consumedAt).toBeNull(); // transaction rolled back
  });

  it('two parallel completes with one token create exactly one user', async () => {
    const token = await verifiedToken();
    const results = await Promise.all([complete(token), complete(token), complete(token)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400, 400]);
    expect(await prisma.user.count()).toBe(1);
  });

  it('9: mismatched passwords and weak passwords are rejected without consuming the token', async () => {
    const token = await verifiedToken();
    const mismatch = await complete(token, PASSWORD, 'Secret124').expect(400);
    expect(mismatch.body.message).toBe('Passwords do not match');
    for (const weak of ['short1', 'onlyletters', '12345678', 'with space1']) {
      const res = await complete(token, weak).expect(400);
      expect(res.body.message).toBe('Validation failed');
    }
    expect(await prisma.user.count()).toBe(0);
    await complete(token).expect(201);
  });

  it('rate limit per phone: 60 s cooldown with Retry-After, max 5 codes per hour', async () => {
    await requestCode().expect(200);
    const cooldown = await requestCode().expect(429);
    expect(cooldown.body.retryAfter).toBeGreaterThan(0);
    expect(cooldown.body.retryAfter).toBeLessThanOrEqual(60);
    expect(cooldown.headers['retry-after']).toBe(String(cooldown.body.retryAfter));

    for (let i = 0; i < 4; i++) {
      await skipCooldown();
      await requestCode().expect(200);
    }
    await skipCooldown();
    const hourly = await requestCode().expect(429);
    expect(hourly.body.message).toMatch(/too many codes/i);
    // Other numbers are not affected
    await requestCode('+998905554433').expect(200);
  });

  it('parallel requests for one phone create only one code', async () => {
    const results = await Promise.all([requestCode(), requestCode(), requestCode()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 429, 429]);
    expect(await prisma.registrationChallenge.count()).toBe(1);
  });

  it('rejects malformed input', async () => {
    await requestCode('abc').expect(400);
    await requestCode('+998 90 111 22 3').expect(400); // too short
    await requestCode('+998901112233999').expect(400); // too long for +998
    await http().post('/api/auth/register/request-code').send({}).expect(400);
    await verify('12').expect(400);
    await verify('12345a').expect(400);
    await http().post('/api/auth/register/complete').send({ password: PASSWORD, passwordConfirmation: PASSWORD }).expect(400);
  });

  it('legacy POST /auth/register no longer creates phone accounts without verification', async () => {
    await http().post('/api/auth/register').send({ name: 'A', phone: PHONE, password: PASSWORD }).expect(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it('old Eskiz OTP endpoints are gone', async () => {
    await http().post('/api/auth/otp/send').send({ phone: PHONE }).expect(404);
    await http().post('/api/auth/otp/verify').send({ phone: PHONE, code: '123456' }).expect(404);
  });

  it('3/12: the code is returned only in dev mode, never in production', async () => {
    const service = app.get(RegistrationService);
    const config = app.get(ConfigService);
    const real = config.get.bind(config);
    const spy = jest.spyOn(config, 'get');
    try {
      spy.mockImplementation(((key: string) => (key === 'OTP_DEV_MODE' ? 'false' : real(key))) as any);
      expect(service.devMode).toBe(false);
      const off = await requestCode().expect(200);
      expect(off.body.data.devCode).toBeUndefined();
      expect(JSON.stringify(off.body)).not.toMatch(/\b\d{6}\b/);

      await skipCooldown();
      spy.mockImplementation(((key: string) =>
        key === 'NODE_ENV' ? 'production' : key === 'OTP_DEV_MODE' ? 'true' : real(key)) as any);
      expect(service.devMode).toBe(false);
      const prod = await requestCode().expect(200);
      expect(prod.body.data.devCode).toBeUndefined();
      expect(Object.keys(prod.body.data).sort()).toEqual(['expiresIn', 'message', 'phone', 'retryAfter']);
    } finally {
      spy.mockRestore();
    }
    expect(service.devMode).toBe(true);
  });
});
