import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export const config = {
  port: parseInt(optional('PORT', '3000'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),
  logLevel: optional('LOG_LEVEL', 'info'),

  publicBaseUrl: required('PUBLIC_BASE_URL'),

  moysklad: {
    appId: required('MOYSKLAD_APP_ID'),
    appUid: required('MOYSKLAD_APP_UID'),
    secretKey: required('MOYSKLAD_SECRET_KEY'),
    vendorApiBase: optional(
      'MOYSKLAD_VENDOR_API_BASE',
      'https://apps-api.moysklad.ru/api/vendor/1.0'
    ),
    jsonApiBase: optional(
      'MOYSKLAD_JSON_API_BASE',
      'https://api.moysklad.ru/api/remap/1.2'
    ),
  },

  jwt: {
    lifetimeSeconds: parseInt(optional('JWT_LIFETIME_SECONDS', '60'), 10),
  },
} as const;

export type AppConfig = typeof config;
