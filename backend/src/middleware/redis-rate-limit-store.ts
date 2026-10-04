import type { Store, Options, IncrementResponse } from 'express-rate-limit';
import type Redis from 'ioredis';
import { getRedisClient } from '../database/redis';

// A single script makes increment and expiry atomic across Vercel instances.
const INCREMENT = `local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {hits, ttl}`;
const DECREMENT = `if tonumber(redis.call('GET', KEYS[1]) or '0') > 0 then
return redis.call('DECR', KEYS[1]) end return 0`;

export class RedisRateLimitStore implements Store {
  localKeys = false;
  private windowMs = 60000;
  constructor(public prefix: string, private client: () => Redis = getRedisClient) {}
  init(options: Options): void { this.windowMs = options.windowMs; }
  async increment(key: string): Promise<IncrementResponse> {
    const [totalHits, ttl] = await this.client().eval(INCREMENT, 1, this.prefix + key, this.windowMs) as number[];
    return { totalHits, resetTime: new Date(Date.now() + ttl) };
  }
  async decrement(key: string): Promise<void> { await this.client().eval(DECREMENT, 1, this.prefix + key); }
  async resetKey(key: string): Promise<void> { await this.client().del(this.prefix + key); }
}
