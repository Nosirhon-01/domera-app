import 'reflect-metadata';
import { validate } from './env.validation';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
};

describe('env validation: OTP_DEV_MODE', () => {
  it('refuses to start in production with OTP_DEV_MODE=true', () => {
    expect(() => validate({ ...base, NODE_ENV: 'production', OTP_DEV_MODE: 'true' })).toThrow(/OTP_DEV_MODE=true is not allowed/);
  });

  it('allows production with OTP_DEV_MODE unset or false', () => {
    expect(() => validate({ ...base, NODE_ENV: 'production' })).not.toThrow();
    expect(() => validate({ ...base, NODE_ENV: 'production', OTP_DEV_MODE: 'false' })).not.toThrow();
  });

  it('allows OTP_DEV_MODE=true in development and test', () => {
    expect(validate({ ...base, NODE_ENV: 'development', OTP_DEV_MODE: 'true' }).OTP_DEV_MODE).toBe('true');
    expect(() => validate({ ...base, NODE_ENV: 'test', OTP_DEV_MODE: 'true' })).not.toThrow();
  });

  it('rejects values other than true/false', () => {
    expect(() => validate({ ...base, OTP_DEV_MODE: 'yes' })).toThrow(/OTP_DEV_MODE/);
  });
});
