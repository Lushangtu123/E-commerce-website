import { getRedisClient } from '../database/redis';

export class CacheService {
  private redis = getRedisClient();

  // 设置缓存
  async set(key: string, value: any, expireSeconds?: number): Promise<void> {
    const data = JSON.stringify(value);
    if (expireSeconds) {
      await this.redis.setex(key, expireSeconds, data);
    } else {
      await this.redis.set(key, data);
    }
  }

  // 获取缓存
  async get<T = any>(key: string): Promise<T | null> {
    const data = await this.redis.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      return data as any;
    }
  }

  // 删除缓存
  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  // 批量删除
  async delPattern(pattern: string): Promise<void> {
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  // 检查key是否存在
  async exists(key: string): Promise<boolean> {
    const result = await this.redis.exists(key);
    return result === 1;
  }

  // 设置过期时间
  async expire(key: string, seconds: number): Promise<void> {
    await this.redis.expire(key, seconds);
  }

  // Hash操作
  async hset(key: string, field: string, value: any): Promise<void> {
    await this.redis.hset(key, field, JSON.stringify(value));
  }

  async hget<T = any>(key: string, field: string): Promise<T | null> {
    const data = await this.redis.hget(key, field);
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      return data as any;
    }
  }

  async hgetall<T = any>(key: string): Promise<Record<string, T>> {
    const data = await this.redis.hgetall(key);
    const result: Record<string, T> = {};
    for (const [field, value] of Object.entries(data)) {
      try {
        result[field] = JSON.parse(value);
      } catch {
        result[field] = value as any;
      }
    }
    return result;
  }

  async hdel(key: string, field: string): Promise<void> {
    await this.redis.hdel(key, field);
  }

  // List操作
  async lpush(key: string, ...values: any[]): Promise<void> {
    const data = values.map(v => JSON.stringify(v));
    await this.redis.lpush(key, ...data);
  }

  async rpush(key: string, ...values: any[]): Promise<void> {
    const data = values.map(v => JSON.stringify(v));
    await this.redis.rpush(key, ...data);
  }

  async lrange<T = any>(key: string, start: number, stop: number): Promise<T[]> {
    const data = await this.redis.lrange(key, start, stop);
    return data.map(item => {
      try {
        return JSON.parse(item);
      } catch {
        return item as any;
      }
    });
  }

  // 分布式锁
  async lock(key: string, expireSeconds: number = 10): Promise<boolean> {
    const result = await this.redis.set(key, '1', 'EX', expireSeconds, 'NX');
    return result === 'OK';
  }

  async unlock(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

export default new CacheService();

