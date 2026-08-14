import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import type { CachePort } from '../../application/ports/cache.port';

const PREFIX = 'hrit:';

export class RedisCache implements CachePort {
  readonly enabled = true;

  private readonly log = new Logger(RedisCache.name);
  private readonly redis: Redis;
  private alreadyWarned = false;

  private readonly ready: Promise<void>;

  constructor(url: string) {
    this.redis = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
      commandTimeout: 1_000,
      retryStrategy: (attempts) => Math.min(attempts * 200, 5_000),
    });

    this.redis.on('error', (error) => this.recordFailure(error));
    this.ready = this.redis.connect().catch((error) => this.recordFailure(error));
  }

  private recordFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);

    if (!this.alreadyWarned) {
      this.alreadyWarned = true;
      this.log.warn(`Redis unavailable, continuing without cache: ${message}`);
      return;
    }

    this.log.debug(`Redis still unavailable: ${message}`);
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      await this.ready;
      const raw = await this.redis.get(PREFIX + key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      this.recordFailure(error);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.ready;
      await this.redis.set(PREFIX + key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.recordFailure(error);
    }
  }

  async clear(): Promise<void> {
    try {
      await this.ready;
      const keys = await this.redis.keys(`${PREFIX}*`);
      if (keys.length > 0) await this.redis.del(...keys);
    } catch (error) {
      this.recordFailure(error);
    }
  }

  async close(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}

export class NullCache implements CachePort {
  readonly enabled = false;

  async get<T>(_key: string): Promise<T | null> {
    return null;
  }

  async set<T>(_key: string, _value: T, _ttlSeconds: number): Promise<void> {
  }

  async clear(): Promise<void> {
  }
}
