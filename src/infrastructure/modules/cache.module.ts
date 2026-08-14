import { Global, Module, type OnApplicationShutdown, Inject, Logger } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { CACHE, type CachePort } from '../../application/ports/cache.port';
import { NullCache, RedisCache } from '../cache/redis-cache';

@Global()
@Module({
  providers: [
    {
      provide: CACHE,
      useFactory: (env: Env): CachePort => {
        const log = new Logger('CacheModule');

        if (!env.CACHE_ENABLED || !env.REDIS_URL) {
          log.log(`Cache disabled (${!env.CACHE_ENABLED ? 'CACHE_ENABLED=false' : 'REDIS_URL absent'}).`);
          return new NullCache();
        }

        log.log(`Redis cache at ${env.REDIS_URL}, TTL ${env.CACHE_TTL_SECONDS}s.`);
        return new RedisCache(env.REDIS_URL);
      },
      inject: [ENV],
    },
  ],
  exports: [CACHE],
})
export class CacheModule implements OnApplicationShutdown {
  constructor(@Inject(CACHE) private readonly cache: CachePort) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.cache instanceof RedisCache) await this.cache.close();
  }
}
