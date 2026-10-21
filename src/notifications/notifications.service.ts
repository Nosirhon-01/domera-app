import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DevicePlatform } from '@prisma/client';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service';

export interface PushPayload {
  title: string;
  body: string;
  /** Extra key/values delivered to the app (values must be strings for FCM) */
  data?: Record<string, string>;
}

// FCM errors that mean the token will never work again and should be removed
const INVALID_TOKEN_ERRORS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private messaging: admin.messaging.Messaging | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    const serviceAccount = this.loadServiceAccount();
    if (!serviceAccount) {
      this.logger.warn(
        'FCM is disabled: set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_BASE64 to enable push notifications',
      );
      return;
    }

    const app = admin.apps.length
      ? admin.app()
      : admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    this.messaging = app.messaging();
    this.logger.log(`FCM enabled for Firebase project '${serviceAccount.project_id}'`);
  }

  get isEnabled(): boolean {
    return this.messaging !== null;
  }

  /** Save the device's FCM token. If the token belonged to another user (re-login), it is moved to this user. */
  async registerDevice(userId: string, token: string, platform: DevicePlatform = DevicePlatform.ANDROID) {
    const device = await this.prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });

    return { message: 'Device registered', data: device };
  }

  async unregisterDevice(userId: string, token: string) {
    const result = await this.prisma.deviceToken.deleteMany({ where: { userId, token } });
    return { message: result.count ? 'Device unregistered' : 'Device was not registered' };
  }

  /**
   * Send a push notification to every device of the user.
   * Never throws — a failed push must not break the request that triggered it.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!this.messaging) return;

    try {
      const devices = await this.prisma.deviceToken.findMany({
        where: { userId },
        select: { token: true },
      });
      if (!devices.length) return;

      const tokens = devices.map((d) => d.token);
      const response = await this.messaging.sendEachForMulticast({
        tokens,
        notification: { title: payload.title, body: payload.body },
        data: payload.data,
        android: { priority: 'high', notification: { sound: 'default' } },
        apns: { payload: { aps: { sound: 'default' } } },
      });

      const invalidTokens = response.responses
        .map((r, i) => (!r.success && INVALID_TOKEN_ERRORS.has(r.error?.code ?? '') ? tokens[i] : null))
        .filter((t): t is string => t !== null);

      if (invalidTokens.length) {
        await this.prisma.deviceToken.deleteMany({ where: { token: { in: invalidTokens } } });
      }
    } catch (error) {
      this.logger.error(`Failed to send push to user '${userId}': ${(error as Error).message}`);
    }
  }

  async sendToUsers(userIds: string[], payload: PushPayload): Promise<void> {
    await Promise.all(userIds.map((id) => this.sendToUser(id, payload)));
  }

  private loadServiceAccount(): admin.ServiceAccount & { project_id?: string } | null {
    const filePath = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH');
    const base64 = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_BASE64');

    try {
      if (filePath) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
      if (base64) {
        return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
      }
    } catch (error) {
      this.logger.error(`Invalid Firebase service account: ${(error as Error).message}`);
    }
    return null;
  }
}
