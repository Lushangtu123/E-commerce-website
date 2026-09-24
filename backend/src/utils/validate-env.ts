import logger from './logger';

/** 已知的弱密钥默认值，生产环境禁止使用 */
const WEAK_SECRETS = new Set([
  'secret',
  'your-secret-key',
  'your-super-secret-jwt-key-change-in-production',
]);

/**
 * 解析 CORS 允许的来源列表（支持逗号分隔多个域名）
 * @returns 来源数组；未配置时返回 true（开发环境放行所有）
 */
export function getCorsOrigins(): string[] | true {
  const origins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : true;
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
}
