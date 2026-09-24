import Redis from 'ioredis';
import dotenv from 'dotenv';
import logger from '../utils/logger';

dotenv.config();

let redisClient: Redis;

export async function connectRedis() {
  redisClient = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    }
  });

  redisClient.on('error', (err) => {
    logger.error({ err }, 'Redis错误');
  });

  redisClient.on('connect', () => {
    logger.info('Redis连接中...');
  });

  await redisClient.ping();
}

export function getRedisClient(): Redis {
  if (!redisClient) {
    throw new Error('Redis未初始化');
  }
  return redisClient;
}

