import 'dotenv/config';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Request, Response } from 'express';
import { createApp } from './app';
import { connectDatabase } from './database/mysql';
import { connectRedis } from './database/redis';
import logger from './utils/logger';

const app = createApp({ serverless: true });

/** No listener, RabbitMQ consumer or background interval in a Vercel function. */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Next.js injects catch-all routing parameters into req.query. Express must parse
  // the original URL itself so those framework parameters never reach validation.
  delete (req as Partial<Request>).query;
  try {
    await Promise.all([connectDatabase(), connectRedis()]);
  } catch {
    logger.error('云数据库初始化失败');
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: '服务暂不可用，请稍后重试' }));
    return;
  }
  await new Promise<void>(resolve => {
    res.once('finish', resolve);
    res.once('close', resolve);
    app(req as Request, res as Response);
  });
}
