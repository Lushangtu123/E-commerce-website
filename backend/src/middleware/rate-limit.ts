/**
 * 限流中间件
 * 基于 express-rate-limit，防止接口被刷与暴力破解登录
 *
 * 注意：如果后端部署在反向代理（Nginx）之后，需要在 index.ts 中开启
 * app.set('trust proxy', 1)，否则限流会按代理服务器 IP 统计
 */
import { rateLimit } from 'express-rate-limit';

// 限流时间窗口（毫秒），默认 60 秒
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW || '', 10) || 60 * 1000;
// 通用 API 限流：每个 IP 每个窗口期最大请求数，默认 100
const API_MAX = parseInt(process.env.RATE_LIMIT_MAX || '', 10) || 100;
// 登录/注册限流：每个 IP 每个窗口期最大尝试次数，默认 10
const AUTH_MAX = parseInt(process.env.RATE_LIMIT_AUTH_MAX || '', 10) || 10;

/**
 * 通用 API 限流
 * 挂载在 /api 下，/health 与 /uploads 不受影响
 */
export const apiLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: API_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' },
});

/**
 * 登录/注册限流（防暴力破解）
 * 只统计失败请求，正常登录不受影响
 */
export const authLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: AUTH_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: '登录尝试过于频繁，请稍后再试' },
});
