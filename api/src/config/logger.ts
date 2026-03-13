import pino from 'pino';

const isTest = process.env.NODE_ENV === 'test';
const isProd = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isTest ? 'silent' : 'info'),
  // Use pino-pretty for readable dev output; raw JSON in production
  transport: !isProd && !isTest
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});
