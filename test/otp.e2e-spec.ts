import { INestApplication } from '@nestjs/common';
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
    await http().post('/api/auth/otp/send').send({ phone: '+998901112233' }).expect(429);

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
