import { Redis } from '@upstash/redis';
import { config } from '../config/env';

/**
 * Tiny cross-instance KV facade used for short-lived caches (Shiprocket JWT,
 * etc.). Backed by Upstash Redis when configured; otherwise a per-process Map
 * (dev only — caches reset on every serverless cold start, which just means
 * one extra login round-trip, never incorrect behaviour).
 */

interface KvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  del(key: string): Promise<void>;
}

class UpstashKv implements KvStore {
  private redis = new Redis({ url: config.upstashRedisRestUrl, token: config.upstashRedisRestToken });
  async get(key: string): Promise<string | null> {
    return (await this.redis.get<string>(key)) ?? null;
  }
  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.redis.set(key, value, { px: ttlMs });
  }
  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

class MemoryKv implements KvStore {
  private map = new Map<string, { value: string; expiresAt: number }>();
  async get(key: string): Promise<string | null> {
    const e = this.map.get(key);
    if (!e) return null;
    if (Date.now() > e.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return e.value;
  }
  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
  async del(key: string): Promise<void> {
    this.map.delete(key);
  }
}

export const kv: KvStore =
  config.upstashRedisRestUrl && config.upstashRedisRestToken
    ? new UpstashKv()
    : new MemoryKv();
