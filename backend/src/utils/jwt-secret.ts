/** 顾客与管理员令牌的开发默认密钥；生产环境由 validateEnv 拒绝缺失或弱密钥 */
export const DEV_JWT_SECRET = 'secret';

/**
 * 签发和校验 JWT 的密钥。顾客与管理员共用，令牌身份由 type 字段区分。
 * 每次调用时读取环境变量，不依赖模块加载顺序。
 */
export function jwtSecret(): string {
  return process.env.JWT_SECRET || DEV_JWT_SECRET;
}
