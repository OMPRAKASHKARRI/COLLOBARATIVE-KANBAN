require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

function secret(name, devDefault) {
  const v = process.env[name];
  if (v) return v;
  if (isProd) throw new Error(`${name} must be set in production`);
  return devDefault; // development/test only; never used in production
}

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  isProd,
  isTest,
  PORT: Number(process.env.PORT || 5000),
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_ACCESS_SECRET: secret('JWT_ACCESS_SECRET', 'dev-only-access-secret-change-me'),
  JWT_REFRESH_SECRET: secret('JWT_REFRESH_SECRET', 'dev-only-refresh-secret-change-me'),
  ACCESS_TTL: process.env.ACCESS_TOKEN_TTL || '15m',
  REFRESH_TTL: process.env.REFRESH_TOKEN_TTL || '7d',
  CLIENT_ORIGIN: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(','),
  COOKIE_SECURE: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
  COOKIE_SAMESITE: process.env.COOKIE_SAMESITE || 'strict',
  RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED ? process.env.RATE_LIMIT_ENABLED === 'true' : !isTest,
};
