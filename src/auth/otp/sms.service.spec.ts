import { BadGatewayException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ESKIZ_BASE_URL, SmsService } from './sms.service';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
const json = (status: number, body: unknown) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;

const make = (env: Record<string, string | undefined>) =>
  new SmsService(new ConfigService({ NODE_ENV: 'production', ...env }));

const eskizEnv = { SMS_PROVIDER: 'eskiz', ESKIZ_EMAIL: 'owner@example.com', ESKIZ_PASSWORD: 'not-a-real-secret' };

describe('SmsService', () => {
  let fetchMock: jest.Mock;
  let logs: string[];

  // ConfigService reads process.env before its own values: pin the env for these tests
  const savedEnv = { ...process.env };
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    for (const k of ['SMS_PROVIDER', 'ESKIZ_EMAIL', 'ESKIZ_PASSWORD', 'ESKIZ_FROM', 'OTP_MESSAGE_TEMPLATE']) {
      delete process.env[k];
    }
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
    logs = [];
  });
  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...savedEnv };
  });

  const capture = (sms: SmsService) => {
    const logger = (sms as any).logger;
    for (const level of ['log', 'warn', 'error']) {
      jest.spyOn(logger, level).mockImplementation((m: unknown) => {
        logs.push(String(m));
      });
    }
    return sms;
  };
  const sendCalls = () => fetchMock.mock.calls.filter(([url]) => url === `${ESKIZ_BASE_URL}/message/sms/send`);

  it('logs in once, sends 998XXXXXXXXX with the sender, reuses the token', async () => {
    const sms = capture(make({ ...eskizEnv, ESKIZ_FROM: '4546' }));
    fetchMock
      .mockResolvedValueOnce(json(200, { message: 'token_generated', data: { token: TOKEN } }))
      .mockResolvedValue(json(200, { id: 'abc', message: 'Waiting for SMS provider', status: 'waiting' }));

    await sms.send('+998901234567', 'DOMERA: tasdiqlash kodingiz 123456');
    await sms.send('+998901234567', 'DOMERA: tasdiqlash kodingiz 654321');

    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 login + 2 sends
    const [, init] = sendCalls()[0];
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    const form = init.body as FormData;
    expect(form.get('mobile_phone')).toBe('998901234567');
    expect(form.get('message')).toBe('DOMERA: tasdiqlash kodingiz 123456');
    expect(form.get('from')).toBe('4546');
  });

  it('parallel sends share one login', async () => {
    const sms = capture(make(eskizEnv));
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/auth/login') ? json(200, { data: { token: TOKEN } }) : json(200, { status: 'waiting' }),
    );
    await Promise.all([1, 2, 3].map(() => sms.send('+998901234567', 'x')));
    expect(fetchMock.mock.calls.filter(([u]) => u.endsWith('/auth/login'))).toHaveLength(1);
  });

  it('re-logs in once when the token expired (401)', async () => {
    const sms = capture(make(eskizEnv));
    fetchMock
      .mockResolvedValueOnce(json(200, { data: { token: TOKEN } }))
      .mockResolvedValueOnce(json(401, { message: 'Expired' }))
      .mockResolvedValueOnce(json(200, { data: { token: TOKEN } }))
      .mockResolvedValueOnce(json(200, { status: 'waiting' }));
    await sms.send('+998901234567', 'x');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('Eskiz rejection (4xx or status=error) → 502', async () => {
    const sms = capture(make(eskizEnv));
    fetchMock
      .mockResolvedValueOnce(json(200, { data: { token: TOKEN } }))
      .mockResolvedValueOnce(json(400, { message: 'Template not approved', status: 'error' }));
    await expect(sms.send('+998901234567', 'x')).rejects.toBeInstanceOf(BadGatewayException);

    fetchMock.mockResolvedValueOnce(json(200, { status: 'error', message: 'Insufficient balance' }));
    await expect(sms.send('+998901234567', 'x')).rejects.toBeInstanceOf(BadGatewayException);
    expect(logs.join('\n')).toContain('Template not approved');
  });

  it('Eskiz down, timeout or wrong credentials → 503', async () => {
    const sms = capture(make(eskizEnv));
    fetchMock.mockResolvedValueOnce(json(200, { data: { token: TOKEN } })).mockResolvedValueOnce(json(500, {}));
    await expect(sms.send('+998901234567', 'x')).rejects.toBeInstanceOf(ServiceUnavailableException);

    fetchMock.mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    await expect(sms.send('+998901234567', 'x')).rejects.toBeInstanceOf(ServiceUnavailableException);

    const wrong = capture(make(eskizEnv));
    fetchMock.mockResolvedValueOnce(json(401, { message: 'Invalid credentials' }));
    await expect(wrong.send('+998901234567', 'x')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('missing credentials or provider → 503 without calling Eskiz', async () => {
    for (const env of [{ SMS_PROVIDER: 'eskiz' }, {}, { SMS_PROVIDER: 'console' }, { SMS_PROVIDER: 'twilio' }]) {
      const sms = capture(make(env));
      await expect(sms.send('+998901234567', 'x')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(sms.configProblems().length).toBeGreaterThan(0);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('non-Uzbek number → 400 without calling Eskiz', async () => {
    const sms = capture(make(eskizEnv));
    await expect(sms.send('+77011234567', 'x')).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('template: replaces every {code}; refuses a template without {code}', () => {
    expect(make(eskizEnv).otpMessage('123456')).toBe('DOMERA: tasdiqlash kodingiz 123456');
    expect(make({ ...eskizEnv, OTP_MESSAGE_TEMPLATE: 'Kod: {code}. Hech kimga aytmang: {code}' }).otpMessage('111222')).toBe(
      'Kod: 111222. Hech kimga aytmang: 111222',
    );
    const broken = capture(make({ ...eskizEnv, OTP_MESSAGE_TEMPLATE: 'DOMERA kod' }));
    expect(() => broken.otpMessage('123456')).toThrow(ServiceUnavailableException);
    expect(broken.configProblems()).toEqual([expect.stringContaining('{code}')]);
  });

  it('valid eskiz config has no problems', () => {
    expect(make(eskizEnv).configProblems()).toEqual([]);
  });

  it('never logs credentials, tokens or the SMS text', async () => {
    const sms = capture(make(eskizEnv));
    fetchMock
      .mockResolvedValueOnce(json(200, { data: { token: TOKEN } }))
      .mockResolvedValueOnce(json(422, { message: `bad request for token ${TOKEN}` }));
    await expect(sms.send('+998901234567', 'DOMERA: tasdiqlash kodingiz 987654')).rejects.toThrow();
    sms.onModuleInit();
    const all = logs.join('\n');
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain('not-a-real-secret');
    expect(all).not.toContain('owner@example.com');
    expect(all).not.toContain('987654');
  });
});
