import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ESKIZ_BASE_URL = 'https://notify.eskiz.uz/api';

/**
 * Sends SMS. Provider is chosen with SMS_PROVIDER:
 *  - "eskiz"   — Eskiz.uz (ESKIZ_EMAIL, ESKIZ_PASSWORD, optional ESKIZ_FROM)
 *  - "console" — prints the SMS to the log; refused when NODE_ENV=production
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private eskizToken: string | null = null;

  constructor(private readonly config: ConfigService) {}

  get provider(): string {
    const configured = this.config.get<string>('SMS_PROVIDER');
    if (configured) return configured.toLowerCase();
    return this.config.get<string>('NODE_ENV') === 'production' ? 'none' : 'console';
  }

  async send(phone: string, message: string): Promise<void> {
    switch (this.provider) {
      case 'eskiz':
        return this.sendEskiz(phone, message);
      case 'console':
        if (this.config.get<string>('NODE_ENV') === 'production') {
          this.logger.error('SMS_PROVIDER=console is not allowed in production');
          throw new ServiceUnavailableException('SMS service is not configured');
        }
        this.logger.warn(`[SMS to ${phone}] ${message}`);
        return;
      default:
        this.logger.error('SMS_PROVIDER is not set — cannot send OTP codes');
        throw new ServiceUnavailableException('SMS service is not configured');
    }
  }

  private async sendEskiz(phone: string, message: string, retried = false): Promise<void> {
    const token = await this.getEskizToken();
    const body = new FormData();
    body.append('mobile_phone', phone.replace(/^\+/, ''));
    body.append('message', message);
    body.append('from', this.config.get<string>('ESKIZ_FROM') || '4546');

    let res: Response;
    try {
      res = await fetch(`${ESKIZ_BASE_URL}/message/sms/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      this.logger.error(`Eskiz request failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Could not send SMS, try again later');
    }

    if (res.status === 401 && !retried) {
      this.eskizToken = null; // token expired (they live ~30 days) — log in again once
      return this.sendEskiz(phone, message, true);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Eskiz send failed: HTTP ${res.status} ${text.slice(0, 300)}`);
      throw new ServiceUnavailableException('Could not send SMS, try again later');
    }
  }

  private async getEskizToken(): Promise<string> {
    if (this.eskizToken) return this.eskizToken;

    const email = this.config.get<string>('ESKIZ_EMAIL');
    const password = this.config.get<string>('ESKIZ_PASSWORD');
    if (!email || !password) {
      this.logger.error('ESKIZ_EMAIL / ESKIZ_PASSWORD are not set');
      throw new ServiceUnavailableException('SMS service is not configured');
    }

    const body = new FormData();
    body.append('email', email);
    body.append('password', password);
    try {
      const res = await fetch(`${ESKIZ_BASE_URL}/auth/login`, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(10_000),
      });
      const json: any = await res.json().catch(() => ({}));
      const token = json?.data?.token;
      if (!res.ok || !token) {
        this.logger.error(`Eskiz login failed: HTTP ${res.status}`);
        throw new Error('login failed');
      }
      this.eskizToken = token;
      return token;
    } catch {
      throw new ServiceUnavailableException('Could not send SMS, try again later');
    }
  }
}
