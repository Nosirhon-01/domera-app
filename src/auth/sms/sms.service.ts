import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const DEFAULT_ESKIZ_BASE_URL = 'https://notify.eskiz.uz/api';
export const DEFAULT_OTP_TEMPLATE = 'DOMERA: tasdiqlash kodingiz {code}';
/** The only texts an Eskiz account in TEST MODE is allowed to send. */
export const ESKIZ_TEST_MESSAGES = ['This is test from Eskiz', 'Bu Eskiz dan test', 'Это тест от Eskiz'] as const;
const REQUEST_TIMEOUT_MS = 10_000;
/** Log in again this long before the token's own expiry. */
const TOKEN_REFRESH_MARGIN_MS = 60 * 60_000;

/** Eskiz delivers only to Uzbek mobile numbers. */
export const UZ_PHONE = /^\+998\d{9}$/;

export type SmsMode = 'off' | 'test' | 'live';
/** What the user's phone actually receives. */
export type SmsDelivery = 'sms' | 'test';

/**
 * Eskiz.uz SMS gateway. SMS_MODE selects behaviour:
 *  - off  (default) — nothing is sent
 *  - test — Eskiz account in test mode: sends only a permitted Eskiz test text (ESKIZ_TEST_MESSAGE), NEVER the code
 *  - live — sends OTP_MESSAGE_TEMPLATE with the code (the template must be approved in the Eskiz cabinet)
 *
 * HTTP errors: 400 not a +998 number · 502 Eskiz rejected the SMS · 503 not configured / Eskiz unreachable or login failed.
 * Credentials, tokens, SMS texts and codes are never written to the log.
 */
