import jwt from 'jsonwebtoken';
/** 顾客与管理员令牌的开发默认密钥；生产环境由 validateEnv 拒绝缺失或弱密钥 */
export const DEV_JWT_SECRET = 'secret';

/**
 * 签发和校验 JWT 的密钥。顾客与管理员共用，令牌身份由 type 字段区分。
 * 每次调用时读取环境变量，不依赖模块加载顺序。
 */
export function jwtSecret(): string {
  return process.env.JWT_SECRET || DEV_JWT_SECRET;
}

/**
 * 校验 JWT：只接受 HS256；先用当前密钥，签名不匹配时再用轮换期内的旧密钥（JWT_SECRET_PREVIOUS）。
 * 当前密钥下签名正确但已过期或无效的令牌直接拒绝，不会改用旧密钥重试。轮换步骤见 docs/KEY_ROTATION.md。
 */
export function verifyJwt(token: string, options: jwt.VerifyOptions = {}): string | jwt.JwtPayload {
  const secrets = [jwtSecret(), process.env.JWT_SECRET_PREVIOUS].filter((secret, index, all): secret is string =>
    !!secret && all.indexOf(secret) === index);
  let failure: unknown;
  for (const secret of secrets) {
    try {
      return jwt.verify(token, secret, { ...options, algorithms: ['HS256'] });
    } catch (error) {
      if (!(error instanceof jwt.JsonWebTokenError) || error.message !== 'invalid signature') throw error;
      failure = error;
    }
  }
  throw failure;
}
