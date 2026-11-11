import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { SmsService } from '../src/auth/sms/sms.service';
import { ReviewAccountService } from '../src/auth/review-account.service';
import { bearer, createTestApp, Http, resetDb } from './utils';

const PHONE = '+998901112233';
const REVIEW = { REVIEW_PHONE: '+998 (90) 000-00-00', REVIEW_OTP_CODE: '123456', REVIEW_PASSWORD: '123456' };
const LISTING = { title: 'Uyim', description: 'Sotiladi', propertyType: 'SHOP', purpose: 'SALE', price: 1, area: 1, address: 'Toshkent' };

describe('Phone sign-in /auth/otp (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Http;
  let env: Record<string, string>;
  let sent: { phone: string; message: string }[];

  const send = (phone = PHONE) => http().post('/api/auth/otp/send').send({ phone });
  const verify = (code: string, phone = PHONE, extra = {}) =>
    http().post('/api/auth/otp/verify').send({ phone, code, ...extra });
  const signIn = async (phone = PHONE) => {
    const code = (await send(phone).expect(200)).body.data.devCode;
    return (await verify(code, phone).expect(200)).body.data;
  };
  const production = (more: Record<string, string> = {}) => {
    env = { NODE_ENV: 'production', OTP_DEV_MODE: 'true', SMS_MODE: 'off', ...more };
  };

  beforeAll(async () => {
    ({ app, prisma, http } = await createTestApp());
  });
  beforeEach(async () => {
    await resetDb(prisma);
    env = {};
    sent = [];
    const config = app.get(ConfigService);
    const real = config.get.bind(config);
    jest.spyOn(config, 'get').mockImplementation(((key: string) => (key in env ? env[key] : real(key))) as any);
    // Eskiz is never called for real
    jest.spyOn(app.get(SmsService), 'send').mockImplementation(async (phone, message) => {
      sent.push({ phone, message });
    });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => app.close());

  it('new number: code → USER account, needsName → name saved → can post and delete own listing', async () => {
    const step1 = await send('+998 90 111-22-33').expect(200);
    expect(step1.body.data).toMatchObject({ phone: PHONE, expiresIn: 180, retryAfter: 60, delivery: 'none' });

    const res = await verify(step1.body.data.devCode, '901112233').expect(200);
    const data = res.body.data;
    expect(data).toMatchObject({ isNewUser: true, needsName: true });
    expect(data.user).toMatchObject({ phone: PHONE, role: Role.USER });
    expect(JSON.stringify(res.body)).not.toContain('password');

    // Name screen
    await http().patch('/api/auth/me').set(bearer(data.accessToken)).send({ name: '' }).expect(400);
    const named = await http()
      .patch('/api/auth/me')
      .set(bearer(data.accessToken))
      .send({ name: '  Ali Valiyev ' })
      .expect(200);
    expect(named.body.data.user.name).toBe('Ali Valiyev');

    // Registered user posts a listing and deletes it
    const listing = await http().post('/api/properties').set(bearer(data.accessToken)).send(LISTING).expect(201);
    expect(listing.body.data.ownerId).toBe(data.user.id);
    await http().delete(`/api/properties/${listing.body.data.id}`).set(bearer(data.accessToken)).expect(200);
    await http().get(`/api/properties/${listing.body.data.id}`).expect(404);
    // Anonymous cannot post
    await http().post('/api/properties').send(LISTING).expect(401);

    // Next sign-in: same account, name no longer asked
    await prisma.registrationChallenge.updateMany({ data: { createdAt: new Date(Date.now() - 61_000) } });
    const again = await signIn();
    expect(again).toMatchObject({ isNewUser: false, needsName: false });
    expect(again.user.id).toBe(data.user.id);
    expect(await prisma.user.count()).toBe(1);
  });

  it('another user cannot delete my listing', async () => {
    const me = await signIn();
    const other = await signIn('+998905554433');
    const listing = await http().post('/api/properties').set(bearer(me.accessToken)).send(LISTING).expect(201);
    await http().delete(`/api/properties/${listing.body.data.id}`).set(bearer(other.accessToken)).expect(403);
  });

  it('tokens work with /auth/me and /auth/refresh', async () => {
    const data = await signIn();
    await http().get('/api/auth/me').set(bearer(data.accessToken)).expect(200);
    const refreshed = await http().post('/api/auth/refresh').send({ refreshToken: data.refreshToken }).expect(200);
    expect(refreshed.body.data.accessToken).toBeDefined();
  });

  it('wrong code, attempt limit, single use, expiry', async () => {
    const code = (await send().expect(200)).body.data.devCode;
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await verify(wrong).expect(400)).body.message).toBe('Invalid code. Attempts left: 4');
    for (let i = 0; i < 3; i++) await verify(wrong).expect(400);
    expect((await verify(wrong).expect(400)).body.message).toMatch(/too many wrong attempts/i);
    await verify(code).expect(400); // locked
    expect(await prisma.user.count()).toBe(0);

    await prisma.registrationChallenge.deleteMany();
    const fresh = (await send().expect(200)).body.data.devCode;
    await verify(fresh).expect(200);
    await verify(fresh).expect(400); // single use

    await prisma.registrationChallenge.deleteMany();
    const old = (await send().expect(200)).body.data.devCode;
    await prisma.registrationChallenge.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await verify(old).expect(400);
  });

  it('cooldown and hourly limit are shared with registration codes', async () => {
    await send().expect(200);
    const res = await send().expect(429);
    expect(res.headers['retry-after']).toBe(String(res.body.retryAfter));
    await http().post('/api/auth/register/request-code').send({ phone: PHONE }).expect(429);
  });

  it('a login code cannot be used for registration and vice versa', async () => {
    const loginCode = (await send().expect(200)).body.data.devCode;
    await http().post('/api/auth/register/verify-code').send({ phone: PHONE, code: loginCode }).expect(400);
    await verify(loginCode).expect(200);
  });

  it('deactivated account cannot sign in', async () => {
    await prisma.user.create({ data: { name: 'X', phone: PHONE, password: 'x', isActive: false } });
    const code = (await send().expect(200)).body.data.devCode;
    await verify(code).expect(401);
  });

  it('production + live: the code goes only by SMS and works', async () => {
    production({ SMS_MODE: 'live' });
    const res = await send().expect(200);
    expect(res.body.data.devCode).toBeUndefined();
    expect(res.body.data.delivery).toBe('sms');
    const code = sent[0].message.match(/\d{6}/)![0];
    expect((await verify(code).expect(200)).body.data.isNewUser).toBe(true);
  });

  it('production without live SMS: 503 for normal numbers', async () => {
    production({ SMS_MODE: 'test' });
    await send().expect(503);
    expect(sent).toHaveLength(0);
  });

  describe('App Store / Play review account (+998 90 000 00 00 / 123456)', () => {
    it('works in production even when SMS is off: fixed code, no SMS, no devCode, no limits', async () => {
      production(REVIEW);
      await app.get(ReviewAccountService).sync(); // runs on every server start
      const account = await prisma.user.findUniqueOrThrow({ where: { phone: '+998900000000' } });
      expect(account.role).toBe(Role.USER);

      for (let i = 0; i < 7; i++) {
        const res = await send('+998900000000').expect(200);
        expect(res.body.data).toMatchObject({ phone: '+998900000000', delivery: 'none' });
        expect(res.body.data.devCode).toBeUndefined();
      }
      expect(sent).toHaveLength(0);

      await verify('654321', '+998900000000').expect(400);
      const data = (await verify('123456', '900000000').expect(200)).body.data;
      expect(data).toMatchObject({ isNewUser: false, needsName: false });
      expect(data.user).toMatchObject({ id: account.id, role: Role.USER });

      // Reviewer can post and delete a listing
      const listing = await http().post('/api/properties').set(bearer(data.accessToken)).send(LISTING).expect(201);
      await http().delete(`/api/properties/${listing.body.data.id}`).set(bearer(data.accessToken)).expect(200);

      // Same credentials also work as phone + password
      await http().post('/api/auth/login').send({ phone: '+998900000000', password: '123456' }).expect(200);
    });

    it('without REVIEW_PASSWORD the first sign-in creates the account and asks the name', async () => {
      production({ REVIEW_PHONE: REVIEW.REVIEW_PHONE, REVIEW_OTP_CODE: '123456' });
      await send('+998900000000').expect(200);
      const data = (await verify('123456', '+998900000000').expect(200)).body.data;
      expect(data).toMatchObject({ isNewUser: true, needsName: true });
    });

    it('fixed code is disabled if the number belongs to an admin', async () => {
      await prisma.user.create({ data: { name: 'Admin', phone: '+998900000000', password: 'x', role: Role.ADMIN } });
      production(REVIEW);
      await send('+998900000000').expect(503); // normal path, and production has no SMS here
      await verify('123456', '+998900000000').expect(400);
    });

    it('other numbers do not get the review code', async () => {
      production({ ...REVIEW, SMS_MODE: 'live' });
      await send().expect(200);
      expect(sent).toHaveLength(1);
      const code = sent[0].message.match(/\d{6}/)![0];
      if (code !== '123456') await verify('123456').expect(400);
    });
  });

  it('rejects malformed input', async () => {
    await send('abc').expect(400);
    await verify('12').expect(400);
    await verify('123456', PHONE, { name: 'A' }).expect(400); // name too short
  });
});