@Injectable()
export class SmsService implements OnModuleInit {
  private readonly logger = new Logger(SmsService.name);
  private token: { value: string; expiresAt: number } | null = null;
  private tokenRequest: Promise<string> | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    for (const problem of this.configProblems()) {
      this.logger.error(problem);
    }
    if (this.mode === 'test') {
      this.logger.warn('SMS_MODE=test: Eskiz sends only its test text; registration codes are NOT delivered by SMS');
    }
  }

  get mode(): SmsMode {
    const value = (this.config.get<string>('SMS_MODE') || 'off').trim().toLowerCase();
    return value === 'test' || value === 'live' ? value : 'off';
  }

  /** Human-readable config problems (no secret values). Empty when the configured mode can work. */
  configProblems(): string[] {
    const problems: string[] = [];
    if (this.mode === 'off') return problems;
    if (!this.config.get<string>('ESKIZ_EMAIL')) problems.push(`SMS_MODE=${this.mode} but ESKIZ_EMAIL is not set`);
    if (!this.config.get<string>('ESKIZ_PASSWORD')) problems.push(`SMS_MODE=${this.mode} but ESKIZ_PASSWORD is not set`);
    if (this.mode === 'live' && !this.template.includes('{code}')) {
      problems.push('OTP_MESSAGE_TEMPLATE must contain {code} — OTP SMS are disabled until it does');
    }
    if (this.mode === 'test' && !(ESKIZ_TEST_MESSAGES as readonly string[]).includes(this.testMessage)) {
      problems.push(`ESKIZ_TEST_MESSAGE must be one of: ${ESKIZ_TEST_MESSAGES.join(' | ')}`);
    }
    return problems;
  }

  /**
   * Sends the registration code. In test mode the Eskiz test text is sent instead (it does not contain the code).
   * Throws (400/502/503) when nothing was delivered.
   */
  async sendOtp(phone: string, code: string): Promise<SmsDelivery> {
    switch (this.mode) {
      case 'live':
        await this.send(phone, this.otpMessage(code));
        return 'sms';
      case 'test':
        if (!(ESKIZ_TEST_MESSAGES as readonly string[]).includes(this.testMessage)) {
          this.logger.error('ESKIZ_TEST_MESSAGE is not an allowed Eskiz test text');
          throw new ServiceUnavailableException('SMS service is not configured');
        }
        await this.send(phone, this.testMessage);
        return 'test';
      default:
        throw new ServiceUnavailableException('SMS service is not configured');
    }
  }

  /** OTP text: the template with every {code} replaced. */
  otpMessage(code: string): string {
    if (!this.template.includes('{code}')) {
      this.logger.error('OTP_MESSAGE_TEMPLATE must contain {code}');
      throw new ServiceUnavailableException('SMS service is not configured');
    }
    return this.template.split('{code}').join(code);
  }

  /** Low-level send of an exact text. */
  async send(phone: string, message: string): Promise<void> {
    if (this.mode === 'off') {
      throw new ServiceUnavailableException('SMS service is not configured');
    }
    if (!UZ_PHONE.test(phone)) {
      throw new BadRequestException('SMS codes can only be sent to Uzbekistan numbers (+998XXXXXXXXX)');
    }
    return this.sendEskiz(phone, message);
  }

  /** Logs in to Eskiz (fresh token). Throws like send(). Used by scripts/sms-check.ts. */
  async checkCredentials(): Promise<void> {
    this.token = null;
    await this.getToken();
  }

  get testMessage(): string {
    return (this.config.get<string>('ESKIZ_TEST_MESSAGE') || ESKIZ_TEST_MESSAGES[0]).trim();
  }

  private get template(): string {
    return this.config.get<string>('OTP_MESSAGE_TEMPLATE') || DEFAULT_OTP_TEMPLATE;
  }

  private get baseUrl(): string {
    return (this.config.get<string>('ESKIZ_BASE_URL') || DEFAULT_ESKIZ_BASE_URL).replace(/\/+$/, '');
  }

  private async sendEskiz(phone: string, message: string, retried = false): Promise<void> {
    const token = await this.getToken();
    const body = new FormData();
    body.append('mobile_phone', phone.slice(1)); // 998901234567
    body.append('message', message);
    body.append('from', this.config.get<string>('ESKIZ_FROM') || '4546');

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/message/sms/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      this.logger.error(`Eskiz send: request failed (${(e as Error).name})`);
      throw new ServiceUnavailableException('SMS service is temporarily unavailable, try again later');
    }

    const json: any = await res.json().catch(() => null);

    if (res.status === 401 && !retried) {
      // Token expired or revoked: log in again once
      this.token = null;
      return this.sendEskiz(phone, message, true);
    }
    if (res.status >= 500 || res.status === 401) {
      this.logger.error(`Eskiz send: HTTP ${res.status} ${this.describe(json)}`);
      throw new ServiceUnavailableException('SMS service is temporarily unavailable, try again later');
    }
    // Eskiz reports problems with 4xx, and occasionally with HTTP 200 + status "error"
    if (!res.ok || json?.status === 'error') {
      this.logger.error(`Eskiz rejected SMS: HTTP ${res.status} ${this.describe(json)}`);
      throw new BadGatewayException('SMS could not be sent, try again later');
    }
    this.logger.log(`Eskiz accepted SMS id=${json?.id ?? '?'} status=${json?.status ?? '?'}`);
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return this.token.value;
    }
    // Parallel requests share one login instead of each logging in
    this.tokenRequest ??= this.login().finally(() => {
      this.tokenRequest = null;
    });
    return this.tokenRequest;
  }

  private async login(): Promise<string> {
    const email = this.config.get<string>('ESKIZ_EMAIL');
    const password = this.config.get<string>('ESKIZ_PASSWORD');
    if (!email || !password) {
      this.logger.error('ESKIZ_EMAIL / ESKIZ_PASSWORD are not set');
      throw new ServiceUnavailableException('SMS service is not configured');
    }

    const body = new FormData();
    body.append('email', email);
    body.append('password', password);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/auth/login`, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      this.logger.error(`Eskiz login: request failed (${(e as Error).name})`);
      throw new ServiceUnavailableException('SMS service is temporarily unavailable, try again later');
    }

    const json: any = await res.json().catch(() => null);
    const token = json?.data?.token;
    if (!res.ok || typeof token !== 'string' || !token) {
      // 401 here means wrong ESKIZ_EMAIL / ESKIZ_PASSWORD
      this.logger.error(`Eskiz login failed: HTTP ${res.status} ${this.describe(json)}`);
      throw new ServiceUnavailableException('SMS service is temporarily unavailable, try again later');
    }
    this.token = { value: token, expiresAt: this.tokenExpiry(token) };
    return token;
  }

  /** Expiry from the JWT "exp" claim; Eskiz tokens live ~30 days. Falls back to 29 days. */
  private tokenExpiry(token: string): number {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      if (typeof payload?.exp === 'number') return payload.exp * 1000;
    } catch {
      // not a JWT: use the fallback
    }
    return Date.now() + 29 * 24 * 3600_000;
  }

  /** Eskiz error text for the log, without tokens. */
  private describe(json: any): string {
    if (!json || typeof json !== 'object') return '';
    const text = typeof json.message === 'string' ? json.message : JSON.stringify(json.message ?? json.errors ?? '');
    return text.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]').slice(0, 300);
  }
}
