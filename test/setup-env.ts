// Runs before every e2e test file. E2E tests TRUNCATE tables, so they must never
// point at a real database: E2E_DATABASE_URL is required and its DB name must end in "_test".
const url = process.env.E2E_DATABASE_URL;
if (!url) {
  throw new Error(
    'E2E_DATABASE_URL is not set. Example: postgresql://test:test@127.0.0.1:55432/domera_test (see test/README.md)',
  );
}
const dbName = new URL(url).pathname.replace(/^\//, '');
if (!dbName.endsWith('_test')) {
  throw new Error(`Refusing to run e2e tests against database '${dbName}': name must end with "_test"`);
}

// process.env wins over .env in both @nestjs/config and Prisma
process.env.DATABASE_URL = url;
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'e2e_access_secret_not_for_production';
process.env.JWT_REFRESH_SECRET = 'e2e_refresh_secret_not_for_production';
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.AUTH_RATE_LIMIT = process.env.AUTH_RATE_LIMIT || '1000';
process.env.FIREBASE_SERVICE_ACCOUNT_PATH = '';
process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 = '';
process.env.OTP_DEV_MODE = 'true';
process.env.SMS_MODE = 'off';
// Pin values so a developer's .env cannot change test behaviour; tests never reach Eskiz
process.env.OTP_EXPIRY_MINUTES = '3';
process.env.OTP_MAX_ATTEMPTS = '5';
for (const k of ['ESKIZ_EMAIL', 'ESKIZ_PASSWORD']) process.env[k] = '';
process.env.ESKIZ_BASE_URL = 'http://127.0.0.1:9/eskiz-must-not-be-called';
for (const k of ['REVIEW_EMAIL', 'REVIEW_PHONE', 'REVIEW_PASSWORD', 'REVIEW_OTP_CODE']) process.env[k] = '';
