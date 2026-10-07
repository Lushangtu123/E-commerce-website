import Redis, { RedisOptions } from 'ioredis';
import dotenv from 'dotenv';
import logger from '../utils/logger';

dotenv.config({ quiet: true });

let redisClient: Redis;
let connecting: Promise<void> | undefined;

export async function connectRedis(): Promise<void> {
  if (redisClient) return;
  if (connecting) return connecting;
  connecting = initializeRedis();
  try { await connecting; } finally { connecting = undefined; }
}

async function initializeRedis(): Promise<void> {
  const options: RedisOptions = {
    lazyConnect: true,
    // ioredis 6 defaults to RESP3; keep RESP2, which every supported Redis (including Upstash) speaks
    protocol: 2,
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'ecommerce:',
    maxRetriesPerRequest: 1,
    connectTimeout: 10000,
    commandTimeout: 5000,
    retryStrategy: times => times <= 3 ? Math.min(times * 100, 1000) : null,
  };
  const client = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, options)
    : new Redis({ ...options, host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT || 6379), password: process.env.REDIS_PASSWORD || undefined,
      ...(process.env.REDIS_TLS === 'true' ? { tls: {} } : {}),
    });
  // Do not include connection URLs or passwords in errors.
  client.on('error', () => logger.warn('Redis连接错误'));
  try {
    await client.connect();
    await client.ping();
    redisClient = client;
  } catch (error) {
    client.disconnect();
    throw error;
  }
}

export function getRedisClient(): Redis {
  if (!redisClient) throw new Error('Redis未初始化');
  return redisClient;
}
