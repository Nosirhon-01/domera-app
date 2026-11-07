import { BadGatewayException, INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { SmsService } from '../src/auth/otp/sms.service';
import { bearer, createTestApp, Http, resetDb } from './utils';

describe('OTP login (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Http;
  let sent: { phone: string; message: string }[];

  const lastCode = () => sent[sent.length - 1].message.match(/\d{6}/)![0];

  beforeAll(async () => {
    ({ app, prisma, http } = await createTestApp());
    jest.spyOn(app.get(SmsService), 'send').mockImplementation(async (phone, message) => {
      sent.push({ phone, message });
    });
  });
  beforeEach(async () => {
    await resetDb(prisma);
    sent = [];
  });
  afterAll(() => app.close());

  it('SMS failure returns 502/503 to the client and does not start the resend cooldown', async () => {
    const sms = app.get(SmsService);
    (sms.send as jest.Mock)
      .mockRejectedValueOnce(new BadGatewayException('SMS could not be sent, try again later'))
      .mockRejectedValueOnce(new ServiceUnavailableException('SMS service is temporarily unavailable, try again later'));

    const rejected = await http().post('/api/auth/otp/send').send({ phone: '+998901234567' }).expect(502);
    expect(rejected.body).toMatchObject({ success: false, message: 'SMS could not be sent, try again later' });
    const down = await http().post('/api/auth/otp/send').send({ phone: '+998901234567' }).expect(503);
    expect(down.body.success).toBe(false);
    expect(await prisma.otpCode.count()).toBe(0);

    // Immediate retry works (no 429) once SMS goes through
    await http().post('/api/auth/otp/send').send({ phone: '+998901234567' }).expect(200);
    await http().post('/api/auth/otp/verify').send({ phone: '+998901234567', code: lastCode() }).expect(200);
  });

  it('new number: send → verify creates a USER who can post a listing', async () => {
    await http().post('/api/auth/otp/send').send({ phone: '+998 90 111-22-33' }).expect(200);
    expect(sent[0].phone).toBe('+998901112233');

    const res = await http()
      .post('/api/auth/otp/verify')
      .send({ phone: '901112233', code: lastCode(), name: 'Ali' })
      .expect(200);
    const data = res.body.data;
    expect(data.isNewUser).toBe(true);
    expect(data.user).toMatchObject({ phone: '+998901112233', name: 'Ali', role: Role.USER });
    expect(data.user.password).toBeUndefined();

    await http()
      .post('/api/properties')
      .set(bearer(data.accessToken))
      .send({ title: 'T', description: 'D', propertyType: 'SHOP', purpose: 'SALE', price: 1, area: 1, address: 'A' })
      .expect(201);
  });

  it('send returns the documented contract', async () => {
    const res = await http().post('/api/auth/otp/send').send({ phone: '+998901234567' }).expect(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { phone: '+998901234567', expiresIn: 120, retryAfter: 60 },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].message).toMatch(/\b\d{6}\b/);
  });

  it('verify returns tokens that work with the existing auth (me + refresh)', async () => {
    await http().post('/api/auth/otp/send').send({ phone: '+998901234567' }).expect(200);
    const res = await http()
      .post('/api/auth/otp/verify')
      .send({ phone: '+998901234567', code: lastCode() })
      .expect(200);
    const data = res.body.data;
    expect(Object.keys(data)).toEqual(expect.arrayContaining(['accessToken', 'refreshToken', 'user', 'isNewUser']));
    expect(data.isNewUser).toBe(true);
    expect(data.user.role).toBe(Role.USER);

    const me = await http().get('/api/auth/me').set(bearer(data.accessToken)).expect(200);
    expect(me.body.data.id).toBe(data.user.id);
    const refreshed = await http().post('/api/auth/refresh').send({ refreshToken: data.refreshToken }).expect(200);
    expect(refreshed.body.data.accessToken).toBeDefined();
  });

  it('user registered with password (other phone format) gets isNewUser=false and the same account', async () => {
    const reg = await http()
      .post('/api/auth/register')
      .send({ name: 'Vali', phone: '+998 90 123 45 67', password: 'Secret123!' })
      .expect(201);
    expect(reg.body.data.user.phone).toBe('+998901234567');

    await http().post('/api/auth/otp/send').send({ phone: '+998901234567' }).expect(200);
    const res = await http()
      .post('/api/auth/otp/verify')
      .send({ phone: '+998901234567', code: lastCode() })
      .expect(200);
    expect(res.body.data.isNewUser).toBe(false);
    expect(res.body.data.user.id).toBe(reg.body.data.user.id);
    expect(await prisma.user.count()).toBe(1);

    // Password login still works with any phone format
    await http().post('/api/auth/login').send({ phone: '901234567', password: 'Secret123!' }).expect(200);
  });

  it('wrong code returns 400 and does not log in; verify without send returns 400', async () => {
    await http().post('/api/auth/otp/verify').send({ phone: '+998901234567', code: '123456' }).expect(400);

    await http().post('/api/auth/otp/send').send({ phone: '+998901234567' }).expect(200);
    const wrong = lastCode() === '000000' ? '111111' : '000000';
    const res = await http().post('/api/auth/otp/verify').send({ phone: '+998901234567', code: wrong }).expect(400);
    expect(res.body).toMatchObject({ success: false, message: 'Invalid code. Attempts left: 4' });
    expect(res.body.data).toBeUndefined();
    expect(await prisma.user.count()).toBe(0);
  });

  it('existing user logs in, code works only once', async () => {
    await http().post('/api/auth/otp/send').send({ phone: '+998901112233' }).expect(200);
    const code = lastCode();
    const first = await http().post('/api/auth/otp/verify').send({ phone: '+998901112233', code }).expect(200);
    await http().post('/api/auth/otp/verify').send({ phone: '+998901112233', code }).expect(400);

    await prisma.otpCode.updateMany({ data: { createdAt: new Date(Date.now() - 120_000) } });
    await http().post('/api/auth/otp/send').send({ phone: '+998901112233' }).expect(200);
    const second = await http().post('/api/auth/otp/verify').send({ phone: '+998901112233', code: lastCode() }).expect(200);
    expect(second.body.data.isNewUser).toBe(false);
    expect(second.body.data.user.id).toBe(first.body.data.user.id);
  });

  it('resend cooldown, wrong-attempt limit, expiry', async () => {
    await http().post('/api/auth/otp/send').send({ phone: '+998901112233' }).expect(200);
    const cooldown = await http().post('/api/auth/otp/send').send({ phone: '+998901112233' }).expect(429);
    expect(cooldown.body.retryAfter).toBeGreaterThan(0);
    expect(cooldown.body.retryAfter).toBeLessThanOrEqual(60);
    expect(cooldown.headers['retry-after']).toBe(String(cooldown.body.retryAfter));

    const code = lastCode();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await http().post('/api/auth/otp/verify').send({ phone: '+998901112233', code: wrong }).expect(400);
    }
    // Locked even with the right code
    await http().post('/api/auth/otp/verify').send({ phone: '+998901112233', code }).expect(400);

    await prisma.otpCode.deleteMany();
    await http().post('/api/auth/otp/send').send({ phone: '+998901112233' }).expect(200);
    await prisma.otpCode.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await http().post('/api/auth/otp/verify').send({ phone: '+998901112233', code: lastCode() }).expect(400);
  });

  it('deactivated user cannot log in with OTP', async () => {
    await prisma.user.create({
      data: { name: 'X', phone: '+998901112233', password: 'x', isActive: false },
    });
    await http().post('/api/auth/otp/send').send({ phone: '+998901112233' }).expect(200);
    await http().post('/api/auth/otp/verify').send({ phone: '+998901112233', code: lastCode() }).expect(401);
  });

  it('rejects malformed input', async () => {
    await http().post('/api/auth/otp/send').send({ phone: 'abc' }).expect(400);
    await http().post('/api/auth/otp/verify').send({ phone: '+998901112233', code: '12' }).expect(400);
  });
});
