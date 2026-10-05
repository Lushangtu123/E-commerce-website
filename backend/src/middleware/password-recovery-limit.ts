import { rateLimit } from 'express-rate-limit';
import { RedisRateLimitStore } from './redis-rate-limit-store';

/** Recovery must count successful generic replies too, to prevent email flooding. */
export const passwordRecoveryLimiter = rateLimit({
  ...(process.env.VERCEL || process.env.RATE_LIMIT_STORE === 'redis'
    ? { store: new RedisRateLimitStore('limits:password-recovery:') } : {}),
  windowMs: 15 * 60 * 1000, limit: 5,
  standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: '密码找回请求过于频繁，请15分钟后重试' },
});
