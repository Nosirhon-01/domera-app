import { plainToInstance } from 'class-transformer';
import { IsEnum, IsIn, IsNumber, IsOptional, IsString, validateSync } from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  @IsOptional()
  PORT: number = 3000;

  @IsString()
  @IsOptional()
  API_PREFIX: string = 'api';

  @IsString()
  DATABASE_URL: string;

  @IsString()
  JWT_ACCESS_SECRET: string;

  @IsString()
  JWT_REFRESH_SECRET: string;

  @IsString()
  @IsOptional()
  JWT_ACCESS_EXPIRES_IN: string = '15m';

  @IsString()
  @IsOptional()
  JWT_REFRESH_EXPIRES_IN: string = '7d';

  @IsString()
  @IsOptional()
  ADMIN_EMAIL: string = 'admin@domera.com';

  @IsString()
  @IsOptional()
  ADMIN_PASSWORD: string = 'AdminPassword123!';

  @IsString()
  @IsOptional()
  CORS_ORIGINS: string = 'http://localhost:3000';

  // Firebase Cloud Messaging — one of these enables push notifications
  @IsString()
  @IsOptional()
  FIREBASE_SERVICE_ACCOUNT_PATH?: string;

  @IsString()
  @IsOptional()
  FIREBASE_SERVICE_ACCOUNT_BASE64?: string;

  // Phone registration: "true" returns the OTP code in API responses. Refused in production.
  @IsIn(['true', 'false'])
  @IsOptional()
  OTP_DEV_MODE?: string;

  // App Store / Play review account
  @IsString()
  @IsOptional()
  REVIEW_NAME?: string;

  @IsString()
  @IsOptional()
  REVIEW_EMAIL?: string;

  @IsString()
  @IsOptional()
  REVIEW_PHONE?: string;

  @IsString()
  @IsOptional()
  REVIEW_PASSWORD?: string;


  @IsString()
  @IsOptional()
  HOST?: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(`Environment validation error: ${errors.toString()}`);
  }

  if (validatedConfig.NODE_ENV === Environment.Production && validatedConfig.OTP_DEV_MODE === 'true') {
    throw new Error(
      'OTP_DEV_MODE=true is not allowed with NODE_ENV=production: it would return registration codes in API responses',
    );
  }

  // Warn (do not fail — that would take production down) about weak JWT secrets
  if (validatedConfig.NODE_ENV === Environment.Production) {
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      const value = validatedConfig[key];
      if (value.length < 32 || value.includes('change_in_prod')) {
        console.warn(`[SECURITY WARNING] ${key} is weak or a placeholder. Set a random value of 32+ characters.`);
      }
    }
  }
  return validatedConfig;
}
