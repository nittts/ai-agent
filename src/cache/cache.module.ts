import { Global, Module, type OnApplicationShutdown, Inject, Logger } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import type { CachePort } from './cache.port';
import { NullCache, RedisCache } from './redis-cache';

export const CACHE = Symbol('CACHE');

@Global()
@Module({
  providers: [
    {
      provide: CACHE,
      useFactory: (env: Env): CachePort => {
        const log = new Logger('CacheModule');

        if (!env.CACHE_ENABLED || !env.REDIS_URL) {
          log.log(
            `Cache desligado (${!env.CACHE_ENABLED ? 'CACHE_ENABLED=false' : 'REDIS_URL ausente'}).`,
          );
          return new NullCache();
        }

        log.log(`Cache Redis em ${env.REDIS_URL}, TTL ${env.CACHE_TTL_SECONDS}s.`);
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
    if (this.cache instanceof RedisCache) await this.cache.encerrar();
  }
}
