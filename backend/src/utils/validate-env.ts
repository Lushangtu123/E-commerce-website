import Joi from 'joi';
import type { CorsOptions } from 'cors';
import logger from './logger';
import { DEV_JWT_SECRET } from './jwt-secret';
import { passwordMailConfig } from '../services/password-mail.service';
import { secretBoxKeyProblem } from './secret-box';

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
 * @returns 来源数组；未配置或含通配符 `*` 时返回 null（生产环境因此拒绝启动）
 */
export function getCorsOrigins(): string[] | null {
  const origins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return origins.length > 0 && !origins.includes('*') ? origins : null;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname);
  } catch { return false; }
}

/**
 * CORS 配置。只有 CORS_ORIGIN 明确列出的来源能跨域读取响应并携带会话 Cookie。
 * 没有可用列表时：生产环境不放行任何跨域来源（validateEnv 也会拒绝启动）；
 * 开发环境只放行本机页面（localhost / 127.0.0.1），且不带凭据。
 */
export function corsOptions(): CorsOptions {
  // 前端报错时可以读取请求 ID，方便按 ID 查日志
  const exposedHeaders = ['X-Request-Id'];
  const origins = getCorsOrigins();
  if (origins) return { origin: origins, credentials: true, exposedHeaders };
  if (process.env.NODE_ENV === 'production') return { origin: false, credentials: false, exposedHeaders };
  return { origin: (origin, callback) => callback(null, isLoopbackOrigin(origin)), credentials: false, exposedHeaders };
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
  // The internal job routes reject shorter secrets, so a short one would silently stop the scheduled jobs.
  CRON_SECRET: Joi.string().min(32),
  CRON_SECRET_PREVIOUS: Joi.string().min(32),
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

  // 管理员两步验证强制开启，加密 TOTP 密钥的 ADMIN_TOTP_KEY 必须有效
  const totpKeyProblem = secretBoxKeyProblem(process.env.ADMIN_TOTP_KEY);
  if (totpKeyProblem && (isProd || process.env.ADMIN_TOTP_KEY)) {
    if (isProd) {
      logger.error(`${totpKeyProblem}，管理员无法完成两步验证，拒绝启动`);
      process.exit(1);
    }
    logger.warn(totpKeyProblem);
  } else if (totpKeyProblem) {
    logger.warn('未配置 ADMIN_TOTP_KEY，管理员无法绑定两步验证（开发环境可用 openssl rand -base64 32 生成）');
  }

  // 轮换期的旧密钥只用于校验已签发的令牌（docs/KEY_ROTATION.md）
  const previousJwtSecret = process.env.JWT_SECRET_PREVIOUS;
  if (previousJwtSecret && (WEAK_SECRETS.has(previousJwtSecret) || previousJwtSecret === jwtSecret)) {
    if (isProd) {
      logger.error('JWT_SECRET_PREVIOUS 不能是弱密钥，也不能与 JWT_SECRET 相同，拒绝启动');
      process.exit(1);
    }
    logger.warn('JWT_SECRET_PREVIOUS 是弱密钥或与 JWT_SECRET 相同');
  }

  // 轮换期的旧 TOTP 密钥只用于解开旧数据（docs/KEY_ROTATION.md）
  const previousTotpKey = process.env.ADMIN_TOTP_KEY_PREVIOUS;
  if (previousTotpKey) {
    const problem = secretBoxKeyProblem(previousTotpKey, 'ADMIN_TOTP_KEY_PREVIOUS')
      ?? (previousTotpKey === process.env.ADMIN_TOTP_KEY ? 'ADMIN_TOTP_KEY_PREVIOUS 不能与 ADMIN_TOTP_KEY 相同' : null);
    if (problem) {
      if (isProd) {
        logger.error(`${problem}，拒绝启动`);
        process.exit(1);
      }
      logger.warn(problem);
    }
  }

  if (!getCorsOrigins()) {
    if (isProd) {
      logger.error('生产环境必须把 CORS_ORIGIN 配置为允许的前端域名（逗号分隔，不能用 *），拒绝启动');
      process.exit(1);
    }
    logger.warn('未配置 CORS_ORIGIN 或使用了 *，开发环境只允许本机页面跨域，且不带 Cookie');
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
