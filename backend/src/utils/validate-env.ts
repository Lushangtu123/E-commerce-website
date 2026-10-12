import Joi from 'joi';
import logger from './logger';
import { DEV_JWT_SECRET } from './jwt-secret';
import { passwordMailConfig } from '../services/password-mail.service';

/** 已知的弱密钥默认值，生产环境禁止使用 */
const WEAK_SECRETS = new Set([
  DEV_JWT_SECRET,
  'your-secret-key',
  'your-super-secret-jwt-key-change-in-production',
  'your_production_jwt_secret_key',
  'your_super_secret_jwt_key_change_this_in_production',
  'your-admin-secret-key',
]);

/**
 * 解析 CORS 允许的来源列表（支持逗号分隔多个域名）
 * @returns 来源数组；未配置或含 `*` 时返回 true（放行所有来源，但不带 Cookie）
 */
export function getCorsOrigins(): string[] | true {
  const origins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return origins.length > 0 && !origins.includes('*') ? origins : true;
}

/**
 * CORS 配置。会话 Cookie 只允许发给明确列出的来源：未配置 CORS_ORIGIN 时（仅开发环境）
 * 放行所有来源，但不带凭据，否则任何网站都能以访客身份调用接口。
 */
export function corsOptions(): { origin: string[] | true; credentials: boolean; exposedHeaders: string[] } {
  const origin = getCorsOrigins();
  // 前端报错时可以读取请求 ID，方便按 ID 查日志
  return { origin, credentials: origin !== true, exposedHeaders: ['X-Request-Id'] };
}

const port = Joi.number().integer().min(1).max(65535);
const positiveInt = Joi.number().integer().min(1);
const flag = Joi.string().valid('true', 'false');
const uri = (...scheme: string[]) => Joi.string().uri({ scheme });

/**
 * 可选配置的格式。各模块读取时对非法值会静默回退（例如 DB_SSL=1 会被当成不启用 TLS），
 * 这里在启动时统一检查；只校验已设置的值，空字符串视为未设置。
 */
const ENV_FORMAT = Joi.object({
  PORT: port,
  DB_PORT: port,
  REDIS_PORT: port,
  DB_CONNECTION_LIMIT: positiveInt.max(1000),
  RATE_LIMIT_WINDOW: positiveInt.messages({ 'number.base': '{{#label}} 是毫秒数，例如 60000' }),
  RATE_LIMIT_MAX: positiveInt,
  RATE_LIMIT_AUTH_MAX: positiveInt,
  DB_SSL: flag,
  REDIS_TLS: flag,
  RATE_LIMIT_STORE: Joi.string().valid('memory', 'redis'),
  PAYMENT_MODE: Joi.string().valid('disabled', 'demo'),
  EMAIL_PROVIDER: Joi.string().trim().valid('resend', 'gmail'),
  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'),
  REDIS_URL: uri('redis', 'rediss'),
  RABBITMQ_URL: uri('amqp', 'amqps'),
  ELASTICSEARCH_URL: uri('http', 'https'),
  SENTRY_DSN: uri('https', 'http'),
  SENTRY_ENVIRONMENT: Joi.string().pattern(/^[A-Za-z0-9._-]{1,64}$/),
  // jsonwebtoken 把不带单位的字符串当作毫秒，因此要求写单位
  JWT_EXPIRES_IN: Joi.string().pattern(/^[1-9]\d*(s|m|h|d|w|y)$/)
    .messages({ 'string.pattern.base': '{{#label}} 需要带单位，例如 7d、12h、30m' }),
}).unknown(true).prefs({ abortEarly: false, errors: { wrap: { label: false } } });

/** 返回格式错误的说明（只含变量名和规则，不含值，避免把密码写进日志） */
export function envFormatProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value !== ''));
  const { error } = ENV_FORMAT.validate(configured);
  return error ? error.details.map(detail => detail.message) : [];
}

/**
 * 启动时环境变量校验
 *
 * 生产环境缺失关键安全配置时直接拒绝启动，避免弱默认值造成安全风险；
 * 开发环境仅打印警告，不阻塞启动。
 */
export function validateEnv(): void {
  const isProd = process.env.NODE_ENV === 'production';

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || WEAK_SECRETS.has(jwtSecret)) {
    if (isProd) {
      logger.error('生产环境必须配置强 JWT_SECRET（禁止使用默认值），拒绝启动');
      process.exit(1);
    }
    logger.warn('未配置 JWT_SECRET，使用开发默认值（仅限开发环境）');
  }

  if (!process.env.CORS_ORIGIN) {
    if (isProd) {
      logger.error('生产环境必须配置 CORS_ORIGIN（允许的前端域名，逗号分隔），拒绝启动');
      process.exit(1);
    }
    logger.warn('未配置 CORS_ORIGIN，开发环境允许所有来源跨域');
  }

  const problems = envFormatProblems();
  if (problems.length) {
    if (isProd) {
      logger.error({ problems }, '环境变量格式错误，拒绝启动');
      process.exit(1);
    } else {
      logger.warn({ problems }, '环境变量格式错误（生产环境会拒绝启动）');
    }
  }

  // 设置了 APP_URL 表示要发找回密码邮件；配置不完整时功能会静默关闭，这里提示运维
  if (process.env.APP_URL?.trim() && !passwordMailConfig()) {
    logger.warn('已配置 APP_URL，但邮件配置不完整或无效（EMAIL_PROVIDER / RESEND_API_KEY / EMAIL_FROM 或 GMAIL_*），找回密码邮件不可用');
  }
}
