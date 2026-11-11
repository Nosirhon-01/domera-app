import { BadGatewayException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_ESKIZ_BASE_URL, SmsService } from './sms.service';

// Fake Eskiz JWT (header.payload.signature) with exp far in the future
const jwtWith = (exp: number) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: '1', exp })).toString('base64url')}.c2lnbmF0dXJl`;
const TOKEN = jwtWith(Math.floor(Date.now() / 1000) + 30 * 86400);
const json = (status: number, body: unknown) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;

const ENV_KEYS = [
  'NODE_ENV', 'SMS_MODE', 'ESKIZ_EMAIL', 'ESKIZ_PASSWORD', 'ESKIZ_FROM', 'ESKIZ_BASE_URL',
  'ESKIZ_TEST_MESSAGE', 'OTP_MESSAGE_TEMPLATE',
];
const make = (env: Record<string, string | undefined>) => new SmsService(new ConfigService(env));
const live = { SMS_MODE: 'live', ESKIZ_EMAIL: 'owner@example.com', ESKIZ_PASSWORD: 'not-a-real-secret' };
const test = { ...live, SMS_MODE: 'test' };

describe('SmsService (Eskiz)', () => {
  let fetchMock: jest.Mock;
  let logs: string[];
  const savedEnv = { ...process.env };

  // ConfigService reads process.env before its own values: clear them for these tests
  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
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
  const calls = (suffix: string) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(suffix));
  const loginOk = () => json(200, { message: 'token_generated', data: { token: TOKEN } });
  const sendOk = () => json(200, { id: 'abc', message: 'Waiting for SMS provider', status: 'waiting' });

  it('live: logs in once, posts multipart 998XXXXXXXXX + OTP text + sender, reuses the token', async () => {
    const sms = capture(make({ ...live, ESKIZ_FROM: '4546' }));
    fetchMock.mockResolvedValueOnce(loginOk()).mockResolvedValue(sendOk());

    expect(await sms.sendOtp('+998901234567', '123456')).toBe('sms');
    await sms.sendOtp('+998901234567', '654321');

    expect(calls('/auth/login')).toHaveLength(1);
    expect(calls('/auth/login')[0][0]).toBe(`${DEFAULT_ESKIZ_BASE_URL}/auth/login`);
    const loginForm = calls('/auth/login')[0][1].body as FormData;
    expect(loginForm.get('email')).toBe('owner@example.com');

    const [url, init] = calls('/message/sms/send')[0];
    expect(url).toBe(`${DEFAULT_ESKIZ_BASE_URL}/message/sms/send`);
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    const form = init.body as FormData;
    expect(form.get('mobile_phone')).toBe('998901234567');
    expect(form.get('message')).toBe('DOMERA: tasdiqlash kodingiz 123456');
    expect(form.get('from')).toBe('4546');
    expect(form.get('callback_url')).toBeNull();
  });

  it('uses ESKIZ_BASE_URL', async () => {
    const sms = capture(make({ ...live, ESKIZ_BASE_URL: 'https://eskiz.example/api/' }));
    fetchMock.mockResolvedValueOnce(loginOk()).mockResolvedValue(sendOk());
    await sms.sendOtp('+998901234567', '123456');
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual([
      'https://eskiz.example/api/auth/login',
      'https://eskiz.example/api/message/sms/send',
    ]);
  });

  it('test mode: sends only the permitted Eskiz test text, never the code', async () => {
    const sms = capture(make(test));
    fetchMock.mockResolvedValueOnce(loginOk()).mockResolvedValue(sendOk());
    expect(await sms.sendOtp('+998901234567', '482915')).toBe('test');
    const form = calls('/message/sms/send')[0][1].body as FormData;
    expect(form.get('message')).toBe('This is test from Eskiz');
    expect(String(form.get('message'))).not.toContain('482915');

    const uz = capture(make({ ...test, ESKIZ_TEST_MESSAGE: 'Bu Eskiz dan test' }));
    fetchMock.mockResolvedValueOnce(loginOk()).mockResolvedValue(sendOk());
    await uz.sendOtp('+998901234567', '111111');
    expect((calls('/message/sms/send')[1][1].body as FormData).get('message')).toBe('Bu Eskiz dan test');
  });

  it('test mode refuses a custom text without calling Eskiz', async () => {
    const sms = capture(make({ ...test, ESKIZ_TEST_MESSAGE: 'DOMERA kod 123456' }));
    await expect(sms.sendOtp('+998901234567', '123456')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(sms.configProblems()).toEqual([expect.stringContaining('ESKIZ_TEST_MESSAGE')]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parallel sends share one login', async () => {
    const sms = capture(make(live));
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/auth/login') ? loginOk() : sendOk()));
    await Promise.all([1, 2, 3].map(() => sms.sendOtp('+998901234567', '123456')));
    expect(calls('/auth/login')).toHaveLength(1);
  });

  it('re-logs in once when the token was rejected (401)', async () => {
    const sms = capture(make(live));
    fetchMock
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(json(401, { message: 'Expired' }))
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(sendOk());
    await sms.sendOtp('+998901234567', '123456');
    expect(calls('/auth/login')).toHaveLength(2);
    expect(calls('/message/sms/send')).toHaveLength(2);
  });

  it('logs in again before the token expires (exp claim)', async () => {
    const sms = capture(make(live));
    const soon = jwtWith(Math.floor(Date.now() / 1000) + 600); // expires in 10 min (< 1 h margin)
    fetchMock
      .mockResolvedValueOnce(json(200, { data: { token: soon } }))
      .mockResolvedValueOnce(sendOk())
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(sendOk());
    await sms.sendOtp('+998901234567', '123456');
    await sms.sendOtp('+998901234567', '123456');
    expect(calls('/auth/login')).toHaveLength(2);
  });

  it('Eskiz authentication failure (wrong credentials) → 503, nothing sent', async () => {
    const sms = capture(make(live));
    fetchMock.mockResolvedValueOnce(json(401, { message: 'Invalid credentials' }));
    await expect(sms.sendOtp('+998901234567', '123456')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(calls('/message/sms/send')).toHaveLength(0);
    expect(logs.join('\n')).toContain('Eskiz login failed: HTTP 401');

    fetchMock.mockResolvedValueOnce(json(200, { message: 'ok', data: {} })); // no token in body
    await expect(sms.checkCredentials()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('SMS sending failure: Eskiz rejection (4xx or status=error) → 502', async () => {
    const sms = capture(make(live));
    fetchMock
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(json(400, { message: 'Template not approved', status: 'error' }));
    await expect(sms.sendOtp('+998901234567', '123456')).rejects.toBeInstanceOf(BadGatewayException);

    fetchMock.mockResolvedValueOnce(json(200, { status: 'error', message: 'Insufficient balance' }));
    await expect(sms.sendOtp('+998901234567', '123456')).rejects.toBeInstanceOf(BadGatewayException);
    expect(logs.join('\n')).toContain('Template not approved');
  });

  it('SMS sending failure: Eskiz down or timeout → 503', async () => {
    const sms = capture(make(live));
    fetchMock.mockResolvedValueOnce(loginOk()).mockResolvedValueOnce(json(500, {}));
    await expect(sms.sendOtp('+998901234567', '123456')).rejects.toBeInstanceOf(ServiceUnavailableException);

    fetchMock.mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    await expect(sms.sendOtp('+998901234567', '123456')).rejects.toBeInstanceOf(ServiceUnavailableException);

    const down = capture(make(live));
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('ECONNREFUSED'), { name: 'TypeError' }));
    await expect(down.sendOtp('+998901234567', '123456')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('off mode or missing credentials → 503 without calling Eskiz', async () => {
    for (const env of [{}, { SMS_MODE: 'off' }, { SMS_MODE: 'live' }, { SMS_MODE: 'test', ESKIZ_EMAIL: 'a@b.c' }]) {
      const sms = capture(make(env));
      await expect(sms.sendOtp('+998901234567', '123456')).rejects.toBeInstanceOf(ServiceUnavailableException);
    }
    expect(make({ SMS_MODE: 'live' }).configProblems()).toHaveLength(2);
    expect(make({}).configProblems()).toEqual([]);
    expect(make({}).mode).toBe('off');
    expect(make({ SMS_MODE: 'LIVE' }).mode).toBe('live');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('invalid / non-Uzbek number → 400 without calling Eskiz', async () => {
    const sms = capture(make(live));
    for (const phone of ['+77011234567', '+99890123456', '998901234567']) {
      await expect(sms.sendOtp(phone, '123456')).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('template: replaces every {code}; refuses a template without {code}', () => {
    expect(make(live).otpMessage('123456')).toBe('DOMERA: tasdiqlash kodingiz 123456');
    expect(make({ ...live, OTP_MESSAGE_TEMPLATE: 'Kod: {code}. Hech kimga aytmang: {code}' }).otpMessage('111222')).toBe(
      'Kod: 111222. Hech kimga aytmang: 111222',
    );
    const broken = capture(make({ ...live, OTP_MESSAGE_TEMPLATE: 'DOMERA kod' }));
    expect(() => broken.otpMessage('123456')).toThrow(ServiceUnavailableException);
    expect(broken.configProblems()).toEqual([expect.stringContaining('{code}')]);
    expect(make(live).configProblems()).toEqual([]);
    expect(make(test).configProblems()).toEqual([]);
  });

  it('never logs credentials, tokens, SMS text or the code', async () => {
    const sms = capture(make(live));
    fetchMock
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(json(422, { message: `bad request for token ${TOKEN}` }));
    await expect(sms.sendOtp('+998901234567', '987654')).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(sendOk());
    await sms.sendOtp('+998901234567', '135790');
    sms.onModuleInit();
    const all = logs.join('\n');
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain('not-a-real-secret');
    expect(all).not.toContain('owner@example.com');
    expect(all).not.toContain('987654');
    expect(all).not.toContain('135790');
    expect(all).not.toContain('tasdiqlash');
  });
});
