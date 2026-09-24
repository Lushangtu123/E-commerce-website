/**
 * HTTP 请求日志中间件
 * 记录每个请求的方法、路径、状态码与耗时
 */
import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const data = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start,
      ip: req.ip,
    };
    if (res.statusCode >= 500) {
      logger.error(data, 'HTTP请求');
    } else if (res.statusCode >= 400) {
      logger.warn(data, 'HTTP请求');
    } else {
      logger.info(data, 'HTTP请求');
    }
  });

  next();
}
