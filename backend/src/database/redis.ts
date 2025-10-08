import Redis from 'ioredis';
import dotenv from 'dotenv';

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
    console.error('Redis错误:', err);
  });

  redisClient.on('connect', () => {
    console.log('Redis连接中...');
  });

  await redisClient.ping();
}

export function getRedisClient(): Redis {
  if (!redisClient) {
    throw new Error('Redis未初始化');
  }
  return redisClient;
}

