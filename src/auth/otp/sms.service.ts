import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const ESKIZ_BASE_URL = 'https://notify.eskiz.uz/api';
export const DEFAULT_OTP_TEMPLATE = 'DOMERA: tasdiqlash kodingiz {code}';
const REQUEST_TIMEOUT_MS = 10_000;

/** Eskiz delivers only to Uzbek mobile numbers. */
const UZ_PHONE = /^\+998\d{9}$/;

/**
 * Sends SMS. Provider is chosen with SMS_PROVIDER:
 *  - "eskiz"   — Eskiz.uz (ESKIZ_EMAIL, ESKIZ_PASSWORD, optional ESKIZ_FROM)
 *  - "console" — prints the SMS to the log; refused when NODE_ENV=production
 *
 * HTTP errors returned to the client:
 *  - 400 the number cannot receive SMS from this provider (not +998)
 *  - 502 Eskiz rejected the message (template not approved, no balance, invalid number, ...)
 *  - 503 SMS is not configured, or Eskiz is unreachable / cannot authenticate
 * Credentials, tokens and OTP codes are never written to the log.
 */
@Injectable()
export class SmsService implements OnModuleInit {
  private readonly logger = new Logger(SmsService.name);
  private eskizToken: string | null = null;
  private tokenRequest: Promise<string> | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    for (const problem of this.configProblems()) {
      this.logger.error(problem);
    }
  }

  get provider(): string {
    const configured = this.config.get<string>('SMS_PROVIDER')?.trim();
    if (configured) return configured.toLowerCase();
    return this.isProduction ? 'none' : 'console';
  }

  /** Human-readable config problems (no secret values). Empty when SMS can work. */
  configProblems(): string[] {
    const problems: string[] = [];
    const template = this.template;
    if (!template.includes('{code}')) {
      problems.push('OTP_MESSAGE_TEMPLATE must contain {code} — OTP SMS are disabled until it does');
    }
    switch (this.provider) {
      case 'eskiz':
        if (!this.config.get<string>('ESKIZ_EMAIL')) problems.push('SMS_PROVIDER=eskiz but ESKIZ_EMAIL is not set');
        if (!this.config.get<string>('ESKIZ_PASSWORD')) problems.push('SMS_PROVIDER=eskiz but ESKIZ_PASSWORD is not set');
        break;
      case 'console':
        if (this.isProduction) problems.push('SMS_PROVIDER=console is not allowed in production — OTP SMS are disabled');
        break;
      case 'none':
        problems.push('SMS_PROVIDER is not set — OTP SMS are disabled (set SMS_PROVIDER=eskiz)');
        break;
      default:
        problems.push(`Unknown SMS_PROVIDER "${this.provider}" — use "eskiz" or "console"`);
    }
    return problems;
  }

  /** OTP text: the template with {code} replaced (every occurrence). */
  otpMessage(code: string): string {
    if (!this.template.includes('{code}')) {
      this.logger.error('OTP_MESSAGE_TEMPLATE must contain {code}');
      throw new ServiceUnavailableException('SMS service is not configured');
    }
    return this.template.split('{code}').join(code);
  }

  async send(phone: string, message: string): Promise<void> {
    switch (this.provider) {
      case 'eskiz':
        if (!UZ_PHONE.test(phone)) {
          throw new BadRequestException('SMS codes can only be sent to Uzbekistan numbers (+998XXXXXXXXX)');
        }
        return this.sendEskiz(phone, message);
      case 'console':
        if (this.isProduction) {
          this.logger.error('SMS_PROVIDER=console is not allowed in production');
          throw new ServiceUnavailableException('SMS service is not configured');
        }
        this.logger.warn(`[SMS to ${phone}] ${message}`);
        return;
      default:
        this.logger.error(`SMS not sent: SMS_PROVIDER is "${this.provider}"`);
        throw new ServiceUnavailableException('SMS service is not configured');
    }
  }

  /** Logs in to Eskiz and returns nothing; throws like send() does. Used by scripts/eskiz-check.ts. */
  async checkEskizCredentials(): Promise<void> {
    this.eskizToken = null;
    await this.getEskizToken();
  }

  private get isProduction() {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  private get template(): string {
    return this.config.get<string>('OTP_MESSAGE_TEMPLATE') || DEFAULT_OTP_TEMPLATE;
  }

  private async sendEskiz(phone: string, message: string, retried = false): Promise<void> {
    const token = await this.getEskizToken();
    const body = new FormData();
    body.append('mobile_phone', phone.slice(1)); // 998901234567
    body.append('message', message);
    body.append('from', this.config.get<string>('ESKIZ_FROM') || '4546');

    let res: Response;
    try {
      res = await fetch(`${ESKIZ_BASE_URL}/message/sms/send`, {
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
      // Token expired (they live ~30 days): log in again once
      this.eskizToken = null;
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

  private async getEskizToken(): Promise<string> {
    if (this.eskizToken) return this.eskizToken;
    // Parallel OTP requests share one login instead of each logging in
    this.tokenRequest ??= this.loginEskiz().finally(() => {
      this.tokenRequest = null;
    });
    return this.tokenRequest;
  }

  private async loginEskiz(): Promise<string> {
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
      res = await fetch(`${ESKIZ_BASE_URL}/auth/login`, {
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
    this.eskizToken = token;
    return token;
  }

  /** Eskiz error text for the log, without tokens. */
  private describe(json: any): string {
    if (!json || typeof json !== 'object') return '';
    const text = typeof json.message === 'string' ? json.message : JSON.stringify(json.message ?? json.errors ?? '');
    return text.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]').slice(0, 300);
  }
}
